/* One-off asset generator: turns the supplied brand artwork (an SVG that wraps
 * a 1254×1254 PNG) into every icon size the app, PWA, iOS and Windows need.
 * Run: node scripts/make-icons.mjs "<path to logo design.svg>" */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public');
const srcPath = process.argv[2];
if (!srcPath) {
  console.error('usage: node scripts/make-icons.mjs "<logo svg>"');
  process.exit(1);
}

const svg = readFileSync(srcPath, 'utf8');
const b64 = svg.match(/base64,([^"']+)/)?.[1];
if (!b64) {
  console.error('No embedded base64 image found in the SVG.');
  process.exit(1);
}
const art = Buffer.from(b64, 'base64');
const meta = await sharp(art).metadata();
console.log(`artwork: ${meta.width}x${meta.height} ${meta.format}`);

/* Sample the icon's own background so maskable/apple padding blends in instead
 * of showing black corners. These three points sit on the blue field inside the
 * rounded tile (verified against the artwork): right-middle, right-upper and
 * left-middle. Average them so a gradient does not bias the pad to one hue. */
const sampleAt = async (fx, fy) => {
  const { data } = await sharp(art)
    .extract({ left: Math.round(meta.width * fx), top: Math.round(meta.height * fy), width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
};
const pts = await Promise.all([sampleAt(0.88, 0.55), sampleAt(0.86, 0.35), sampleAt(0.1, 0.5)]);
const rgb = [0, 1, 2].map((i) => Math.round(pts.reduce((s, p) => s + p[i], 0) / pts.length));
const bg = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
console.log(`background sampled: ${bg}`);

mkdirSync(outDir, { recursive: true });

/* Palette PNGs at 192px and up: the artwork is a detailed illustration, and a
 * 256-colour palette with dithering is visually identical at icon sizes while
 * cutting the 512px file from ~643 kB to ~131 kB (the PWA icon is fetched on
 * install, so this matters). Alpha is preserved. */
const pngOpts = (size) => (size >= 192
  ? { palette: true, quality: 90, compressionLevel: 9 }
  : { compressionLevel: 9 });

const png = (size, file) => sharp(art)
  .resize(size, size, { kernel: 'lanczos3' })
  .png(pngOpts(size))
  .toFile(join(outDir, file))
  .then(() => file);

/* Full-bleed square: artwork padded inside a solid canvas so platform masks
 * (Android circle, iOS squircle) never reveal transparent corners. */
const padded = async (size, file, inner) => {
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: await sharp(art).resize(inner, inner, { kernel: 'lanczos3' }).png().toBuffer(), gravity: 'center' }])
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toFile(join(outDir, file));
  return file;
};

const made = [];
made.push(await png(192, 'icon-192.png'));
made.push(await png(512, 'icon-512.png'));
made.push(await png(1024, 'logo-1024.png'));
made.push(await png(512, 'logo-mark-512.png'));
made.push(await png(128, 'logo-mark.png'));
made.push(await png(48, 'favicon-48.png'));
made.push(await png(32, 'favicon-32.png'));
made.push(await png(16, 'favicon-16.png'));
made.push(await padded(512, 'icon-512-maskable.png', 404));
/* Android builds the adaptive icon from the 192 variant on most densities, so
 * a maskable 192 is required too — with only a 512 maskable, launchers fall
 * back to the plain "any" icon and shrink it inside a white circle. */
made.push(await padded(192, 'icon-192-maskable.png', 150));
made.push(await padded(180, 'apple-touch-icon.png', 166));

/* Multi-size .ico with PNG payloads (Vista+). Windows shortcuts and browsers
 * pick the closest entry. */
const icoSizes = [16, 32, 48, 64, 128, 256];
const entries = [];
for (const s of icoSizes) entries.push({ size: s, buf: await sharp(art).resize(s, s, { kernel: 'lanczos3' }).png(pngOpts(s)).toBuffer() });
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
const dir = Buffer.alloc(16 * entries.length);
let offset = 6 + dir.length;
entries.forEach((e, i) => {
  const o = i * 16;
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
  dir.writeUInt8(0, o + 2);
  dir.writeUInt8(0, o + 3);
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(e.buf.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += e.buf.length;
});
writeFileSync(join(outDir, 'favicon.ico'), Buffer.concat([header, dir, ...entries.map((e) => e.buf)]));
made.push('favicon.ico');

/* Compact SVG wrapper for places that want a scalable file: embeds a 256px
 * render (the source art is raster, so 256 is the honest ceiling for a small
 * file; the 512 PNG next to it is the high-resolution option). */
const svg256 = await sharp(art).resize(256, 256, { kernel: 'lanczos3' }).png(pngOpts(256)).toBuffer();
writeFileSync(
  join(outDir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${svg256.toString('base64')}"/></svg>\n`,
);
made.push('icon.svg');

console.log('written:', made.join(', '));
