/*
 * Captures the public Chrome Web Store pages of the extension for the promo's "get it in the store"
 * scene: the search page (plus the search box at every step of typing the query) and the full
 * detail page, with the positions of everything the scene animates (src/store-page.json).
 *
 * Browser extensions (including Kimi WebBridge) are not allowed to script Web Store pages, so this
 * drives Remotion's own headless Chrome over the DevTools protocol instead. It runs logged out, in
 * a throwaway profile, so no personal account data shows up.
 *
 * Usage (from promo/): node scripts/store-page.mjs [--proxy http://127.0.0.1:10808]
 * Output: public/store/cws-*.png, src/store-page.json
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = join(
  PROMO,
  'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe'
);
const PORT = 9333;
const ITEM_ID = 'jeooggamefikdijnbfbabphhffbmmjkn';
const QUERY = 'B站氛围光';
const SEARCH_URL = `https://chromewebstore.google.com/search/${encodeURIComponent(QUERY)}?hl=zh-CN`;
const DETAIL_URL = `https://chromewebstore.google.com/detail/${ITEM_ID}?hl=zh-CN`;
// Same layout as the Bilibili recordings (1745x982 CSS px at 110% zoom = 1920x1080), captured at
// twice that density so the scene can zoom in and stay sharp.
const VIEW = { width: 1745, height: 982, deviceScaleFactor: 2.2 };
const MAX_DETAIL_HEIGHT = 2600; // CSS px of the detail page to keep (for the scroll animation)
const TAB_COLOR = '#35363a'; // tab background of the promo's BrowserFrame, behind the favicon

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const argv = process.argv.slice(2);
  let proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--proxy') proxy = argv[++i];
  return { proxy };
}

/** Minimal CDP client over the page's WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)) : ok(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, fail) => pending.set(id, { resolve: ok, reject: fail }));
    },
    once(method) {
      return new Promise((ok) => {
        const fn = (params) => {
          listeners.get(method).delete(fn);
          ok(params);
        };
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method).add(fn);
      });
    },
    close: () => ws.close(),
  };
}

async function evaluate(cdp, fn, arg = null) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(${fn.toString()})(${JSON.stringify(arg)})`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(30000)]);
  // The store is a client-rendered app: wait until the item title is on the page.
  const ok = await evaluate(cdp, async () => {
    for (let i = 0; i < 100; i++) {
      if (document.body?.innerText.includes('Ambient Light for Bilibili')) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  });
  if (!ok) throw new Error(`item not found on ${url}`);
  await sleep(2500); // images and fonts
}

/** PNG of a region given in CSS px (document coordinates of the unscrolled page). */
async function shoot(cdp, file, clip = null) {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  if (clip && clip.y + clip.height > VIEW.height) params.captureBeyondViewport = true;
  const { data } = await cdp.send('Page.captureScreenshot', params);
  await writeFile(file, Buffer.from(data, 'base64'));
}

// ---------------------------------------------------------------- page functions (run in the tab)

/** Bounding box of the search result card (CSS px, document coordinates). */
function findSearchCard(itemId) {
  const link = document.querySelector(`a[href*="${itemId}"]`);
  const card = link?.closest('div[role="listitem"], li, article') ?? link;
  const r = card?.getBoundingClientRect();
  return r ? { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height } : null;
}

/**
 * The search field: the input holding the query and the pill-shaped box around it, plus where the
 * text caret sits after each prefix of the query (the promo draws the caret itself).
 */
function searchBoxInfo(query) {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  };
  const input = [...document.querySelectorAll('input')].find((i) => i.value === query);
  if (!input) return null;
  const ir = input.getBoundingClientRect();
  let box = input;
  for (let p = input.parentElement; p && p !== document.body; p = p.parentElement) {
    const r = p.getBoundingClientRect();
    if (r.height > 72 || r.width > 760) break;
    box = p;
  }
  const cs = getComputedStyle(input);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const textLeft = ir.left + scrollX + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const chars = [...query];
  const carets = chars.map((_, i) => textLeft + ctx.measureText(chars.slice(0, i + 1).join('')).width);
  return {
    input: rect(input),
    box: rect(box),
    fontSize: parseFloat(cs.fontSize),
    textColor: cs.color,
    caretStart: textLeft,
    carets, // caret x after 1..n characters
  };
}

/** Types a prefix of the query into the field (value only: no events, so the app does not react). */
function setSearchText({ query, text }) {
  const input = [...document.querySelectorAll('input')].find((i) => i.value === query || i.dataset.balSearch);
  if (!input) return false;
  input.dataset.balSearch = '1';
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
  input.blur();
  // The clear button (right of the text) only belongs to a non-empty field.
  const ir = input.getBoundingClientRect();
  let box = input;
  for (let p = input.parentElement; p && p !== document.body; p = p.parentElement) {
    const r = p.getBoundingClientRect();
    if (r.height > 72 || r.width > 760) break;
    box = p;
  }
  for (const b of box.querySelectorAll('button, [role="button"]')) {
    if (b.getBoundingClientRect().left >= ir.right - 4) b.style.visibility = text ? '' : 'hidden';
  }
  return true;
}

/** Hides the search results with a style rule (survives the app re-rendering the card). */
function hideResults(itemId) {
  const style = document.createElement('style');
  style.id = 'bal-hide-results';
  style.textContent = `
    a[href*="${itemId}"], :is(div[role="listitem"], li, article):has(a[href*="${itemId}"]) {
      visibility: hidden !important;
    }`;
  document.head.append(style);
  // The link may be an overlay on top of the card, so also hide the card box around it: the
  // largest ancestor that is still about the link's size.
  const link = document.querySelector(`a[href*="${itemId}"]`);
  if (!link) return null;
  const lr = link.getBoundingClientRect();
  let card = link;
  for (let p = link.parentElement; p && p !== document.body; p = p.parentElement) {
    const r = p.getBoundingClientRect();
    if (r.width > lr.width + 40 || r.height > lr.height + 40) break;
    card = p;
  }
  card.setAttribute('data-bal-hide', '');
  style.textContent += '\n[data-bal-hide] { visibility: hidden !important; }';
  return { tag: card.tagName, width: card.getBoundingClientRect().width, visibility: getComputedStyle(card).visibility };
}

function findInstallButton() {
  const buttons = [...document.querySelectorAll('button, a[role="button"]')];
  const btn = buttons.find((b) => /添加至\s*Chrome|Add to Chrome|在\s*Chrome\s*中/.test(b.innerText || b.getAttribute('aria-label') || ''));
  const r = btn?.getBoundingClientRect();
  return r
    ? {
        x: r.x + scrollX,
        y: r.y + scrollY,
        width: r.width,
        height: r.height,
        label: (btn.innerText || '').trim(),
        disabled: btn.disabled || btn.getAttribute('aria-disabled') === 'true',
        background: getComputedStyle(btn).backgroundColor,
        radius: getComputedStyle(btn).borderTopLeftRadius,
      }
    : null;
}

/**
 * Headless Chrome lacks the private Web Store API, so the install button renders disabled (grey).
 * Give it the look it has in a normal Chrome (filled blue), which is what viewers will see.
 */
function styleInstallButton() {
  const btn = [...document.querySelectorAll('button')].find((b) => /添加至\s*Chrome/.test(b.innerText));
  if (!btn) return false;
  btn.disabled = false;
  btn.removeAttribute('aria-disabled');
  btn.style.setProperty('background', '#0b57d0', 'important');
  btn.style.setProperty('color', '#fff', 'important');
  for (const el of btn.querySelectorAll('*')) el.style.setProperty('color', '#fff', 'important');
  return true;
}

/** Positions on the detail page the scene points at, and whether the top bar stays put on scroll. */
function detailInfo() {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  };
  // Innermost element containing the text (it may also hold a link, so it isn't always a leaf).
  const leaf = (re) =>
    [...document.querySelectorAll('body *')].filter((el) => re.test(el.textContent) && el.textContent.length < 200).pop();
  // Grow a text node's element to its whole line (e.g. icon + sentence), staying one line tall.
  const line = (el, maxHeight) => {
    let box = el;
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.getBoundingClientRect().height > maxHeight) break;
      box = p;
    }
    return box;
  };
  const privacy = leaf(/不会收集或使用您的数据/);
  const headings = {};
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    const text = h.textContent.trim();
    if (text.length <= 12 && h.getBoundingClientRect().height > 0) headings[text] = rect(h);
  }
  const pinned = [];
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 20) continue;
    pinned.push({ pos, tag: el.tagName, ...rect(el) });
  }
  return {
    title: document.title,
    h1: rect(document.querySelector('h1')),
    privacy: rect(line(privacy, 40)),
    headings,
    pinned: pinned.slice(0, 10),
    height: Math.ceil(document.documentElement.scrollHeight),
  };
}

/**
 * Hides the scrollbar, plus the "use Chrome instead" prompts that only appear because this is a
 * headless browser (a normal Chrome user never sees them).
 */
function cleanPage() {
  const style = document.createElement('style');
  style.textContent = 'html { scrollbar-width: none !important; } * { caret-color: transparent !important; }';
  document.head.append(style);
  const removed = [];
  const hideContaining = (pattern, maxWidth, maxHeight) => {
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount || !pattern.test(el.textContent)) continue;
      // Walk up to the prompt's own box: the largest ancestor that still fits the prompt's size,
      // so page chrome around it (header, search bar) stays visible.
      let box = el;
      for (let p = box.parentElement; p; p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if (r.width > maxWidth || r.height > maxHeight) break;
        box = p;
      }
      const r = box.getBoundingClientRect();
      removed.push(`${pattern.source} -> ${box.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
      box.style.setProperty('display', 'none', 'important');
      return;
    }
  };
  hideContaining(/改用\s*Chrome/, 460, 320);
  hideContaining(/切换到\s*Chrome\s*即可安装/, 1100, 90);
  return removed;
}

/** Puts the page's favicon in the top-left corner on the promo's tab color, to be captured. */
async function showFavicon(background) {
  const link = [...document.querySelectorAll('link[rel~="icon"]')].pop();
  if (!link) return null;
  const holder = document.createElement('div');
  holder.id = 'bal-favicon';
  holder.style.cssText = `position:fixed;left:0;top:0;width:64px;height:64px;z-index:2147483647;background:${background}`;
  const img = document.createElement('img');
  img.src = link.href;
  img.style.cssText = 'width:64px;height:64px;display:block';
  holder.append(img);
  document.body.append(holder);
  await new Promise((r) => {
    img.onload = r;
    img.onerror = r;
    setTimeout(r, 5000);
  });
  return { href: link.href, loaded: img.naturalWidth > 0 };
}

// ---------------------------------------------------------------- main

async function main() {
  const { proxy } = parseArgs();
  const profile = await mkdtemp(join(tmpdir(), 'cws-shot-'));
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--lang=zh-CN',
    '--hide-scrollbars',
    '--no-first-run',
    `--window-size=${VIEW.width},${VIEW.height}`,
  ];
  if (proxy) args.push(`--proxy-server=${proxy}`);
  args.push('about:blank');
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', (c) => (chromeLog = (chromeLog + c).slice(-2000)));

  try {
    let target = null;
    let lastError = null;
    for (let i = 0; i < 75 && !target; i++) {
      await sleep(200);
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
        target = list.find((t) => t.type === 'page');
        if (!target && i > 10) {
          target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
        }
      } catch (err) {
        lastError = err;
      }
    }
    if (!target) throw new Error(`headless Chrome did not start: ${lastError?.message ?? ''}\n${chromeLog}`);
    const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Look like a regular desktop Chrome (the store shows install buttons only to Chrome).
    const full = String(version.Browser).split('/')[1] ?? '140.0.0.0';
    const major = full.split('.')[0];
    // The store checks the Client Hints brands, not only the UA string.
    const brands = [
      { brand: 'Google Chrome', version: major },
      { brand: 'Chromium', version: major },
      { brand: 'Not=A?Brand', version: '24' },
    ];
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`,
      acceptLanguage: 'zh-CN,zh;q=0.9',
      platform: 'Win32',
      userAgentMetadata: {
        brands,
        fullVersionList: brands.map((b) => ({ ...b, version: b.brand === 'Not=A?Brand' ? '24.0.0.0' : full })),
        fullVersion: full,
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
      },
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, mobile: false });

    const outDir = join(PROMO, 'public', 'store');
    await mkdir(outDir, { recursive: true });
    const meta = { zoom: VIEW.deviceScaleFactor, viewport: { width: VIEW.width, height: VIEW.height }, query: QUERY };

    // 1. Search results page, the search box while typing, and the page before results show up
    await navigate(cdp, SEARCH_URL);
    meta.cleaned = await evaluate(cdp, cleanPage);
    meta.searchTitle = await evaluate(cdp, () => document.title);
    meta.searchUrl = await evaluate(cdp, () => decodeURI(location.href));
    meta.searchCard = await evaluate(cdp, findSearchCard, ITEM_ID);
    meta.searchBox = await evaluate(cdp, searchBoxInfo, QUERY);
    if (!meta.searchCard || !meta.searchBox) throw new Error(`search page layout not recognized: ${JSON.stringify(meta)}`);
    await shoot(cdp, join(outDir, 'cws-search.png'));

    meta.favicon = await evaluate(cdp, showFavicon, TAB_COLOR);
    if (meta.favicon?.loaded) await shoot(cdp, join(outDir, 'cws-favicon.png'), { x: 0, y: 0, width: 64, height: 64 });
    await evaluate(cdp, () => (document.getElementById('bal-favicon')?.remove(), true));

    // The page before searching: empty field (placeholder), no results yet
    meta.resultsHidden = await evaluate(cdp, hideResults, ITEM_ID);
    await evaluate(cdp, setSearchText, { query: QUERY, text: '' });
    await sleep(300);
    await shoot(cdp, join(outDir, 'cws-search-empty.png'));

    // The search box after each typed character
    const { box } = meta.searchBox;
    const chars = [...QUERY];
    for (let i = 0; i <= chars.length; i++) {
      await evaluate(cdp, setSearchText, { query: QUERY, text: chars.slice(0, i).join('') });
      await sleep(150);
      await shoot(cdp, join(outDir, `cws-type-${i}.png`), box);
    }

    // 2. Detail page, captured taller than the viewport so the scene can scroll through it
    await navigate(cdp, DETAIL_URL);
    meta.cleaned.push(...(await evaluate(cdp, cleanPage)));
    meta.buttonRestyled = await evaluate(cdp, styleInstallButton);
    await sleep(300);
    meta.installButton = await evaluate(cdp, findInstallButton);
    meta.detail = await evaluate(cdp, detailInfo);
    meta.detailUrl = await evaluate(cdp, () => decodeURI(location.href));
    meta.detailHeight = Math.min(MAX_DETAIL_HEIGHT, meta.detail.height);
    await shoot(cdp, join(outDir, 'cws-detail.png'), { x: 0, y: 0, width: VIEW.width, height: meta.detailHeight });

    await writeFile(join(PROMO, 'src', 'store-page.json'), JSON.stringify(meta, null, 1));
    console.log(JSON.stringify(meta, null, 1));
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
