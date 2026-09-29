/*
 * Captures Chrome Web Store screenshots (1280x800) of Bilibili pages with the extension.
 * Reuses the recording helpers: the current extension code is injected into the page and any
 * installed copy is kept out of the picture.
 *
 * Usage (from promo/): node scripts/store-shots.mjs [--session name] [shotId ...]
 * Output: ../store/screenshots/*.png, plus promo/public/store/ sources for composed shots.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS, cdp, evaluate, openClip, pageSetEnabled, pageStep, pageTeardown, startDevServer } from './record.mjs';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_DIR = join(PROMO, '..', 'store', 'screenshots');
const SOURCE_DIR = join(PROMO, 'public', 'store'); // inputs for Remotion-composed images
const DEV_BASE = 'http://127.0.0.1:8765/';
// Captured at 1600x1000 (a typical desktop layout) and scaled to the store size 1280x800.
const CAPTURE = { width: 1600, height: 1000 };
const SCALE = 0.8;

const SHOTS = [
  // Sources for the before/after screenshot (composed by the StoreCompare still in Remotion)
  { id: 'kda-off', clip: 'kda', t: 135.5, enabled: false, dir: SOURCE_DIR },
  { id: 'kda-on', clip: 'kda', t: 135.5, enabled: true, dir: SOURCE_DIR },
  { id: '2-sky', clip: 'sky', t: 22.5, enabled: true, dir: STORE_DIR },
  { id: '3-cinema', clip: 'cinema', t: 282.5, enabled: true, dir: STORE_DIR },
  { id: '4-wide', clip: 'landscape', t: 524, enabled: true, dir: STORE_DIR }, // no burned-in subtitle here
  { id: '5-settings', clip: 'jinx', t: 122.3, enabled: true, popup: true, dir: STORE_DIR },
];

/**
 * Hides what doesn't belong in a public listing: overlays of other extensions (they attach
 * directly to <html>, e.g. WebBridge, Immersive Translate), the scrollbar, and the logged-in
 * user's avatar and notification counts.
 */
function pageStoreStyle() {
  let style = document.getElementById('bal-store-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'bal-store-style';
    document.head.append(style);
  }
  {
    // Always rewritten, so a copy left over from an older run can't win.
    style.textContent = `
      html > div, #bewly, #bilibiliHelper2HandleButtonWrapper { display: none !important; }
      html { scrollbar-width: none !important; }
      .header-avatar-wrap, .header-avatar-wrap--container { visibility: hidden !important; }
      .red-num, .red-point, .right-entry .num { display: none !important; }
      .bpx-player-subtitle-wrap { opacity: 0 !important; }
      #slide_ad, .ad-report, .video-card-ad-small, .ad-floor-exp, .right-bottom-banner,
      .strip-ad, .activity-m-v1, .video-page-game-card-small { display: none !important; }
    `;
  }
  // Ad cards change class names often; they all carry a "广告" badge, so hide by that.
  for (const leaf of document.querySelectorAll('.left-container *, .right-container *')) {
    if (leaf.childElementCount || leaf.textContent.trim() !== '广告') continue;
    const card = leaf.closest('.video-page-card-small, .video-card-ad-small, .ad-report, [class*="card"]');
    card?.style.setProperty('display', 'none', 'important');
  }
  // The WebBridge overlay forces itself visible with an inline !important and lives in a shadow
  // root, so page CSS can't reach it. Hide its content from inside instead.
  const overlay = document.getElementById('kimi-webbridge-agent-visuals')?.shadowRoot;
  if (overlay && !overlay.getElementById('bal-store-hide')) {
    const style = document.createElement('style');
    style.id = 'bal-store-hide';
    style.textContent = '* { display: none !important; }';
    overlay.append(style);
  }
  const bewly = document.getElementById('bewly');
  return JSON.stringify({
    ok: true,
    styleConnected: Boolean(document.getElementById('bal-store-style')?.isConnected),
    overlay: Boolean(overlay),
    bewlyDisplay: bewly ? getComputedStyle(bewly).display : 'absent',
  });
}

/** Shows the real popup UI (default settings) where Chrome opens it: top right, under the toolbar. */
async function pageShowPopup({ devBase }) {
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
      'position:fixed;right:24px;top:10px;width:320px;height:600px;z-index:2147483647;border:0;' +
      'border-radius:10px;background:#121317;box-shadow:0 18px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.1)';
    document.body.append(frame);
    await new Promise((r) => setTimeout(r, 200));
    const doc = frame.contentDocument;
    const style = doc.createElement('style');
    style.textContent = css;
    doc.head.append(style);
    doc.body.innerHTML = html.match(/<body>([\s\S]*?)<script/)[1].replace('../icons/', devBase + 'icons/');
    frame.contentWindow.eval(settingsJs);
    frame.contentWindow.eval(popupJs);
    await new Promise((r) => setTimeout(r, 600));
    frame.style.height = `${Math.ceil(doc.documentElement.scrollHeight)}px`;
    await new Promise((r) => setTimeout(r, 300));
    return JSON.stringify({ height: frame.style.height });
  } catch (err) {
    return JSON.stringify({ error: String(err?.stack ?? err) });
  }
}

async function capture(session, file) {
  // Warm-up captures: the first capture after a change can return a stale compositor frame.
  for (let i = 0; i < 2; i++) await cdp(session, 'Page.captureScreenshot', { format: 'png' });
  const data = await cdp(session, 'Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, ...CAPTURE, scale: SCALE },
  });
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data.data, 'base64'));
}

async function main() {
  const args = process.argv.slice(2);
  let session = 'bili-promo-a';
  const ids = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session') session = args[++i];
    else ids.push(args[i]);
  }
  const shots = ids.length ? SHOTS.filter((s) => ids.includes(s.id)) : SHOTS;
  if (!shots.length) throw new Error(`unknown shot ids: ${ids.join(', ')}`);

  const server = await startDevServer();
  let openedClip = null;
  try {
    for (const shot of shots) {
      const clip = CLIPS.find((c) => c.id === shot.clip);
      if (openedClip !== clip.id) {
        await openClip(session, clip);
        await cdp(session, 'Emulation.setDeviceMetricsOverride', { ...CAPTURE, deviceScaleFactor: 1, mobile: false });
        await evaluate(session, pageStoreStyle);
        await new Promise((r) => setTimeout(r, 1500)); // relayout at the new size
        openedClip = clip.id;
      }
      await evaluate(session, pageSetEnabled, shot.enabled);
      await evaluate(session, pageStep, { t: shot.t, warmup: true });
      if (shot.popup) await evaluate(session, pageShowPopup, { devBase: DEV_BASE });
      // Re-apply right before capturing: the page or the overlay may have been re-rendered meanwhile.
      const state = await evaluate(session, pageStoreStyle);
      if (!state.styleConnected || !['none', 'absent'].includes(state.bewlyDisplay)) {
        throw new Error(`store style not active: ${JSON.stringify(state)}`);
      }
      const file = join(shot.dir, `${shot.id}.png`);
      await capture(session, file);
      console.log(`${shot.id} -> ${file}`);
    }
  } finally {
    try {
      await evaluate(session, pageTeardown);
      await evaluate(session, () => {
        document.getElementById('bal-store-style')?.remove();
        document.getElementById('kimi-webbridge-agent-visuals')?.shadowRoot?.getElementById('bal-store-hide')?.remove();
        return JSON.stringify({ ok: 1 });
      });
      await cdp(session, 'Emulation.clearDeviceMetricsOverride');
      await cdp(session, 'Emulation.setFocusEmulationEnabled', { enabled: false });
    } catch (err) {
      console.warn('restore failed', err.message);
    }
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
