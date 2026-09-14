/**
 * Regenerates the PWA icons in client/public from the same shapes as icon.svg.
 *
 * Written by hand rather than pulled in from an image library: the artwork is
 * five rounded rectangles, and this keeps the repo free of a native toolchain.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT_DIR = fileURLToPath(new URL('../client/public/', import.meta.url));

const BG = [0x0d, 0x11, 0x17];
const ORANGE = [0xf9, 0x73, 0x16];
const LIGHT = [0xe6, 0xed, 0xf3];

/** The forks and the bar, in the 512×512 space the SVG uses. */
const SHAPES = [
  { x: 60, y: 216, w: 46, h: 80, r: 14, color: ORANGE },
  { x: 122, y: 176, w: 54, h: 160, r: 16, color: ORANGE },
  { x: 336, y: 176, w: 54, h: 160, r: 16, color: ORANGE },
  { x: 406, y: 216, w: 46, h: 80, r: 14, color: ORANGE },
  { x: 176, y: 238, w: 160, h: 36, r: 18, color: LIGHT },
];

/** Distance-based coverage of a rounded rectangle at a point, 0..1. */
function coverage(px, py, { x, y, w, h, r }) {
  // Fold the point into the rectangle's first quadrant, then test the corner arc.
  const cx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const cy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  if (cx <= 0 || cy <= 0) return cx <= r && cy <= r ? 1 : 0;
  return Math.hypot(cx, cy) <= r ? 1 : 0;
}

const SAMPLES = 4; // 4×4 supersampling, enough for smooth corners at these sizes

function render(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  // A maskable icon fills the square and keeps its content inside the safe zone.
  const outer = maskable ? null : { x: 0, y: 0, w: 512, h: 512, r: 112 };
  const scale = maskable ? 0.62 : 1;

  const shapes = SHAPES.map((shape) =>
    maskable
      ? {
          ...shape,
          x: 256 + (shape.x - 256) * scale,
          y: 256 + (shape.y - 256) * scale,
          w: shape.w * scale,
          h: shape.h * scale,
          r: shape.r * scale,
        }
      : shape,
  );

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          // Sample centre, converted from pixel space to the 512 design space.
          const ux = ((px + (sx + 0.5) / SAMPLES) / size) * 512;
          const uy = ((py + (sy + 0.5) / SAMPLES) / size) * 512;

          // Outside the rounded corner the icon is transparent, so a launcher
          // can place it on any background without a square of dark showing.
          if (outer && !coverage(ux, uy, outer)) continue;

          let colour = BG;
          for (const shape of shapes) {
            if (coverage(ux, uy, shape)) colour = shape.color;
          }
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered++;
        }
      }

      const total = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      // Colour is averaged over covered samples only, so edges don't darken.
      pixels[offset] = covered ? Math.round(r / covered) : 0;
      pixels[offset + 1] = covered ? Math.round(g / covered) : 0;
      pixels[offset + 2] = covered ? Math.round(b / covered) : 0;
      pixels[offset + 3] = Math.round((covered / total) * 255);
    }
  }

  return pixels;
}

/* ------------------------------------------------------------- PNG output */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
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
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  // 10–12: deflate, adaptive filtering, no interlace — all zero.

  // One filter byte (0 = none) in front of each scanline.
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-180.png', size: 180, maskable: false }, // apple-touch-icon
  { file: 'icon-maskable.png', size: 512, maskable: true },
];

for (const { file, size, maskable } of TARGETS) {
  const png = encodePng(size, render(size, { maskable }));
  writeFileSync(OUT_DIR + file, png);
  console.log(`${file}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
