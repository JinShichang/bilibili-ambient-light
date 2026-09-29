// Generates the extension's PNG assets (icons + dithering noise) without dependencies.
// Usage: node tools/generate-assets.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ PNG encoding

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function writePng(relPath, width, height, rgba) {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePng(width, height, rgba));
  console.log(`wrote ${relPath}`);
}

// ------------------------------------------------------------------ icon

const mix = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => a.map((v, i) => mix(v, b[i], t));
const PINK = [251, 114, 153];
const BLUE = [0, 174, 236];

/** Signed distance to a rounded rectangle centered at (cx, cy). */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, ax, ay, bx, by) {
  const px = x - ax;
  const py = y - ay;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t);
}

function insideTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Color + alpha of the icon at normalized coordinates (u, v). */
function iconSample(u, v) {
  if (sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.22) > 0) return null;

  // Dark tile with the ambient glow around the "TV screen".
  let color = mixColor([18, 19, 28], [10, 10, 16], v);
  const screen = sdRoundRect(u, v, 0.5, 0.58, 0.27, 0.19, 0.07);
  const glowColor = mixColor(PINK, BLUE, Math.min(1, Math.max(0, (u - 0.1) / 0.8)));
  if (screen > 0) {
    const glow = Math.exp(-screen * 9) * 0.95;
    color = mixColor(color, glowColor, glow);
  }

  // Antennas
  const antenna = Math.min(
    sdSegment(u, v, 0.4, 0.36, 0.31, 0.2),
    sdSegment(u, v, 0.6, 0.36, 0.69, 0.2)
  );
  if (antenna < 0.035) color = [245, 246, 248];

  if (screen <= 0) {
    color = screen > -0.035 ? [245, 246, 248] : mixColor([22, 24, 34], [12, 13, 20], v);
    if (insideTriangle(u, v, [0.45, 0.5], [0.45, 0.66], [0.59, 0.58])) {
      color = mixColor(PINK, BLUE, (u - 0.45) / 0.14);
    }
  }
  return color;
}

function renderIcon(size) {
  const ss = 4; // supersampling
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = iconSample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return rgba;
}

for (const size of [16, 32, 48, 128]) {
  writePng(`icons/icon-${size}.png`, size, size, renderIcon(size));
}

// Chrome Web Store icon: 128x128 with the artwork at 96x96 and 16px transparent padding.
{
  const inner = 96;
  const pad = 16;
  const size = inner + pad * 2;
  const src = renderIcon(inner);
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < inner; y++) {
    src.copy(out, ((y + pad) * size + pad) * 4, y * inner * 4, (y + 1) * inner * 4);
  }
  writePng('store/store-icon-128.png', size, size, out);
}

// ------------------------------------------------------------------ dithering noise

// Triangular distribution around mid grey: neutral on average with the overlay blend mode.
const NOISE_SIZE = 128;
const noise = Buffer.alloc(NOISE_SIZE * NOISE_SIZE * 4);
let seed = 0x9e3779b9;
const random = () => {
  // xorshift32, deterministic output
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};
for (let i = 0; i < noise.length; i += 4) {
  const v = Math.round(128 + (random() + random() - 1) * 51);
  noise[i] = noise[i + 1] = noise[i + 2] = v;
  noise[i + 3] = 255;
}
writePng('assets/noise.png', NOISE_SIZE, NOISE_SIZE, noise);
