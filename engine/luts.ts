/**
 * Color LUT (.cube) support. Same code path for preview and export.
 *
 * Import: `parseCube` parses the standard Adobe .cube text format
 * (TITLE / LUT_3D_SIZE / optional DOMAIN_MIN-MAX / table rows, red fastest).
 * The parsed table travels INSIDE the project (plain numbers, JSON-safe) so
 * projects with LUT grades round-trip through save/load.
 *
 * Apply: trilinear sampling per pixel would be far too slow at 1080p in
 * Canvas2D, so each LUT is baked ONCE into a 64-level-per-channel direct
 * lookup table (64³ = 262,144 entries; output clamped to 0..255). Per pixel
 * the cost is then a single table read — fast enough for real-time preview.
 * Input quantization is 6 bits/channel; smooth LUTs show no visible banding.
 */
import type { Lut } from './types';

export function parseCube(text: string, name: string): { lut: Lut } | { error: string } {
  const lines = text.split(/\r?\n/);
  let size = 0;
  let title = '';
  const vals: number[] = [];
  let domainMin = 0;
  let domainMax = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^TITLE/i.test(line)) { title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, ''); continue; }
    if (/^LUT_3D_SIZE/i.test(line)) {
      const n = parseInt(line.replace(/^LUT_3D_SIZE\s*/i, ''), 10);
      if (!Number.isFinite(n) || n < 2 || n > 256) return { error: `Unsupported LUT_3D_SIZE "${n}" — use a 3D cube LUT (2–256).` };
      size = n;
      continue;
    }
    if (/^LUT_1D_SIZE/i.test(line)) return { error: 'This is a 1D LUT — CutFlow needs a 3D (.cube) LUT with LUT_3D_SIZE.' };
    if (/^DOMAIN_(MIN|MAX)/i.test(line)) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (/^DOMAIN_MIN/i.test(line)) domainMin = parts[0] ?? 0;
      else domainMax = parts[0] ?? 1;
      continue;
    }
    if (/^(LUT_|TABLE|DEVICE|COMMENT)/i.test(line)) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) vals.push(parts[0], parts[1], parts[2]);
  }
  if (!size) return { error: 'No LUT_3D_SIZE found — this does not look like a 3D .cube LUT.' };
  const expected = size * size * size * 3;
  if (vals.length < expected) return { error: `Incomplete LUT table (${vals.length} values, expected ${expected}).` };
  // Normalize DOMAIN range into 0..1 (rare, but some LUTs use non-unit ranges).
  const span = domainMax - domainMin;
  const table = span === 1 || span === 0
    ? vals.slice(0, expected)
    : vals.slice(0, expected).map((v) => (v - domainMin) / span);
  return { lut: { id: `lut_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: title || name.replace(/\.cube$/i, ''), size, table } };
}

/** Baked direct-lookup table: index = (r>>2)<<12 | (g>>2)<<6 | (b>>2),
 * value = packed ABGR uint32 (Canvas ImageData layout). */
export type BakedLut = Uint32Array;
const LUT_LEVELS = 64; // 6 bits per channel

const bakeCache = new WeakMap<Lut, BakedLut>();

export function bakeLut(lut: Lut): BakedLut {
  const cached = bakeCache.get(lut);
  if (cached) return cached;
  const baked = new Uint32Array(LUT_LEVELS ** 3);
  const size = Math.max(2, lut.size);
  const maxIdx = size - 1;
  const sample = (r: number, g: number, b: number): [number, number, number] => {
    // Trilinear interpolation in the cube LUT.
    const x = Math.min(maxIdx, Math.max(0, r / LUT_LEVELS * size - 0.5));
    const y = Math.min(maxIdx, Math.max(0, g / LUT_LEVELS * size - 0.5));
    const z = Math.min(maxIdx, Math.max(0, b / LUT_LEVELS * size - 0.5));
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const x1 = Math.min(maxIdx, x0 + 1), y1 = Math.min(maxIdx, y0 + 1), z1 = Math.min(maxIdx, z0 + 1);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const at = (i: number, j: number, k: number): [number, number, number] => {
      // .cube row order: red fastest → index = (k*size + j)*size + i
      const base = ((k * size) + j) * size + i;
      return [lut.table[base * 3], lut.table[base * 3 + 1], lut.table[base * 3 + 2]];
    };
    const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
    const c000 = at(x0, y0, z0), c100 = at(x1, y0, z0), c010 = at(x0, y1, z0), c110 = at(x1, y1, z0);
    const c001 = at(x0, y0, z1), c101 = at(x1, y0, z1), c011 = at(x0, y1, z1), c111 = at(x1, y1, z1);
    const mix = (ci: number) =>
      lerp(
        lerp(lerp(c000[ci], c100[ci], fx), lerp(c010[ci], c110[ci], fx), fy),
        lerp(lerp(c001[ci], c101[ci], fx), lerp(c011[ci], c111[ci], fx), fy),
        fz,
      );
    return [mix(0), mix(1), mix(2)];
  };
  for (let r = 0; r < LUT_LEVELS; r++) {
    for (let g = 0; g < LUT_LEVELS; g++) {
      for (let b = 0; b < LUT_LEVELS; b++) {
        const [lr, lg, lb] = sample(r, g, b);
        const or = Math.max(0, Math.min(255, Math.round(lr * 255)));
        const og = Math.max(0, Math.min(255, Math.round(lg * 255)));
        const ob = Math.max(0, Math.min(255, Math.round(lb * 255)));
        baked[(r << 12) | (g << 6) | b] = (255 << 24) | (ob << 16) | (og << 8) | or;
      }
    }
  }
  bakeCache.set(lut, baked);
  return baked;
}

/** Apply a baked LUT (blended by strength 0..1) over ImageData in place. */
export function applyBakedLut(img: ImageData, baked: BakedLut, strength: number) {
  const d = img.data;
  const s = Math.max(0, Math.min(1, strength));
  if (s >= 0.999) {
    for (let i = 0; i < d.length; i += 4) {
      const packed = baked[(d[i] >> 2) << 12 | (d[i + 1] >> 2) << 6 | (d[i + 2] >> 2)];
      d[i] = packed & 255;
      d[i + 1] = (packed >>> 8) & 255;
      d[i + 2] = (packed >>> 16) & 255;
    }
  } else {
    for (let i = 0; i < d.length; i += 4) {
      const packed = baked[(d[i] >> 2) << 12 | (d[i + 1] >> 2) << 6 | (d[i + 2] >> 2)];
      d[i] += (((packed & 255) - d[i]) * s) | 0;
      d[i + 1] += ((((packed >>> 8) & 255) - d[i + 1]) * s) | 0;
      d[i + 2] += ((((packed >>> 16) & 255) - d[i + 2]) * s) | 0;
    }
  }
}
