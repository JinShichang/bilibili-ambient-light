/*
 * Records Bilibili video pages with the ambient light extension through Kimi WebBridge.
 *
 * The page is not screen-recorded in real time (background tabs capture too slowly for that).
 * Instead the video is paused and stepped frame by frame: seek -> let the extension redraw ->
 * CDP screenshot. That gives smooth, exact 30 fps footage no matter how slow a capture is.
 *
 * Usage (from promo/):
 *   node scripts/record.mjs preview [--session name] [clipId ...]   contact sheets to pick start times
 *   node scripts/record.mjs record  [--session name] [clipId ...]   frames -> recordings/frames/<clip>-<variant>/
 *   node scripts/record.mjs popup   [--session name]                 settings popup -> public/popup.png
 *
 * Requires the WebBridge daemon (127.0.0.1:10086) with the browser extension connected.
 * The extension under test is injected into the page from a local static server (127.0.0.1 only).
 */
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMO = resolve(HERE, '..');
const EXT_ROOT = resolve(PROMO, '..');
const REC_DIR = join(PROMO, 'recordings');
const API = process.env.WEBBRIDGE_URL ?? 'http://127.0.0.1:10086/command';
const DEV_PORT = 8765;
const DEV_BASE = `http://127.0.0.1:${DEV_PORT}/`;
const FPS = 30;
const VIEWPORT = { width: 1920, height: 1080 };

/**
 * start: seconds into the video, frames: number of 30 fps frames,
 * variants: 'on' = extension enabled, 'off' = same frames without the extension,
 * screen: Bilibili player mode ('normal' | 'wide').
 */
export const CLIPS = [
  // KDA "MORE": neon colors + black bars baked into the picture (bar detection)
  { id: 'kda', bv: 'BV175411V75Q', start: 133, frames: 150, variants: ['on', 'off'], screen: 'normal' },
  // Sunset time-lapse
  { id: 'sky', bv: 'BV16K4y1h7eq', start: 20, frames: 150, variants: ['on'], screen: 'normal' },
  // 21:9 animation (letterboxed by the player)
  { id: 'cinema', bv: 'BV19D4y1S75R', start: 280, frames: 150, variants: ['on'], screen: 'normal' },
  // Sea of clouds, recorded in wide mode
  { id: 'landscape', bv: 'BV1t94y1C7fp', start: 533, frames: 150, variants: ['on'], screen: 'wide' },
  // Jinx CG
  { id: 'jinx', bv: 'BV1kp4y1k7ax', start: 120, frames: 120, variants: ['on'], screen: 'normal' },
];

// ---------------------------------------------------------------- WebBridge

async function wb(session, action, args = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, session, args }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${action} failed: ${JSON.stringify(json.error ?? json).slice(0, 400)}`);
  return json.data;
}

const cdp = (session, method, params = {}) => wb(session, 'cdp', { method, params });

/** Runs a self-contained function in the page. The function must return JSON.stringify(...). */
async function evaluate(session, fn, arg = null) {
  const data = await wb(session, 'evaluate', { code: `(${fn.toString()})(${JSON.stringify(arg)})` });
  const value = data?.value;
  const result = typeof value === 'string' ? JSON.parse(value) : value;
  if (result && result.error) throw new Error(`page error: ${result.error}`);
  return result;
}

async function capture(session, path, params = {}) {
  const data = await cdp(session, 'Page.captureScreenshot', { format: 'jpeg', quality: 92, ...params });
  await writeFile(path, Buffer.from(data.data, 'base64'));
}

// ---------------------------------------------------------------- page functions (run in the tab)

async function pageSetup({ devBase, screen }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let video = null;
    for (let i = 0; i < 150; i++) {
      video = document.querySelector('.bpx-player-video-wrap video');
      if (video && video.readyState >= 1 && video.duration > 0) break;
      await wait(200);
    }
    if (!video) return JSON.stringify({ error: 'video not found' });
    video.muted = true;
    video.pause();

    if (!globalThis.__biliAmbientController) {
      const files = ['src/content.css', 'src/settings.js', 'src/ambient.js', 'src/content.js'];
      const [css, ...scripts] = await Promise.all(files.map((f) => fetch(devBase + f).then((r) => r.text())));
      const style = document.createElement('style');
      style.id = 'bal-dev-css';
      style.textContent = css;
      document.head.append(style);
      for (const code of scripts) (0, eval)(code);
    }

    // If the extension is also installed in this browser, its content script (isolated world) draws
    // a second light layer. Recording only uses the injected copy (current code, default settings):
    // foreign layers are removed on insertion, and in "off" mode its page attributes are stripped.
    if (!globalThis.__balRecGuard) {
      const guard = { off: false, observer: null };
      const mine = () => globalThis.__biliAmbientController?.renderer?.root;
      const isForeignRoot = (n) => n.nodeType === 1 && n.classList.contains('bal-root') && n !== mine();
      const pageAttrs = ['data-bal', 'data-bal-light', 'data-bal-dark', 'data-bal-header', 'data-bal-shadow'];
      guard.observer = new MutationObserver((mutations) => {
        let pageTouched = false;
        for (const m of mutations) {
          if (m.type === 'childList') {
            for (const n of m.addedNodes) if (isForeignRoot(n)) n.remove();
          } else if (m.attributeName !== 'style' || m.target === document.documentElement) {
            pageTouched = true;
          }
        }
        if (!pageTouched) return;
        const c = globalThis.__biliAmbientController;
        if (guard.off) {
          // Look exactly like the extension is disabled.
          for (const name of pageAttrs) document.documentElement.removeAttribute(name);
          for (const el of document.querySelectorAll('[data-bal-clear]')) el.removeAttribute('data-bal-clear');
        } else if (c?.pageActive) {
          // Keep the injected copy's page state (the other copy may use different settings).
          c.applyPageState(c.lightActive);
        }
      });
      guard.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [...pageAttrs, 'data-bal-clear', 'style'],
      });
      for (const n of document.querySelectorAll('.bal-root')) if (isForeignRoot(n)) n.remove();
      globalThis.__balRecGuard = guard;
    }

    // Recording only: hide the player chrome, danmaku and toasts (they freeze while stepping).
    if (!document.getElementById('bal-rec-style')) {
      const style = document.createElement('style');
      style.id = 'bal-rec-style';
      style.textContent = `
        .bpx-player-control-wrap, .bpx-player-state-wrap, .bpx-player-toast-wrap,
        .bpx-player-row-dm-wrap, .bpx-player-cmd-dm-wrap, .bpx-player-top-wrap,
        .bpx-player-dialog-wrap, .bpx-player-tooltip-area, .bpx-player-adv-wrap,
        .bpx-player-ending-panel, .bpx-player-electric-panel, .bpx-player-popup,
        .vsc-controller {
          opacity: 0 !important; visibility: hidden !important;
        }
        * { cursor: none !important; caret-color: transparent !important; }
      `;
      document.head.append(style);
    }

    for (let i = 0; i < 50 && !globalThis.__biliAmbientController?.settings; i++) await wait(100);
    const player = document.querySelector('.bpx-player-container');
    const isWide = () => player?.getAttribute('data-screen') === 'wide';
    // The wide button needs the player UI to be initialized; retry a few times.
    for (let attempt = 0; attempt < 6 && (screen === 'wide') !== isWide(); attempt++) {
      document.querySelector('.bpx-player-ctrl-wide')?.click();
      for (let i = 0; i < 10 && (screen === 'wide') !== isWide(); i++) await wait(150);
    }
    await wait(800);
    window.scrollTo(0, 0);
    document.activeElement?.blur?.();
    await wait(2000); // Let the header and lazy page modules settle


    const rect = video.getBoundingClientRect();
    return JSON.stringify({
      duration: video.duration,
      size: [video.videoWidth, video.videoHeight],
      rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
      viewport: [innerWidth, innerHeight],
      screen: player?.getAttribute('data-screen'),
    });
  } catch (err) {
    return JSON.stringify({ error: String(err?.stack ?? err) });
  }
}

async function pageSetEnabled(enabled) {
  const c = globalThis.__biliAmbientController;
  const guard = globalThis.__balRecGuard;
  if (!c || !guard) return JSON.stringify({ error: 'controller or guard missing' });
  guard.off = !enabled;
  c.settings = { ...c.settings, enabled };
  c.renderer.setSettings(c.settings);
  c.update();
  if (!enabled) {
    const names = ['data-bal', 'data-bal-light', 'data-bal-dark', 'data-bal-header', 'data-bal-shadow'];
    for (const name of names) document.documentElement.removeAttribute(name);
    for (const el of document.querySelectorAll('[data-bal-clear]')) el.removeAttribute('data-bal-clear');
    for (const root of document.querySelectorAll('.bal-root')) root.remove();
  }
  await new Promise((r) => setTimeout(r, 1500)); // let any other copy's poll run once
  const attrs = [...document.documentElement.attributes].filter((a) => a.name.startsWith('data-bal')).length;
  const roots = document.querySelectorAll('.bal-root').length;
  if (enabled ? roots !== 1 : attrs || roots) {
    return JSON.stringify({ error: `unexpected page state (enabled=${enabled}, attrs=${attrs}, roots=${roots})` });
  }
  return JSON.stringify({ enabled, attrs, roots });
}

/** Undo everything the recording added, so an installed copy of the extension works normally again. */
async function pageTeardown() {
  globalThis.__balRecGuard?.observer?.disconnect();
  delete globalThis.__balRecGuard;
  const c = globalThis.__biliAmbientController;
  if (c) {
    c.settings = { ...c.settings, enabled: false };
    c.renderer.setSettings(c.settings);
    c.update();
  }
  document.getElementById('bal-rec-style')?.remove();
  document.getElementById('bal-dev-css')?.remove();
  document.getElementById('bal-popup-shot')?.remove();
  document.querySelector('.bpx-player-video-wrap video')?.pause();
  return JSON.stringify({ ok: true });
}

/** Seeks to t, waits until the frame is presented, redraws the light (warmup: let bar detection settle). */
async function pageStep({ t, warmup }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrames = () =>
    new Promise((r) => {
      const timer = setTimeout(r, 200);
      requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(timer), r())));
    });
  try {
    const video = document.querySelector('.bpx-player-video-wrap video');
    if (!video) return JSON.stringify({ error: 'video missing' });
    if (!video.paused) video.pause();
    if (Math.abs(video.currentTime - t) > 0.0005) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 15000);
        video.addEventListener('seeked', () => (clearTimeout(timer), resolve()), { once: true });
        video.currentTime = t;
      });
    }
    for (let i = 0; i < 100 && video.readyState < 2; i++) await wait(100);
    if (video.requestVideoFrameCallback) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 250);
        video.requestVideoFrameCallback(() => (clearTimeout(timer), resolve()));
      });
    }
    const renderer = globalThis.__biliAmbientController?.renderer;
    const rounds = warmup ? 4 : 1;
    for (let i = 0; i < rounds; i++) {
      if (renderer?.running) renderer.render(performance.now());
      if (warmup) await wait(550);
    }
    await nextFrames();
    return JSON.stringify({ t: video.currentTime, ready: video.readyState, bars: renderer?.bars });
  } catch (err) {
    return JSON.stringify({ error: String(err?.stack ?? err) });
  }
}

/** Draws frames at several times into one grid image, to pick good start times. */
async function pagePreview({ times }) {
  try {
    const video = document.querySelector('.bpx-player-video-wrap video');
    video.pause();
    const cols = 4;
    const w = 400;
    const h = Math.round((w * video.videoHeight) / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = cols * w;
    canvas.height = Math.ceil(times.length / cols) * h;
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < times.length; i++) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 15000);
        video.addEventListener('seeked', () => (clearTimeout(timer), resolve()), { once: true });
        video.currentTime = times[i];
      });
      await new Promise((r) => setTimeout(r, 150));
      const x = (i % cols) * w;
      const y = Math.floor(i / cols) * h;
      ctx.drawImage(video, x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(x, y, 70, 26);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`${Math.round(times[i])}s`, x + 6, y + 19);
    }
    return JSON.stringify({ image: canvas.toDataURL('image/jpeg', 0.8) });
  } catch (err) {
    return JSON.stringify({ error: String(err?.stack ?? err) });
  }
}

async function pagePopup({ devBase }) {
  try {
    document.getElementById('bal-popup-shot')?.remove();
    const [html, css, settingsJs, popupJs] = await Promise.all(
      ['popup/popup.html', 'popup/popup.css', 'src/settings.js', 'popup/popup.js'].map((p) =>
        fetch(devBase + p).then((r) => r.text())
      )
    );
    const frame = document.createElement('iframe');
    frame.id = 'bal-popup-shot';
    frame.style.cssText =
      'position:fixed;left:40px;top:40px;width:320px;height:760px;z-index:2147483647;border:0;background:#121317';
    document.body.append(frame);
    await new Promise((r) => setTimeout(r, 200));
    const doc = frame.contentDocument;
    const style = doc.createElement('style');
    style.textContent = `${css}\n#controls{max-height:none!important;overflow:visible!important}`;
    doc.head.append(style);
    doc.body.innerHTML = html.match(/<body>([\s\S]*?)<script/)[1].replace('../icons/', devBase + 'icons/');
    frame.contentWindow.eval(settingsJs);
    frame.contentWindow.eval(popupJs);
    await new Promise((r) => setTimeout(r, 600));
    const height = Math.ceil(doc.documentElement.scrollHeight);
    frame.style.height = `${height}px`;
    await new Promise((r) => setTimeout(r, 300));
    const rect = frame.getBoundingClientRect();
    return JSON.stringify({ rect: [rect.x, rect.y, rect.width, rect.height], innerWidth });
  } catch (err) {
    return JSON.stringify({ error: String(err?.stack ?? err) });
  }
}

// ---------------------------------------------------------------- dev server (serves the extension)

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.html': 'text/html' };

async function startDevServer() {
  const server = createServer(async (req, res) => {
    const headers = {
      'Access-Control-Allow-Origin': 'https://www.bilibili.com',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET' });
      return res.end();
    }
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = resolve(EXT_ROOT, rel);
    const allowed = ['src', 'popup', 'icons', 'assets'].some((dir) => file.startsWith(join(EXT_ROOT, dir) + sep));
    if (!allowed) {
      res.writeHead(403, headers);
      return res.end();
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, headers);
      res.end();
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`dev server port ${DEV_PORT} already in use, reusing it`);
        resolveListen();
      } else reject(err);
    });
    server.listen(DEV_PORT, '127.0.0.1', resolveListen);
  });
  return server;
}

// ---------------------------------------------------------------- commands

async function openClip(session, clip) {
  await wb(session, 'navigate', {
    url: `https://www.bilibili.com/video/${clip.bv}`,
    newTab: false,
  });
  await cdp(session, 'Page.bringToFront'); // focus emulation: the tab renders as if visible
  await cdp(session, 'Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  const info = await evaluate(session, pageSetup, { devBase: DEV_BASE, screen: clip.screen });
  console.log(`[${clip.id}] ${JSON.stringify(info)}`);
  return info;
}

async function preview(session, clips) {
  const dir = join(REC_DIR, 'preview');
  await mkdir(dir, { recursive: true });
  for (const clip of clips) {
    const info = await openClip(session, clip);
    const times = Array.from({ length: 12 }, (_, i) => (info.duration * (i + 1)) / 13);
    const { image } = await evaluate(session, pagePreview, { times });
    const file = join(dir, `${clip.id}.jpg`);
    await writeFile(file, Buffer.from(image.split(',')[1], 'base64'));
    console.log(`[${clip.id}] preview -> ${file}`);
  }
}

async function record(session, clips) {
  for (const clip of clips) {
    await openClip(session, clip);
    for (const variant of clip.variants) {
      const dir = join(REC_DIR, 'frames', `${clip.id}-${variant}`);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      await evaluate(session, pageSetEnabled, variant !== 'off');
      const started = performance.now();
      for (let i = 0; i < clip.frames; i++) {
        // Middle of the frame interval avoids landing exactly on a frame boundary.
        const t = clip.start + (i + 0.5) / FPS;
        const step = await evaluate(session, pageStep, { t, warmup: i === 0 });
        await capture(session, join(dir, `${String(i).padStart(5, '0')}.jpg`));
        if (i % 30 === 0 || i === clip.frames - 1) {
          const elapsed = (performance.now() - started) / 1000;
          console.log(`[${clip.id}-${variant}] ${i + 1}/${clip.frames} t=${step.t.toFixed(3)} bars=${JSON.stringify(step.bars)} ${elapsed.toFixed(0)}s`);
        }
      }
    }
  }
}

async function popupShot(session) {
  const clip = CLIPS[0];
  await openClip(session, clip);
  // Taller viewport so the fully expanded popup fits on screen (off-screen parts aren't painted).
  await cdp(session, 'Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: 1600, deviceScaleFactor: 2, mobile: false });
  const { rect, innerWidth } = await evaluate(session, pagePopup, { devBase: DEV_BASE });
  // The page may be zoomed (CSS px != DIP); the capture clip is in DIP.
  const zoom = VIEWPORT.width / innerWidth;
  const [x, y, width, height] = rect.map((v) => v * zoom);
  const file = join(PROMO, 'public', 'popup.png');
  await mkdir(dirname(file), { recursive: true });
  const data = await cdp(session, 'Page.captureScreenshot', {
    format: 'png',
    clip: { x, y, width, height, scale: 1 },
  });
  await writeFile(file, Buffer.from(data.data, 'base64'));
  await evaluate(session, () => (document.getElementById('bal-popup-shot')?.remove(), JSON.stringify({ ok: 1 })));
  await cdp(session, 'Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  console.log(`popup -> ${file}`);
}

async function restore(session) {
  try {
    await evaluate(session, pageTeardown);
    await cdp(session, 'Emulation.clearDeviceMetricsOverride');
    await cdp(session, 'Emulation.setFocusEmulationEnabled', { enabled: false });
  } catch (err) {
    console.warn('restore failed', err.message);
  }
}

async function main() {
  const [command = 'preview', ...rest] = process.argv.slice(2);
  // --session a,b: several WebBridge sessions (one tab each) record different clips in parallel.
  let sessions = ['bili-promo-a'];
  let frames = 0; // --frames N: override the frame count (quick tests)
  const ids = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--session') sessions = rest[++i].split(',').filter(Boolean);
    else if (rest[i] === '--frames') frames = Number(rest[++i]);
    else ids.push(rest[i]);
  }
  const clips = (ids.length ? CLIPS.filter((c) => ids.includes(c.id)) : CLIPS).map((c) =>
    frames > 0 ? { ...c, frames } : c
  );
  if (!clips.length) throw new Error(`unknown clip ids: ${ids.join(', ')}`);

  // Balance clips over the sessions by total frame count.
  const queues = sessions.map((session) => ({ session, clips: [], load: 0 }));
  for (const clip of [...clips].sort((a, b) => b.frames * b.variants.length - a.frames * a.variants.length)) {
    const queue = queues.reduce((min, q) => (q.load < min.load ? q : min));
    queue.clips.push(clip);
    queue.load += clip.frames * clip.variants.length;
  }

  const server = await startDevServer();
  try {
    if (command === 'preview') await preview(sessions[0], clips);
    else if (command === 'record') await Promise.all(queues.map((q) => record(q.session, q.clips)));
    else if (command === 'popup') await popupShot(sessions[0]);
    else throw new Error(`unknown command ${command}`);
  } finally {
    for (const session of sessions) await restore(session);
    server.close();
  }
}

export { wb, cdp, evaluate, openClip, pageSetEnabled, pageStep, pageTeardown, startDevServer };

// Run only when executed directly (the helpers above can be imported for debugging).
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
