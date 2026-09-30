import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * App icons for the worker and contractor apps. ADR-0018.
 *
 *   npm --prefix client run icons
 *
 * One drawing, written twice from the same numbers: as an SVG (the source you
 * can open and edit) and as PNG files at the sizes Android needs. No image
 * library: the PNGs are drawn pixel by pixel here, with 4 x 4 samples per pixel
 * for smooth edges, and written with Node's own zlib.
 *
 * The drawing is a record page with two lines and a tick: "what was written
 * down, and agreed". Everything important stays inside the middle 80% circle,
 * which is the part Android keeps when it cuts a maskable icon to a circle.
 */

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");

// Colours from the design tokens (docs/phase2/ui-design-brief.md).
const APPS = {
  worker: { background: "#0F766E" }, // primary teal
  contractor: { background: "#0F172A" }, // ink, so the two apps look different
};
const WHITE = "#FFFFFF";

/** The drawing, in a 512 x 512 box. */
const PAGE = { x0: 156, y0: 116, x1: 356, y1: 396, r: 22 };
const LINES = [
  { x0: 196, y0: 180, x1: 316, y1: 180 },
  { x0: 196, y0: 228, x1: 284, y1: 228 },
];
const LINE_WIDTH = 18;
const TICK = [
  [200, 314],
  [238, 350],
  [314, 272],
];
const TICK_WIDTH = 24;
const CORNER = 104; // radius of the "any" icon's rounded square

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

function inRoundedRect(x, y, { x0, y0, x1, y1, r }) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function nearSegment(x, y, [ax, ay], [bx, by], width) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= (width / 2) ** 2;
}

/** The colour at one point of the 512 box, or null for transparent. */
function colourAt(x, y, background, fullBleed) {
  const inBackground = fullBleed || inRoundedRect(x, y, { x0: 0, y0: 0, x1: 512, y1: 512, r: CORNER });
  if (!inBackground) return null;
  if (!inRoundedRect(x, y, PAGE)) return background;
  for (const l of LINES) if (nearSegment(x, y, [l.x0, l.y0], [l.x1, l.y1], LINE_WIDTH)) return background;
  for (let i = 0; i + 1 < TICK.length; i++) if (nearSegment(x, y, TICK[i], TICK[i + 1], TICK_WIDTH)) return background;
  return WHITE;
}

function render(size, background, fullBleed) {
  const S = 4;
  const scale = 512 / size;
  const bg = hex(background);
  const white = hex(WHITE);
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = colourAt((px + (sx + 0.5) / S) * scale, (py + (sy + 0.5) / S) * scale, background, fullBleed);
          if (c === null) continue;
          const [cr, cg, cb] = c === WHITE ? white : bg;
          r += cr; g += cg; b += cb; a += 1;
        }
      }
      const o = (py * size + px) * 4;
      // Colour averaged over the covered samples; alpha is the covered share.
      rgba[o] = a ? Math.round(r / a) : 0;
      rgba[o + 1] = a ? Math.round(g / a) : 0;
      rgba[o + 2] = a ? Math.round(b / a) : 0;
      rgba[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  return png(size, size, rgba);
}

// --- PNG writer --------------------------------------------------------------

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
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  // Each row starts with filter byte 0 (none).
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- SVG, the same drawing ---------------------------------------------------

function svg(background) {
  const line = (l) =>
    `<line x1="${l.x0}" y1="${l.y0}" x2="${l.x1}" y2="${l.y1}" stroke="${background}" stroke-width="${LINE_WIDTH}" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${CORNER}" fill="${background}"/>
  <rect x="${PAGE.x0}" y="${PAGE.y0}" width="${PAGE.x1 - PAGE.x0}" height="${PAGE.y1 - PAGE.y0}" rx="${PAGE.r}" fill="${WHITE}"/>
  ${LINES.map(line).join("\n  ")}
  <polyline points="${TICK.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${background}" stroke-width="${TICK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

for (const [app, { background }] of Object.entries(APPS)) {
  const dir = resolve(OUT, app);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "icon.svg"), svg(background));
  writeFileSync(resolve(dir, "icon-192.png"), render(192, background, false));
  writeFileSync(resolve(dir, "icon-512.png"), render(512, background, false));
  writeFileSync(resolve(dir, "icon-maskable-512.png"), render(512, background, true));
  // iPhone rounds the corners itself, so its icon fills the square.
  writeFileSync(resolve(dir, "apple-touch-icon.png"), render(180, background, true));
  console.log(`wrote public/${app}/icon.svg and 4 PNG icons`);
}
