/**
 * Rasterize public/icon.svg into the PWA icon set (192, 512, maskable 512).
 * Run: node scripts/gen-icons.mjs   (requires devDependencies installed)
 */
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const svgPath = path.join(root, 'public', 'icon.svg');

// Maskable icons need a solid safe zone: pad the artwork into 80% of the tile.
const svg = await readFile(svgPath, 'utf8');
async function render(size, dest, { pad = 0 } = {}) {
  let src = svg;
  if (pad > 0) {
    const padded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#07090F"/><g transform="translate(${512 * pad * 0.5}, ${512 * pad * 0.5}) scale(${1 - pad})">${svg.replace(/<\?xml[^>]*\?>/, '').replace(/width="[^"]*"/, 'width="512"').replace(/height="[^"]*"/, 'height="512"')}</g></svg>`;
    src = padded;
  }
  await sharp(Buffer.from(src)).resize(size, size).png().toFile(path.join(root, 'public', dest));
  console.log(`✓ ${dest} (${size}×${size})`);
}

await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-512-maskable.png', { pad: 0.12 });

// Report the SVG's intrinsic size for the manifest.
const meta = await sharp(Buffer.from(svg)).metadata();
console.log(`source SVG: ${meta.width}×${meta.height}`);
