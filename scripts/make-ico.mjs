/**
 * Builds public/falconcut.ico from public/icon-512.png.
 * Windows accepts PNG-compressed ICO entries (Vista and later), so each size
 * is a PNG rendered by sharp and wrapped in the ICO container. Multi-size
 * matters: Explorer uses 16/32 px, the desktop uses 48/256 px.
 * Run: node scripts/make-ico.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'public', 'icon-512.png');
const out = join(root, 'public', 'falconcut.ico');
const sizes = [16, 24, 32, 48, 64, 128, 256];

const source = readFileSync(src);
const images = [];
for (const size of sizes) {
  const png = await sharp(source).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  images.push({ size, png });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

const dirs = [];
let offset = 6 + images.length * 16;
for (const { size, png } of images) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  dirs.push(entry);
  offset += png.length;
}

writeFileSync(out, Buffer.concat([header, ...dirs, ...images.map((i) => i.png)]));
console.log(`falconcut.ico written: ${sizes.join(', ')} px, ${(offset / 1024).toFixed(1)} kB`);
