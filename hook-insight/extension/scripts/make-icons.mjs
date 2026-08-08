// สร้างไอคอนส่วนขยายจากโค้ด — ไม่ต้องพึ่งไฟล์ binary ที่แก้ไม่ได้
// รัน: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/icon');
const SIZES = [16, 32, 48, 96, 128];

// tokens จาก CLAUDE.md ข้อ 8
const INK = [0x0e, 0x11, 0x16];
const BARS = [
  { color: [0x6b, 0x74, 0x84], height: 0.4 }, // --gauge-base
  { color: [0xd9, 0xa4, 0x41], height: 0.68 }, // --gauge-warm
  { color: [0xe4, 0x57, 0x2e], height: 1.0 }, // --gauge-hot
];

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** pixels: Uint8Array ขนาด size*size*3 (RGB) */
function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter: none
    pixels.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = INK[0];
    pixels[i * 3 + 1] = INK[1];
    pixels[i * 3 + 2] = INK[2];
  }

  const margin = Math.max(1, Math.round(size * 0.16));
  const gap = Math.max(1, Math.round(size * 0.07));
  const usableW = size - margin * 2;
  const usableH = size - margin * 2;
  const barW = Math.max(1, Math.floor((usableW - gap * 2) / 3));
  const totalW = barW * 3 + gap * 2;
  const startX = Math.round((size - totalW) / 2);
  const baseY = size - margin;

  BARS.forEach((bar, index) => {
    const height = Math.max(1, Math.round(usableH * bar.height));
    const x0 = startX + index * (barW + gap);
    for (let y = baseY - height; y < baseY; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const offset = (y * size + x) * 3;
        pixels[offset] = bar.color[0];
        pixels[offset + 1] = bar.color[1];
        pixels[offset + 2] = bar.color[2];
      }
    }
  });

  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
