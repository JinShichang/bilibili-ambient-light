/*
 * Ambient light renderer.
 *
 * Technique inspired by "Ambient light for YouTube" (github.com/WesselKroos/youtube-ambilight, MIT):
 * the current video frame is drawn several times at increasing sizes behind the video, so the
 * colors at the video's edges extend outward. The stack is then faded out toward the page
 * background and blurred.
 *
 * Pipeline per frame (all canvases are small; the browser upscales the result):
 *   video --drawImage--> src (≈457x257 downscaled frame)
 *   src   --N stretched copies + edge fade--> work (viewport-sized, low resolution)
 *   work  --ctx.filter blur/brightness/saturate--> canvas (the visible layer, fixed behind the page)
 */
(() => {
  'use strict';

  // Chromium keeps 2D canvases smaller than this on the CPU, which makes video uploads slow.
  const GPU_MIN_SIDE = 257;
  const SRC_MAX_SIDE = 1024;
  const MAX_LEVELS = 64;
  const FADE_STEPS = 12;
  const NOISE_MAX_OPACITY = 0.5;

  // Letterbox (baked-in black bar) detection.
  const DETECT_WIDTH = 96;
  const DETECT_INTERVAL_MS = 500;
  const BAR_LUMA_THRESHOLD = 24; // 0-255
  const BAR_BRIGHT_PIXELS_ALLOWED = 0.02; // tolerate small logos/noise inside a bar
  const BAR_MAX_FRACTION = 0.35;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const createCanvas = () => document.createElement('canvas');

  class AmbientRenderer {
    constructor() {
      this.root = document.createElement('div');
      this.root.className = 'bal-root';
      this.root.setAttribute('aria-hidden', 'true');

      this.canvas = createCanvas();
      this.canvas.className = 'bal-canvas';
      this.ctx = this.canvas.getContext('2d', { alpha: false });

      this.noiseElem = document.createElement('div');
      this.noiseElem.className = 'bal-noise';
      this.root.append(this.canvas, this.noiseElem);

      this.work = createCanvas();
      this.wctx = this.work.getContext('2d');
      this.src = createCanvas();
      this.sctx = this.src.getContext('2d', { alpha: false });
      this.detect = createCanvas();
      this.dctx = this.detect.getContext('2d', { alpha: false, willReadFrequently: true });

      this.ctxFilterSupported = typeof this.ctx.filter === 'string';

      this.settings = null;
      this.source = null;
      this.running = false;

      this.layout = null;
      this.layoutDirty = true;
      this.objectFit = 'contain';
      this.objectFitCheckedAt = 0;
      this.outputEmpty = true;

      this.bars = { h: 0, v: 0 };
      this.pendingBars = null;
      this.lastDetectTime = 0;
      this.imageDataBlocked = false;

      this.loopSource = null;
      this.useVideoFrameCallback = false;
      this.videoFrameCallbackId = 0;
      this.animationFrameId = 0;
      this.renderQueuedId = 0;
      this.lastFrameTime = 0;
      this.errorLogged = false;
    }

    // ---------------------------------------------------------------- public API

    setSettings(settings) {
      const backgroundChanged = this.settings?.backgroundColor !== settings.backgroundColor;
      this.settings = settings;
      this.root.style.backgroundColor = settings.backgroundColor;
      this.noiseElem.style.opacity = String((settings.debanding / 100) * NOISE_MAX_OPACITY);
      if (!settings.barDetection) this.resetBars();
      if (backgroundChanged) {
        this.outputEmpty = false; // Force the idle canvas to be refilled with the new color.
        if (!this.running) this.clearOutput();
      }
      this.invalidate();
    }

    setNoiseUrl(url) {
      this.noiseElem.style.backgroundImage = `url("${url}")`;
    }

    setSource(source) {
      if (source === this.source) return;
      this.stopLoop();
      this.source = source;
      this.resetBars();
      this.invalidate();
      if (this.running) this.startLoop();
    }

    /** Resets per-video state, e.g. when the same <video> element starts playing another episode. */
    resetSourceState() {
      this.resetBars();
      this.invalidate();
    }

    /** Adds the (still empty) background layer to the page. */
    mount() {
      if (!this.root.isConnected) (document.body ?? document.documentElement).append(this.root);
    }

    unmount() {
      this.stop();
      this.root.remove();
    }

    /** Starts drawing the light. */
    start() {
      this.mount();
      if (this.running) return;
      this.running = true;
      this.invalidate();
      this.startLoop();
    }

    /** Stops drawing and leaves only the plain background color. */
    stop() {
      if (!this.running) return;
      this.running = false;
      this.stopLoop();
      if (this.renderQueuedId) cancelAnimationFrame(this.renderQueuedId);
      this.renderQueuedId = 0;
      this.clearOutput();
    }

    /** Marks sizes as stale (resize, player mode change, settings change) and redraws. */
    invalidate() {
      this.layoutDirty = true;
      this.objectFitCheckedAt = 0;
      this.requestRender();
    }

    /** Schedules a single redraw on the next animation frame (used while paused, scrolling, ...). */
    requestRender() {
      if (!this.running || this.renderQueuedId) return;
      this.renderQueuedId = requestAnimationFrame((now) => {
        this.renderQueuedId = 0;
        this.safeRender(now);
      });
    }

    static createNoiseDataUrl(size = 128) {
      const canvas = createCanvas();
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(size, size);
      for (let i = 0; i < image.data.length; i += 4) {
        // Triangular distribution around mid grey, neutral for the overlay blend mode.
        const v = Math.round(128 + (Math.random() + Math.random() - 1) * 51);
        image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png');
    }

    // ---------------------------------------------------------------- frame loop

    startLoop() {
      const source = this.source;
      if (!this.running || !source) return;
      if (this.loopSource === source && (this.videoFrameCallbackId || this.animationFrameId)) return;
      this.stopLoop();
      this.loopSource = source;
      // requestVideoFrameCallback fires once per decoded video frame and stops by itself while
      // paused, so no work is done when nothing changes. Canvas sources fall back to rAF.
      this.useVideoFrameCallback = typeof source.requestVideoFrameCallback === 'function';
      this.queueFrame();
    }

    stopLoop() {
      if (this.videoFrameCallbackId && this.loopSource?.cancelVideoFrameCallback) {
        this.loopSource.cancelVideoFrameCallback(this.videoFrameCallbackId);
      }
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.videoFrameCallbackId = 0;
      this.animationFrameId = 0;
      this.loopSource = null;
    }

    queueFrame() {
      const source = this.loopSource;
      if (!this.running || !source) return;
      if (this.useVideoFrameCallback) {
        this.videoFrameCallbackId = source.requestVideoFrameCallback(this.onVideoFrame);
      } else {
        this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
      }
    }

    onVideoFrame = (now) => {
      this.videoFrameCallbackId = 0;
      this.tick(now);
      this.queueFrame();
    };

    onAnimationFrame = (now) => {
      this.animationFrameId = 0;
      this.tick(now);
      this.queueFrame();
    };

    tick(now) {
      const limit = this.settings?.fps ?? 0;
      if (limit > 0 && now - this.lastFrameTime < 1000 / limit - 2) return;
      this.lastFrameTime = now;
      if (document.hidden) return;
      this.safeRender(now);
    }

    safeRender(now) {
      try {
        this.render(now);
      } catch (err) {
        if (!this.errorLogged) {
          this.errorLogged = true;
          console.error('[BiliAmbient] Rendering failed', err);
        }
      }
    }

    // ---------------------------------------------------------------- rendering

    render(now = performance.now()) {
      if (!this.running || !this.settings) return;
      const s = this.settings;

      const content = this.measureContent();
      if (!content) return; // Not ready (buffering, hidden, no metadata): keep the last output.

      const base = this.applyBars(content);
      this.updateLayout(content);
      const { kx, ky, pad, vpW, vpH } = this.layout;

      // Distance the light reaches beyond the video edges, in CSS px.
      const reach = ((s.spread / 100) * Math.max(base.w, base.h)) / 2;
      const outer = reach + this.layout.blurPx * 2;
      const onScreen =
        base.x - outer < vpW &&
        base.x + base.w + outer > 0 &&
        base.y - outer < vpH &&
        base.y + base.h + outer > 0;
      if (!onScreen) {
        this.clearOutput();
        return;
      }

      // 1. Downscale the visible part of the frame.
      this.ensureSrcSize(content.sw, content.sh);
      const sctx = this.sctx;
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(
        this.source,
        content.sx,
        content.sy,
        content.sw,
        content.sh,
        0,
        0,
        this.src.width,
        this.src.height
      );

      if (s.barDetection && now - this.lastDetectTime >= DETECT_INTERVAL_MS) {
        this.lastDetectTime = now;
        this.detectBars();
      }

      // 2. Stack stretched copies, largest first, so every ring shows the frame's edge colors.
      const work = this.work;
      const wctx = this.wctx;
      wctx.globalCompositeOperation = 'source-over';
      wctx.clearRect(0, 0, work.width, work.height);
      wctx.imageSmoothingEnabled = true;
      wctx.imageSmoothingQuality = 'medium';

      const srcX = this.src.width * this.bars.v;
      const srcY = this.src.height * this.bars.h;
      const srcW = this.src.width - srcX * 2;
      const srcH = this.src.height - srcY * 2;
      const levels = reach > 0.5 ? clamp(Math.ceil(s.spread / s.edge), 1, MAX_LEVELS) : 0;

      for (let i = levels; i >= 0; i--) {
        const grow = levels ? (reach * i) / levels : 0;
        wctx.drawImage(
          this.src,
          srcX,
          srcY,
          srcW,
          srcH,
          (base.x - grow + pad) * kx,
          (base.y - grow + pad) * ky,
          (base.w + grow * 2) * kx,
          (base.h + grow * 2) * ky
        );
      }

      // 3. Fade the stack out toward the page (alpha multiply with a horizontal and a vertical ramp).
      if (levels) {
        wctx.globalCompositeOperation = 'destination-in';
        wctx.fillStyle = this.createFade(wctx, true, base, reach);
        wctx.fillRect(0, 0, work.width, work.height);
        wctx.fillStyle = this.createFade(wctx, false, base, reach);
        wctx.fillRect(0, 0, work.width, work.height);
        wctx.globalCompositeOperation = 'source-over';
      }

      // 4. Blur and color-grade into the visible canvas.
      const ctx = this.ctx;
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = s.backgroundColor;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.ctxFilterSupported) ctx.filter = this.layout.filter;
      ctx.drawImage(work, 0, 0);
      ctx.filter = 'none';
      this.outputEmpty = false;
    }

    clearOutput() {
      if (this.outputEmpty || !this.settings) return;
      this.ctx.filter = 'none';
      this.ctx.fillStyle = this.settings.backgroundColor;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.outputEmpty = true;
    }

    /**
     * Returns where the video picture is on screen (viewport CSS px) and which part of the
     * source it shows, honoring object-fit (contain/cover/fill).
     */
    measureContent() {
      const source = this.source;
      if (!source || !source.isConnected) return null;

      const isVideo = source instanceof HTMLVideoElement;
      if (isVideo && source.readyState < 2) return null; // HAVE_CURRENT_DATA
      const vw = isVideo ? source.videoWidth : source.width;
      const vh = isVideo ? source.videoHeight : source.height;
      if (!vw || !vh) return null;

      const rect = source.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return null;

      const now = performance.now();
      if (now - this.objectFitCheckedAt > 1000) {
        this.objectFit = getComputedStyle(source).objectFit || 'fill';
        this.objectFitCheckedAt = now;
      }

      let x = rect.left;
      let y = rect.top;
      let w = rect.width;
      let h = rect.height;
      let sx = 0;
      let sy = 0;
      let sw = vw;
      let sh = vh;

      if (this.objectFit === 'contain' || this.objectFit === 'scale-down') {
        let scale = Math.min(rect.width / vw, rect.height / vh);
        if (this.objectFit === 'scale-down') scale = Math.min(1, scale);
        w = vw * scale;
        h = vh * scale;
        x += (rect.width - w) / 2;
        y += (rect.height - h) / 2;
      } else if (this.objectFit === 'cover') {
        const scale = Math.max(rect.width / vw, rect.height / vh);
        sw = rect.width / scale;
        sh = rect.height / scale;
        sx = (vw - sw) / 2;
        sy = (vh - sh) / 2;
      }

      return { x, y, w, h, sx, sy, sw, sh };
    }

    applyBars(content) {
      const { h, v } = this.bars;
      return {
        x: content.x + content.w * v,
        y: content.y + content.h * h,
        w: content.w * (1 - v * 2),
        h: content.h * (1 - h * 2),
      };
    }

    /** Sizes the canvases to the viewport (+ blur padding) and builds the filter string. */
    updateLayout(content) {
      const s = this.settings;
      const vpW = document.documentElement.clientWidth || window.innerWidth;
      const vpH = document.documentElement.clientHeight || window.innerHeight;

      // Blur radius relative to the video size, so the look stays the same in every player mode.
      const blurPx = Math.max(content.w, content.h) * 0.5625 * 0.0025 * s.blur;
      if (
        !this.layoutDirty &&
        this.layout &&
        this.layout.vpW === vpW &&
        this.layout.vpH === vpH &&
        Math.abs(this.layout.blurPx - blurPx) < 0.5
      ) {
        return;
      }

      // Pad the canvas beyond the viewport so the blur doesn't darken the screen edges.
      // Quantized to avoid resizing (and clearing) canvases on every tiny size change.
      const pad = Math.ceil((blurPx * 2.5) / 16) * 16;
      const cssW = vpW + pad * 2;
      const cssH = vpH + pad * 2;

      // Low internal resolution is fine because the result is blurred anyway.
      let k = clamp(8 / Math.max(blurPx, 1), 0.12, 0.5) * (s.resolution / 100);
      k = Math.min(1, Math.max(k, GPU_MIN_SIDE / cssW, GPU_MIN_SIDE / cssH));
      const width = Math.max(1, Math.round(cssW * k));
      const height = Math.max(1, Math.round(cssH * k));

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.work.width = width;
        this.work.height = height;
        this.outputEmpty = false; // Resizing cleared it to transparent black.
      }
      const style = this.canvas.style;
      style.left = `${-pad}px`;
      style.top = `${-pad}px`;
      style.width = `${cssW}px`;
      style.height = `${cssH}px`;

      const kx = width / cssW;
      const ky = height / cssH;
      const blurCanvasPx = blurPx * kx;
      const color = [
        s.brightness !== 100 ? `brightness(${s.brightness}%)` : '',
        s.contrast !== 100 ? `contrast(${s.contrast}%)` : '',
        s.saturation !== 100 ? `saturate(${s.saturation}%)` : '',
      ];

      let filter = 'none';
      if (this.ctxFilterSupported) {
        filter =
          [blurCanvasPx >= 0.3 ? `blur(${blurCanvasPx.toFixed(2)}px)` : '', ...color]
            .filter(Boolean)
            .join(' ') || 'none';
        style.filter = '';
      } else {
        // Fallback (no CanvasRenderingContext2D.filter): let the compositor apply the filter.
        style.filter =
          [blurPx >= 0.5 ? `blur(${blurPx.toFixed(1)}px)` : '', ...color].filter(Boolean).join(' ');
      }

      this.layout = { vpW, vpH, pad, kx, ky, blurPx, filter };
      this.layoutDirty = false;
    }

    ensureSrcSize(sw, sh) {
      let scale = Math.max(GPU_MIN_SIDE / sw, GPU_MIN_SIDE / sh);
      scale = Math.min(scale, SRC_MAX_SIDE / Math.max(sw, sh), 1);
      const width = Math.max(1, Math.round(sw * scale));
      const height = Math.max(1, Math.round(sh * scale));
      if (this.src.width !== width || this.src.height !== height) {
        this.src.width = width;
        this.src.height = height;
      }
    }

    /** Alpha ramp: opaque up to fadeStart% of the reach, then eased down to 0 at the full reach. */
    createFade(ctx, horizontal, base, reach) {
      const { kx, ky, pad } = this.layout;
      const k = horizontal ? kx : ky;
      const start = horizontal ? base.x : base.y;
      const size = horizontal ? base.w : base.h;
      const from = (start - reach + pad) * k;
      const to = (start + size + reach + pad) * k;
      const gradient = horizontal
        ? ctx.createLinearGradient(from, 0, to, 0)
        : ctx.createLinearGradient(0, from, 0, to);

      const total = size + reach * 2;
      const fadeStart = this.settings.fadeStart / 100;
      const curve = this.settings.fadeCurve / 100;
      for (let i = 0; i <= FADE_STEPS; i++) {
        const t = i / FADE_STEPS;
        const distance = reach * (fadeStart + (1 - fadeStart) * t); // from the video edge
        const color = `rgba(0,0,0,${Math.pow(1 - t, curve).toFixed(4)})`;
        gradient.addColorStop(clamp((reach - distance) / total, 0, 1), color);
        gradient.addColorStop(clamp((reach + size + distance) / total, 0, 1), color);
      }
      return gradient;
    }

    // ---------------------------------------------------------------- black bar detection

    resetBars() {
      this.bars = { h: 0, v: 0 };
      this.pendingBars = null;
      this.lastDetectTime = 0;
    }

    /**
     * Many uploads have black bars baked into the picture (4:3 in 16:9, cinema scope, ...).
     * Without cropping them the light next to the video would be black. Samples the downscaled
     * frame and only applies a result after two consecutive identical detections.
     */
    detectBars() {
      if (this.imageDataBlocked) return;
      const dw = DETECT_WIDTH;
      const dh = clamp(Math.round((dw * this.src.height) / this.src.width), 16, 192);
      if (this.detect.width !== dw || this.detect.height !== dh) {
        this.detect.width = dw;
        this.detect.height = dh;
      }
      this.dctx.drawImage(this.src, 0, 0, dw, dh);

      let data;
      try {
        data = this.dctx.getImageData(0, 0, dw, dh).data;
      } catch (err) {
        // Cross-origin video without CORS: pixels can't be read, so no detection.
        this.imageDataBlocked = true;
        this.resetBars();
        console.warn('[BiliAmbient] Black bar detection unavailable for this video', err);
        return;
      }

      const isDarkLine = (start, count, stride) => {
        const allowed = Math.floor(count * BAR_BRIGHT_PIXELS_ALLOWED);
        let bright = 0;
        for (let n = 0, i = start; n < count; n++, i += stride) {
          const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
          if (luma > BAR_LUMA_THRESHOLD && ++bright > allowed) return false;
        }
        return true;
      };
      const rowIsDark = (y) => isDarkLine(y * dw * 4, dw, 4);
      const colIsDark = (x) => isDarkLine(x * 4, dh, dw * 4);
      const countFromEdge = (lines, isDark) => {
        const max = Math.floor(lines * BAR_MAX_FRACTION);
        let n = 0;
        while (n < max && isDark(n)) n++;
        return { n, max };
      };

      const top = countFromEdge(dh, (y) => rowIsDark(y));
      const bottom = countFromEdge(dh, (y) => rowIsDark(dh - 1 - y));
      const left = countFromEdge(dw, (x) => colIsDark(x));
      const right = countFromEdge(dw, (x) => colIsDark(dw - 1 - x));

      // A frame that is dark almost everywhere (fade to black, night scene) says nothing about bars.
      if ((top.n >= top.max && bottom.n >= bottom.max) || (left.n >= left.max && right.n >= right.max)) {
        return;
      }

      // Symmetric crop (subtitles inside one bar shouldn't matter), plus one extra line to also
      // drop the soft, half-dark boundary line.
      const h = Math.min(top.n, bottom.n);
      const v = Math.min(left.n, right.n);
      const next = { h: h ? (h + 1) / dh : 0, v: v ? (v + 1) / dw : 0 };

      const pending = this.pendingBars;
      this.pendingBars = next;
      if (!pending || pending.h !== next.h || pending.v !== next.v) return;
      if (this.bars.h !== next.h || this.bars.v !== next.v) {
        this.bars = next;
        this.requestRender();
      }
    }
  }

  globalThis.BiliAmbientRenderer = AmbientRenderer;
})();
