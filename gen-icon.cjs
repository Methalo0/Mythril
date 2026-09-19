// Mythril icon generator — faceted gem "M" on dark, no dependencies.
// Writes icon.png (256px) and icon.ico for the app, tray, and installer.
const fs = require('fs');
const zlib = require('zlib');

function makeCanvas(w, h) {
  return { w, h, px: new Float64Array(w * h * 4) }; // RGBA float 0..1
}
function blend(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || a <= 0) return;
  const i = (y * c.w + x) * 4;
  const ia = 1 - a;
  c.px[i] = r * a + c.px[i] * ia;
  c.px[i + 1] = g * a + c.px[i + 1] * ia;
  c.px[i + 2] = b * a + c.px[i + 2] * ia;
  c.px[i + 3] = a + c.px[i + 3] * ia;
}
// Point-in-polygon fill with a vertical gradient between two colors.
function fillPolyGrad(c, pts, top, bottom, alpha = 1) {
  const ys = pts.map(p => p[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(c.h - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y++) {
    const t = (y - Math.min(...ys)) / Math.max(1, Math.max(...ys) - Math.min(...ys));
    const r = top[0] + (bottom[0] - top[0]) * t;
    const g = top[1] + (bottom[1] - top[1]) * t;
    const b = top[2] + (bottom[2] - top[2]) * t;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.max(0, Math.floor(xs[i])); x <= Math.min(c.w - 1, Math.ceil(xs[i + 1])); x++) {
        blend(c, x, y, r, g, b, alpha);
      }
    }
  }
}
function fillCircle(c, cx, cy, rad, color, alpha) {
  for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(c.h - 1, Math.ceil(cy + rad)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(c.w - 1, Math.ceil(cx + rad)); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) blend(c, x, y, color[0], color[1], color[2], alpha * (1 - d / rad));
    }
  }
}

function draw(size) {
  const c = makeCanvas(size, size);
  const u = size / 256;
  // Rounded-rect dark background
  const r = 56 * u;
  const bg = [0.075, 0.078, 0.09];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inX = Math.min(x, size - 1 - x), inY = Math.min(y, size - 1 - y);
    let inside = true;
    if (inX < r && inY < r) inside = Math.hypot(r - inX, r - inY) <= r;
    if (inside) blend(c, x, y, bg[0], bg[1], bg[2], 1);
  }
  // Ambient glow behind the gem
  fillCircle(c, 128 * u, 128 * u, 110 * u, [0.46, 0.73, 0.0], 0.35);

  // Gem silhouette (hexagonal crystal)
  const gem = [
    [128, 22], [216, 72], [216, 160], [128, 234], [40, 160], [40, 72],
  ].map(([x, y]) => [x * u, y * u]);
  // gradient: bright green top -> deep teal bottom
  fillPolyGrad(c, gem, [0.62, 0.89, 0.10], [0.05, 0.45, 0.45], 1);

  // Inner facet: lighter top-left face
  const facet = [[128, 22], [216, 72], [128, 128], [40, 72]].map(([x, y]) => [x * u, y * u]);
  fillPolyGrad(c, facet, [0.78, 0.97, 0.35], [0.30, 0.70, 0.45], 0.85);
  // Bottom-left shade facet
  const shade = [[40, 72], [128, 128], [128, 234], [40, 160]].map(([x, y]) => [x * u, y * u]);
  fillPolyGrad(c, shade, [0.10, 0.30, 0.22], [0.03, 0.16, 0.22], 0.55);

  // M monogram cutout (dark, reads as engraved)
  const m = [
    [76, 178], [76, 92], [100, 92], [128, 128], [156, 92], [180, 92], [180, 178], [158, 178],
    [158, 126], [128, 160], [98, 126], [98, 178],
  ].map(([x, y]) => [x * u, y * u]);
  fillPolyGrad(c, m, [0.03, 0.05, 0.06], [0.06, 0.10, 0.10], 0.92);

  // Edge highlight along the top-left rim
  const rim = [[40, 72], [128, 22], [216, 72], [214, 82], [128, 34], [42, 80]].map(([x, y]) => [x * u, y * u]);
  fillPolyGrad(c, rim, [0.9, 1.0, 0.55], [0.55, 0.85, 0.5], 0.8);

  return c;
}

function toPNG(c) {
  const { w, h } = c;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = y * (w * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 4; k++) raw[o + k] = Math.round(Math.min(1, Math.max(0, c.px[i + k])) * 255);
    }
  }
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1; crcTable[n] = v >>> 0; }
  const crc32 = (buf) => { let v = 0xFFFFFFFF; for (const b of buf) v = crcTable[(v ^ b) & 0xFF] ^ (v >>> 8); return (v ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function toICO(pngBuf) {
  // ICO with embedded PNG (Vista+), plus 32px BMP fallback not needed — PNG entry only.
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent.writeUInt8(0, 0); ent.writeUInt8(0, 1); // 256
  ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(pngBuf.length, 8); ent.writeUInt32LE(22, 12);
  return Buffer.concat([hdr, ent, pngBuf]);
}

const c256 = draw(256);
const png = toPNG(c256);
fs.writeFileSync('apps/x/apps/main/icons/icon.png', png);
fs.writeFileSync('apps/x/apps/main/icons/icon.ico', toICO(png));
fs.writeFileSync('apps/x/apps/renderer/public/logo-only.png', png);
// Tray needs small sizes: 18px and 36px template-ish (grayscale alpha is fine).
fs.writeFileSync('apps/x/apps/main/icons/tray-18.png', toPNG(draw(18)));
fs.writeFileSync('apps/x/apps/main/icons/tray-36.png', toPNG(draw(36)));
console.log('icons written');
