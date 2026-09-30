import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { BrowserFrame, Caption, GlowBackground } from './components';
import store from './store-page.json';
import { BLUE, PINK } from './theme';

/*
 * "Get it in the store": the real Chrome Web Store pages (captured by scripts/store-page.mjs)
 * replayed like a screen recording. Type the name, open the result, click 添加至 Chrome, scroll to
 * the privacy section. A camera zooms in on whatever is being used so the page text stays legible.
 *
 * Page positions come from src/store-page.json in CSS px of the captured 1745x982 viewport.
 */

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.65, 0, 0.35, 1);

const WIN_W = 1560;
const WIN_TOP = 60;
const VIEW = store.viewport;
const K = WIN_W / VIEW.width; // screen px per page CSS px while the camera is at rest
const BAR_H = Math.round(WIN_W * 0.034); // BrowserFrame toolbar height
/** Screen position of the page's top-left corner (window centered, 1 px frame border). */
const ORIGIN = { x: (1920 - WIN_W) / 2, y: WIN_TOP + 1 + BAR_H };
const HEADER_H = store.detail.pinned.find((p) => p.tag === 'HEADER')?.height ?? 0; // fixed top bar

const box = store.searchBox.box;
const card = store.searchCard;
const btn = store.installButton;
const h1 = store.detail.h1;
const privacy = store.detail.privacy;
const QUERY_LENGTH = store.searchBox.carets.length;
/** Scroll position that puts the privacy statement a bit above the middle of the viewport. */
const SCROLL = Math.min(store.detailHeight - VIEW.height, privacy.y + privacy.height / 2 - VIEW.height * 0.47);

const shortUrl = (url: string) => url.replace(/^https:\/\//, '').replace(/\?.*$/, '');
const HOME_URL = 'chromewebstore.google.com';
const SEARCH_URL = shortUrl(store.searchUrl);
const DETAIL_URL = shortUrl(store.detailUrl);

type Key = { f: number; [param: string]: number };

/** Eased keyframe track. Params listed in `logParams` (zoom) interpolate in log space. */
function track(keys: Key[], frame: number, logParams: string[] = []): Record<string, number> {
  let i = 0;
  while (i < keys.length - 1 && frame >= keys[i + 1].f) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const t = b.f > a.f ? ease(Math.min(1, Math.max(0, (frame - a.f) / (b.f - a.f)))) : 0;
  const out: Record<string, number> = {};
  for (const k of Object.keys(a)) {
    if (k === 'f') continue;
    out[k] = logParams.includes(k) ? Math.exp(Math.log(a[k]) + (Math.log(b[k]) - Math.log(a[k])) * t) : a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Page rectangle (CSS px, viewport coordinates) -> absolutely positioned style inside the window. */
const place = (x: number, y: number, width: number, height: number, pad = 0): React.CSSProperties => ({
  position: 'absolute',
  left: (x - pad) * K,
  top: (y - pad) * K,
  width: (width + pad * 2) * K,
  height: (height + pad * 2) * K,
});

/** Glowing ring that marks what the viewer should look at. */
const Ring: React.FC<{ rect: React.CSSProperties; radius: number; opacity: number; pulse?: number }> = ({
  rect,
  radius,
  opacity,
  pulse = 0,
}) =>
  opacity > 0 ? (
    <div
      style={{
        ...rect,
        borderRadius: radius,
        border: `${3 + pulse * 1.5}px solid ${PINK}`,
        boxShadow: `0 0 ${18 + pulse * 16}px ${PINK}aa, 0 0 ${36 + pulse * 20}px ${BLUE}66`,
        opacity,
        boxSizing: 'border-box',
      }}
    />
  ) : null;

/** `zoom`: current camera zoom; the cursor grows with it, but only by its square root. */
const Cursor: React.FC<{ x: number; y: number; opacity: number; pressed: boolean; zoom: number }> = ({
  x,
  y,
  opacity,
  pressed,
  zoom,
}) => (
  <svg
    width={30}
    height={45}
    viewBox="0 0 16 24"
    style={{
      position: 'absolute',
      left: x * K - 2,
      top: y * K - 2,
      opacity,
      transform: `scale(${(pressed ? 0.86 : 1) / Math.sqrt(zoom)})`,
      transformOrigin: '2px 2px',
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
    }}
  >
    <path d="M1 1 L1 18.6 L5.3 14.7 L8.1 21.6 L11 20.4 L8.2 13.7 L14.2 13.7 Z" fill="#fff" stroke="#111" strokeWidth={1.1} strokeLinejoin="round" />
  </svg>
);

const Ripple: React.FC<{ frame: number; at: number; x: number; y: number }> = ({ frame, at, x, y }) => {
  const t = frame - at;
  if (t < 0 || t > 16) return null;
  const r = interpolate(t, [0, 16], [8, 34]);
  const o = interpolate(t, [0, 16], [0.6, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        left: x * K - r,
        top: y * K - r,
        width: r * 2,
        height: r * 2,
        borderRadius: '50%',
        background: `rgba(11, 87, 208, ${o * 0.35})`,
        border: `2px solid rgba(11, 87, 208, ${o})`,
        boxSizing: 'border-box',
      }}
    />
  );
};

/** `beat`: frames per beat; `lead`: frames before the scene's first beat (half the crossfade). */
export const StoreScene: React.FC<{ beat: number; lead: number }> = ({ beat, lead }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const b = (n: number) => lead + n * beat;
  const T = {
    focusBox: b(0.9), // click into the search field
    typeStart: b(1), // first character, then one every 4 frames
    enter: b(2), // results show up
    clickCard: b(4),
    detail: b(4) + 3, // detail page fades in
    clickButton: b(6),
    scrollStart: b(7.6),
    scrollEnd: b(10),
  };

  // ---- camera: focus point (page CSS px) placed at screen point (cx, cy), zoomed by s
  const rest = { s: 1, x: VIEW.width / 2, y: VIEW.height / 2, cx: ORIGIN.x + (VIEW.width / 2) * K, cy: ORIGIN.y + (VIEW.height / 2) * K };
  const onBox = { s: 2.2, x: box.x + box.width / 2, y: box.y + box.height / 2, cx: 960, cy: 320 };
  const onResults = { s: 1.45, x: card.x + card.width / 2 - 60, y: (box.y + card.y + card.height) / 2, cx: 960, cy: 480 };
  const onButtonRow = { s: 1.6, x: (h1.x + btn.x + btn.width) / 2, y: btn.y + btn.height / 2, cx: 960, cy: 420 };
  const onPrivacy = { s: 1.25, x: VIEW.width / 2, y: privacy.y + privacy.height / 2 - SCROLL, cx: 960, cy: 470 };
  const cam = track(
    [
      { f: 0, ...rest },
      { f: 12, ...rest },
      { f: T.typeStart, ...onBox },
      { f: T.enter + 4, ...onBox },
      { f: T.enter + 22, ...onResults },
      { f: T.clickCard + 2, ...onResults },
      { f: T.clickCard + 20, ...onButtonRow },
      { f: T.clickButton + 14, ...onButtonRow },
      { f: T.scrollStart, ...rest },
      { f: T.scrollEnd, ...rest },
      { f: T.scrollEnd + 22, ...onPrivacy },
    ],
    frame,
    ['s']
  );
  const focus = { x: ORIGIN.x + cam.x * K, y: ORIGIN.y + cam.y * K };
  const camera = `translate(${cam.cx}px, ${cam.cy}px) scale(${cam.s}) translate(${-focus.x}px, ${-focus.y}px)`;
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });

  // ---- cursor (page CSS px)
  const onButton = { x: btn.x + btn.width * 0.55, y: btn.y + btn.height * 0.58 };
  const pointer = track(
    [
      { f: 8, x: 1240, y: 430 },
      { f: T.focusBox - 2, x: 940, y: 33 },
      { f: T.enter + 8, x: 940, y: 33 },
      { f: T.clickCard - 7, x: 870, y: 188 },
      { f: T.clickCard + 14, x: 870, y: 188 },
      { f: T.clickButton - 7, ...onButton },
      { f: T.clickButton + 16, ...onButton },
      { f: T.scrollStart + 10, x: 1450, y: 420 },
    ],
    frame
  );
  const clicks = [T.focusBox, T.clickCard, T.clickButton];
  const pressed = clicks.some((c) => frame >= c && frame < c + 4);
  const cursorOpacity = interpolate(frame, [8, 14], [0, 1], clamp);

  // ---- search page state
  const typed = frame < T.typeStart ? 0 : Math.min(QUERY_LENGTH, Math.floor((frame - T.typeStart) / 4) + 1);
  const focused = frame >= T.focusBox && frame < T.enter;
  const typing = frame >= T.typeStart && frame < T.typeStart + QUERY_LENGTH * 4 + 8;
  const caretOn = focused && (typing || Math.floor((frame - T.focusBox) / 16) % 2 === 0);
  const caretX = typed === 0 ? store.searchBox.caretStart : store.searchBox.carets[typed - 1];
  const input = store.searchBox.input;
  const fontSize = store.searchBox.fontSize;
  const results = interpolate(frame, [T.enter, T.enter + 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const cardRing = interpolate(frame, [T.clickCard - 12, T.clickCard - 6], [0, 1], clamp);

  // ---- detail page state
  const detail = interpolate(frame, [T.detail, T.detail + 8], [0, 1], clamp);
  const scroll = interpolate(frame, [T.scrollStart, T.scrollEnd], [0, SCROLL], { ...clamp, easing: ease });
  const hover = interpolate(frame, [T.clickButton - 9, T.clickButton - 5], [0, 1], clamp);
  const press = interpolate(frame, [T.clickButton, T.clickButton + 2, T.clickButton + 6], [0, 1, 0], clamp);
  const btnRing =
    interpolate(frame, [T.clickButton, T.clickButton + 6], [0, 1], clamp) *
    interpolate(frame, [T.scrollStart - 6, T.scrollStart + 8], [1, 0], clamp);
  const btnPulse = 0.5 + 0.5 * Math.cos(((frame - T.clickButton) / beat) * Math.PI * 2);
  const privacyRing = interpolate(frame, [T.scrollEnd - 4, T.scrollEnd + 6], [0, 1], clamp);

  const phase = frame < T.enter ? 0 : frame < T.detail + 4 ? 1 : 2;
  const url = [HOME_URL, SEARCH_URL, DETAIL_URL][phase];
  const title = ['Chrome 应用商店', store.searchTitle, store.detail.title][phase];

  return (
    <AbsoluteFill>
      <GlowBackground />
      <AbsoluteFill style={{ transform: camera, transformOrigin: '0 0' }}>
        <div
          style={{
            position: 'absolute',
            left: ORIGIN.x - 1,
            top: WIN_TOP,
            opacity: enter,
            transform: `scale(${0.95 + enter * 0.05})`,
          }}
        >
          <BrowserFrame url={url} title={title} width={WIN_W} favicon="store/cws-favicon.png">
            <AbsoluteFill style={{ overflow: 'hidden', background: '#fff' }}>
              {/* Search page: empty field -> typed query -> the result card */}
              {detail < 1 ? (
                <AbsoluteFill>
                  <Img src={staticFile('store/cws-search-empty.png')} style={{ position: 'absolute', left: 0, top: 0, width: WIN_W }} />
                  <div
                    style={{
                      ...place(card.x, card.y, card.width, card.height),
                      overflow: 'hidden',
                      opacity: results,
                      transform: `translateY(${(1 - results) * 16}px)`,
                    }}
                  >
                    <Img
                      src={staticFile('store/cws-search.png')}
                      style={{ position: 'absolute', left: -card.x * K, top: -card.y * K, width: WIN_W }}
                    />
                  </div>
                  <Img src={staticFile(`store/cws-type-${typed}.png`)} style={place(box.x, box.y, box.width, box.height)} />
                  {caretOn ? (
                    <div
                      style={{
                        ...place(caretX, input.y + input.height / 2 - fontSize * 0.62, 1.4, fontSize * 1.24),
                        background: store.searchBox.textColor,
                      }}
                    />
                  ) : null}
                  <Ring rect={place(card.x, card.y, card.width, card.height, 6)} radius={22 * K} opacity={cardRing * (1 - detail)} />
                </AbsoluteFill>
              ) : null}

              {/* Detail page, scrolled; its top bar is fixed */}
              {detail > 0 ? (
                <AbsoluteFill style={{ opacity: detail }}>
                  <Img src={staticFile('store/cws-detail.png')} style={{ position: 'absolute', left: 0, top: -scroll * K, width: WIN_W }} />
                  <div style={{ position: 'absolute', left: 0, top: 0, width: WIN_W, height: HEADER_H * K, overflow: 'hidden' }}>
                    <Img src={staticFile('store/cws-detail.png')} style={{ position: 'absolute', left: 0, top: 0, width: WIN_W }} />
                  </div>
                  <div
                    style={{
                      ...place(btn.x, btn.y - scroll, btn.width, btn.height),
                      borderRadius: 20 * K,
                      background: `rgba(255,255,255,${hover * 0.12})`,
                      boxShadow: hover > 0 ? `0 ${2 * hover}px ${6 * hover}px rgba(11,87,208,.35)` : undefined,
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 0, borderRadius: 20 * K, background: `rgba(0,0,0,${press * 0.14})` }} />
                  </div>
                  <Ring
                    rect={place(btn.x, btn.y - scroll, btn.width, btn.height, 6)}
                    radius={26 * K}
                    opacity={btnRing}
                    pulse={btnPulse}
                  />
                  <Ring rect={place(privacy.x, privacy.y - scroll, privacy.width, privacy.height, 10)} radius={14 * K} opacity={privacyRing} />
                </AbsoluteFill>
              ) : null}

              {clicks.map((at) => (
                <Ripple key={at} frame={frame} at={at} x={pointer.x} y={pointer.y} />
              ))}
              <Cursor x={pointer.x} y={pointer.y} opacity={cursorOpacity} pressed={pressed} zoom={cam.s} />
            </AbsoluteFill>
          </BrowserFrame>
        </div>
      </AbsoluteFill>
      {/* No corner watermark here: the zoomed-in white page would swallow its white text. */}
      <Caption title="在 Chrome 应用商店搜索「B站氛围光」" subtitle="Chrome 和 Edge 浏览器都能安装" delay={12} exitAt={T.clickCard - 6} />
      <Caption
        title="点击「添加至 Chrome」，免费安装"
        subtitle="装好后打开任意 B 站视频，氛围光自动亮起"
        delay={T.clickCard + 6}
        exitAt={b(8) - 6}
      />
      <Caption title="完全本地运行，不收集任何数据" subtitle="商店隐私权声明：此产品不会收集或使用您的数据" delay={b(8) + 2} />
    </AbsoluteFill>
  );
};
