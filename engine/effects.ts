/**
 * Visual effect pipeline. Same code path for preview and export.
 * Uses ctx.filter where available; CPU pixel fallback otherwise.
 * Pixel ops (temperature, chroma key, sharpen) always run on a scratch canvas.
 */
import type { Clip, Effect, Lut } from './types';
import { evalKeyframes } from './easing';
import { bakeLut, type BakedLut } from './luts';

export interface ResolvedEffects {
  filter: string;
  brightness: number; contrast: number; saturation: number; temperature: number;
  grayscale: number; sepia: number; hue: number; blur: number; sharpen: number;
  vignette: number; negate: number; normalize: number;
  pixelate: number; noise: number; rgbSplit: number; glow: number;
  /** Deterministic grain: seed param + quantized frame index. */
  noiseSeed?: number; noiseFrame?: number;
  chroma?: { color: [number, number, number]; tolerance: number; softness: number };
  /** Lift/gamma/gain grading (Kdenlive `lift_gamma_gain` model): per-channel
   * shadow lift (additive), gamma (exponent), and highlight gain (multiplier).
   * Present only when non-neutral; always requires the CPU pixel pass. */
  lgg?: { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] };
  /** Per-hue-band HSL offsets (Resolve/Fairlight style). Each band has a
   * center hue in degrees, a hue shift, a saturation multiplier and a lightness
   * offset; neighbouring bands are blended by triangular hue distance. */
  hsl?: { center: number; h: number; s: number; l: number }[];
  /** RGB tonal curves, applied as three 256-entry lookup tables. */
  curves?: [Uint8Array, Uint8Array, Uint8Array];
  /** .cube LUT grade: the project's Lut object + blend strength (0..1). The
   * BAKED table is injected by render.ts (it knows the project). */
  lut?: { lut: Lut; strength: number; baked?: BakedLut };
  needsPixels: boolean;
}

/** Curve params are compact strings: "x,y;x,y;..." with 0..255 coordinates. */
export const IDENTITY_CURVE = '0,0;64,64;128,128;192,192;255,255';
const HSL_BANDS = [
  ['r', 0], ['y', 60], ['g', 120], ['c', 180], ['b', 240], ['m', 300],
] as const;

export function parseCurvePoints(raw: unknown): { x: number; y: number }[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const pts = raw.split(';').map((part) => {
    const [x, y] = part.split(',').map((n) => Number(n.trim()));
    return { x, y };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return null;
  pts.sort((a, b) => a.x - b.x);
  if (pts[0].x > 0 || pts[pts.length - 1].x < 255) return null;
  return pts.map((p) => ({ x: clamp(p.x, 0, 255), y: clamp(p.y, 0, 255) }));
}

/** Build a 256-entry lookup table from curve control points (linear segments). */
export function curveLut(points: { x: number; y: number }[] | null): Uint8Array | null {
  if (!points) return null;
  const lut = new Uint8Array(256);
  let seg = 0;
  for (let v = 0; v < 256; v++) {
    while (seg < points.length - 2 && v > points[seg + 1].x) seg++;
    const a = points[seg], b = points[seg + 1];
    const span = Math.max(1, b.x - a.x);
    const t = clamp((v - a.x) / span, 0, 1);
    lut[v] = clamp(a.y + (b.y - a.y) * t, 0, 255);
  }
  return lut;
}

export function serializeCurvePoints(points: { x: number; y: number }[]): string {
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join(';');
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function resolveEffects(clip: Clip, localT: number, filterSupported: boolean): ResolvedEffects {
  const r: ResolvedEffects = {
    filter: '', brightness: 1, contrast: 1, saturation: 1, temperature: 0,
    grayscale: 0, sepia: 0, hue: 0, blur: 0, sharpen: 0, vignette: 0, negate: 0, normalize: 0,
    pixelate: 0, noise: 0, rgbSplit: 0, glow: 0, needsPixels: false,
  };
  const val = (e: Effect, key: string, def: number) => {
    const kfs = clip.keyframes.filter((k) => k.path === `effects.${e.id}.${key}`);
    const base = typeof e.params[key] === 'number' ? (e.params[key] as number) : def;
    return evalKeyframes(kfs, localT, base);
  };
  const filters: string[] = [];
  for (const e of clip.effects) {
    if (!e.enabled) continue;
    switch (e.type) {
      case 'color': {
        r.brightness *= val(e, 'brightness', 1);
        r.contrast *= val(e, 'contrast', 1);
        r.saturation *= val(e, 'saturation', 1);
        r.temperature += val(e, 'temperature', 0);
        r.grayscale = Math.max(r.grayscale, val(e, 'grayscale', 0));
        r.sepia = Math.max(r.sepia, val(e, 'sepia', 0));
        r.hue += val(e, 'hue', 0);
        // Lift/gamma/gain — same parameter names as Kdenlive's lift_gamma_gain.
        const lift: [number, number, number] = [val(e, 'lift_r', 0), val(e, 'lift_g', 0), val(e, 'lift_b', 0)];
        const gamma: [number, number, number] = [val(e, 'gamma_r', 1), val(e, 'gamma_g', 1), val(e, 'gamma_b', 1)];
        const gain: [number, number, number] = [val(e, 'gain_r', 1), val(e, 'gain_g', 1), val(e, 'gain_b', 1)];
        if (lift.some((v) => Math.abs(v) > 0.001) || gamma.some((v) => Math.abs(v - 1) > 0.001) || gain.some((v) => Math.abs(v - 1) > 0.001)) {
          // Compose stacked color nodes instead of letting the last one win.
          const prev = r.lgg;
          r.lgg = prev
            ? { lift: lift.map((v, i) => v + prev.lift[i]) as [number, number, number],
                gamma: gamma.map((v, i) => v * prev.gamma[i]) as [number, number, number],
                gain: gain.map((v, i) => v * prev.gain[i]) as [number, number, number] }
            : { lift, gamma, gain };
          r.needsPixels = true; // CSS filter has no gamma — CPU pass required even where filters work
        }
        // HSL bands: six hue zones, each with hue/saturation/lightness offsets.
        const bands: NonNullable<ResolvedEffects['hsl']> = [];
        for (const [key, center] of HSL_BANDS) {
          const h = val(e, `hsl_${key}_h`, 0);
          const s = val(e, `hsl_${key}_s`, 1);
          const l = val(e, `hsl_${key}_l`, 0);
          if (Math.abs(h) > 0.01 || Math.abs(s - 1) > 0.001 || Math.abs(l) > 0.001) bands.push({ center, h, s, l });
        }
        if (bands.length) { r.hsl = [...(r.hsl ?? []), ...bands]; r.needsPixels = true; }
        // RGB tonal curves. A master curve is composed with per-channel ones.
        const master = parseCurvePoints(e.params.curve);
        const chans = [parseCurvePoints(e.params.curve_r), parseCurvePoints(e.params.curve_g), parseCurvePoints(e.params.curve_b)];
        if (master || chans.some(Boolean)) {
          const base = curveLut(master);
          const prevCurves = r.curves;
          r.curves = [0, 1, 2].map((i) => {
            const lut = new Uint8Array(256);
            const own = curveLut(chans[i]);
            for (let v = 0; v < 256; v++) {
              let x = base ? base[v] : v;
              if (own) x = own[x];
              if (prevCurves) x = prevCurves[i][x];
              lut[v] = x;
            }
            return lut;
          }) as [Uint8Array, Uint8Array, Uint8Array];
          r.needsPixels = true;
        }
        break;
      }
      case 'blur': r.blur += val(e, 'amount', 4); break;
      case 'sharpen': r.sharpen += val(e, 'amount', 0.5); r.needsPixels = true; break;
      case 'vignette': r.vignette = Math.max(r.vignette, val(e, 'amount', 0.5)); break;
      case 'negate': r.negate = Math.max(r.negate, clamp(val(e, 'invert', 1), 0, 1)); r.needsPixels = true; break;
      case 'normalize': r.normalize = Math.max(r.normalize, clamp(val(e, 'strength', 1), 0, 1)); r.needsPixels = true; break;
      case 'pixelate': r.pixelate = Math.max(r.pixelate, Math.round(clamp(val(e, 'amount', 8), 2, 64))); r.needsPixels = true; break;
      case 'noise': {
        r.noise = Math.max(r.noise, clamp(val(e, 'amount', 0.15), 0, 1));
        r.noiseSeed = val(e, 'seed', 1);
        r.noiseFrame = Math.round(localT * 30);
        r.needsPixels = true;
        break;
      }
      case 'rgbSplit': r.rgbSplit = Math.max(r.rgbSplit, Math.round(clamp(val(e, 'amount', 4), 0, 32))); r.needsPixels = true; break;
      case 'glow': r.glow = Math.max(r.glow, clamp(val(e, 'amount', 0.4), 0, 1)); r.needsPixels = true; break;
      case 'chromaKey': {
        const hex = String(e.params.color ?? '#00FF00');
        const n = parseInt(hex.slice(1), 16);
        r.chroma = { color: [(n >> 16) & 255, (n >> 8) & 255, n & 255], tolerance: val(e, 'tolerance', 0.28), softness: val(e, 'softness', 0.12) };
        r.needsPixels = true;
        break;
      }
      case 'lut': {
        // params.lut is the lut id (string); strength is keyframeable.
        if (typeof e.params.lut === 'string' && e.params.lut) {
          r.lut = { lut: { id: e.params.lut, name: '', size: 0, table: [] }, strength: clamp(val(e, 'strength', 1), 0, 1) };
          r.needsPixels = true;
        }
        break;
      }
    }
  }
  if (Math.abs(r.temperature) > 0.001) r.needsPixels = true;
  if (filterSupported) {
    if (Math.abs(r.brightness - 1) > 0.001) filters.push(`brightness(${r.brightness.toFixed(3)})`);
    if (Math.abs(r.contrast - 1) > 0.001) filters.push(`contrast(${r.contrast.toFixed(3)})`);
    if (Math.abs(r.saturation - 1) > 0.001) filters.push(`saturate(${r.saturation.toFixed(3)})`);
    if (r.grayscale > 0.001) filters.push(`grayscale(${clamp(r.grayscale, 0, 1).toFixed(3)})`);
    if (r.sepia > 0.001) filters.push(`sepia(${clamp(r.sepia, 0, 1).toFixed(3)})`);
    if (Math.abs(r.hue) > 0.01) filters.push(`hue-rotate(${r.hue.toFixed(1)}deg)`);
    if (r.blur > 0.05) filters.push(`blur(${r.blur.toFixed(2)}px)`);
    r.filter = filters.join(' ');
  } else if (filters.length || r.needsPixels) {
    r.needsPixels = true;
  }
  if (r.needsPixels && !filterSupported) r.needsPixels = true;
  return r;
}

/** CPU pixel pass for temperature / chroma key / sharpen (+ full fallback when ctx.filter is missing). */
export function applyPixelOps(canvas: HTMLCanvasElement | OffscreenCanvas, r: ResolvedEffects, filterSupported: boolean) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const temp = r.temperature; // -1..1
  const tr = temp > 0 ? temp * 28 : temp * 10;
  const tb = temp > 0 ? -temp * 22 : -temp * 30;
  const doFallback = !filterSupported;
  const br = r.brightness, co = r.contrast, sa = r.saturation;
  const gs = r.grayscale, se = r.sepia, hu = (r.hue * Math.PI) / 180;
  const cosH = Math.cos(hu), sinH = Math.sin(hu);
  const chroma = r.chroma;
  const neg = r.negate; // 0..1 invert blend
  const norm = r.normalize; // 0..1 contrast-stretch blend
  // Percentile stretch bounds (1%..99% per channel) computed on a sample.
  let normLo: [number, number, number] | null = null;
  let normHi: [number, number, number] | null = null;
  if (norm > 0.001) {
    const bins = 256;
    const hist = [new Uint32Array(bins), new Uint32Array(bins), new Uint32Array(bins)];
    let sampled = 0;
    for (let i = 0; i < d.length; i += 16) { // every 4th pixel
      hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++;
      sampled++;
    }
    const cut = Math.max(1, Math.floor(sampled * 0.01));
    const bounds = (h: Uint32Array): [number, number] => {
      let acc = 0, lo = 0, hi = bins - 1;
      for (let b = 0; b < bins; b++) { acc += h[b]; if (acc >= cut) { lo = b; break; } }
      acc = 0;
      for (let b = bins - 1; b >= 0; b--) { acc += h[b]; if (acc >= cut) { hi = b; break; } }
      return [lo, hi];
    };
    const [rl, rh] = bounds(hist[0]);
    const [gl, gh] = bounds(hist[1]);
    const [bl, bh] = bounds(hist[2]);
    normLo = [rl, gl, bl];
    normHi = [rh, gh, bh];
  }
  for (let i = 0; i < d.length; i += 4) {
    let R = d[i], G = d[i + 1], B = d[i + 2];
    if (doFallback) {
      R *= br; G *= br; B *= br;
      R = (R - 128) * co + 128; G = (G - 128) * co + 128; B = (B - 128) * co + 128;
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      R = lum + (R - lum) * sa; G = lum + (G - lum) * sa; B = lum + (B - lum) * sa;
      if (gs > 0) { const l = 0.2126 * R + 0.7152 * G + 0.0722 * B; R += (l - R) * gs; G += (l - G) * gs; B += (l - B) * gs; }
      if (se > 0) {
        const sr = 0.393 * R + 0.769 * G + 0.189 * B, sg = 0.349 * R + 0.686 * G + 0.168 * B, sb = 0.272 * R + 0.534 * G + 0.131 * B;
        R += (sr - R) * se; G += (sg - G) * se; B += (sb - B) * se;
      }
      if (Math.abs(hu) > 0.001) {
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const rr = R - l, gg = G - l, bb = B - l;
        R = l + (0.213 + cosH * 0.787 - sinH * 0.213) * rr + (0.715 - cosH * 0.715 - sinH * 0.715) * gg + (0.072 - cosH * 0.072 + sinH * 0.928) * bb;
        G = l + (0.213 - cosH * 0.213 + sinH * 0.143) * rr + (0.715 + cosH * 0.285 + sinH * 0.140) * gg + (0.072 - cosH * 0.072 - sinH * 0.283) * bb;
        B = l + (0.213 - cosH * 0.213 - sinH * 0.787) * rr + (0.715 - cosH * 0.715 + sinH * 0.715) * gg + (0.072 + cosH * 0.928 + sinH * 0.072) * bb;
      }
    }
    // Lift/gamma/gain per channel: out = gain * (v/255)^(1/gamma) * 255 + lift * 255
    if (r.lgg) {
      const { lift, gamma, gain } = r.lgg;
      const chans = [R, G, B];
      for (let c = 0; c < 3; c++) {
        const g = Math.max(0.05, gamma[c]);
        const v = gain[c] * Math.pow(chans[c] / 255, 1 / g) * 255 + lift[c] * 255;
        if (c === 0) R = v; else if (c === 1) G = v; else B = v;
      }
    }
    // Negate (Kdenlive `avfilter.negate`): blend toward the inverted channel.
    if (neg > 0) {
      R = R * (1 - neg) + (255 - R) * neg;
      G = G * (1 - neg) + (255 - G) * neg;
      B = B * (1 - neg) + (255 - B) * neg;
    }
    // Normalize (Kdenlive `avfilter.normalize` / auto-levels): percentile stretch.
    if (norm > 0.001 && normLo && normHi) {
      for (let c = 0; c < 3; c++) {
        const v = c === 0 ? R : c === 1 ? G : B;
        const lo = normLo[c], hi = Math.max(normLo[c] + 1, normHi[c]);
        const stretched = ((v - lo) / (hi - lo)) * 255;
        const out = v * (1 - norm) + stretched * norm;
        if (c === 0) R = out; else if (c === 1) G = out; else B = out;
      }
    }
    if (temp !== 0) { R += tr; B += tb; }
    // RGB tonal curves (master composed with per-channel), same LUT path as
    // Resolve-style curves. Preview and export both go through here.
    if (r.curves) {
      R = r.curves[0][clamp(R, 0, 255) | 0];
      G = r.curves[1][clamp(G, 0, 255) | 0];
      B = r.curves[2][clamp(B, 0, 255) | 0];
    }
    // Per-hue-band HSL adjustments with triangular falloff between neighbours.
    if (r.hsl && r.hsl.length) {
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), spread = mx - mn;
      if (spread > 0.2) {
        let hue = mx === R ? (G - B) / spread : mx === G ? (B - R) / spread + 2 : (R - G) / spread + 4;
        hue = (hue * 60 + 360) % 360;
        let dh = 0, sm = 1, dl = 0;
        for (const band of r.hsl) {
          let dist = Math.abs(hue - band.center);
          if (dist > 180) dist = 360 - dist;
          const w = Math.max(0, 1 - dist / 60);
          if (w > 0) { dh += band.h * w; sm += (band.s - 1) * w; dl += band.l * w; }
        }
        if (Math.abs(dh) > 0.001 || Math.abs(sm - 1) > 0.001 || Math.abs(dl) > 0.001) {
          const lum = (mx + mn) / 510;
          const denom = 255 - Math.abs(mx + mn - 255);
          const sat = denom > 0 ? clamp((spread / denom) * sm, 0, 1) : 0;
          const light = clamp(lum + dl, 0, 1);
          const c2 = (1 - Math.abs(2 * light - 1)) * sat;
          const hh = (((hue + dh) / 60) % 6 + 6) % 6;
          const x2 = c2 * (1 - Math.abs((hh / 2) % 2 - 1));
          const m2 = light - c2 / 2;
          let rr = 0, gg = 0, bb = 0;
          if (hh < 1) { rr = c2; gg = x2; }
          else if (hh < 2) { rr = x2; gg = c2; }
          else if (hh < 3) { gg = c2; bb = x2; }
          else if (hh < 4) { gg = x2; bb = c2; }
          else if (hh < 5) { rr = x2; bb = c2; }
          else { rr = c2; bb = x2; }
          R = (rr + m2) * 255; G = (gg + m2) * 255; B = (bb + m2) * 255;
        }
      }
    }
    // .cube LUT grade: single baked-table lookup per pixel, blended by strength.
    if (r.lut && r.lut.baked) {
      const packed = r.lut.baked[(clamp(R, 0, 255) >> 2) << 12 | (clamp(G, 0, 255) >> 2) << 6 | (clamp(B, 0, 255) >> 2)];
      const s = r.lut.strength;
      R = R * (1 - s) + (packed & 255) * s;
      G = G * (1 - s) + ((packed >>> 8) & 255) * s;
      B = B * (1 - s) + ((packed >>> 16) & 255) * s;
    }
    if (chroma) {
      const dr = R - chroma.color[0], dg = G - chroma.color[1], db = B - chroma.color[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;
      const t0 = chroma.tolerance, soft = Math.max(0.01, chroma.softness);
      if (dist < t0) d[i + 3] = 0;
      else if (dist < t0 + soft) d[i + 3] = Math.round(d[i + 3] * ((dist - t0) / soft));
    }
    d[i] = clamp(R, 0, 255); d[i + 1] = clamp(G, 0, 255); d[i + 2] = clamp(B, 0, 255);
  }
  // Creative effects that need neighbour samples work from a snapshot so they
  // do not compound with the per-pixel color pass above.
  if (r.rgbSplit > 0 || r.glow > 0 || r.noise > 0 || r.pixelate > 0) {
    const src = new Uint8ClampedArray(d);
    if (r.rgbSplit > 0) {
      const shift = Math.round(r.rgbSplit);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const ri = (y * w + Math.min(w - 1, x + shift)) * 4;
        const bi = (y * w + Math.max(0, x - shift)) * 4;
        d[i] = src[ri]; d[i + 2] = src[bi + 2];
      }
    }
    if (r.glow > 0) {
      const amt = clamp(r.glow, 0, 1);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        let rr = 0, gg = 0, bb = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * w + (x + dx)) * 4;
          rr += src[j]; gg += src[j + 1]; bb += src[j + 2];
        }
        d[i] = d[i] * (1 - amt) + (rr / 9) * amt;
        d[i + 1] = d[i + 1] * (1 - amt) + (gg / 9) * amt;
        d[i + 2] = d[i + 2] * (1 - amt) + (bb / 9) * amt;
      }
    }
    if (r.noise > 0) {
      // Hash-based grain: identical pixels for the same frame in preview,
      // PNG and video export. `seed` lets users freeze the pattern.
      const amt = r.noise * 48;
      const seed = (r.noiseSeed ?? 1) | 0;
      const frame = (r.noiseFrame ?? 0) | 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(frame + 1, 1274126177) ^ Math.imul(seed, 2654435761);
        hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
        const n = (((hash ^ (hash >>> 16)) >>> 0) / 4294967295 - 0.5) * amt;
        const i = (y * w + x) * 4;
        d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255);
      }
    }
    if (r.pixelate > 0) {
      const block = Math.max(2, Math.round(r.pixelate));
      const px = new Uint8ClampedArray(d);
      for (let by = 0; by < h; by += block) for (let bx = 0; bx < w; bx += block) {
        let rr = 0, gg = 0, bb = 0, n = 0;
        for (let y = by; y < Math.min(h, by + block); y++) for (let x = bx; x < Math.min(w, bx + block); x++) {
          const i = (y * w + x) * 4; rr += px[i]; gg += px[i + 1]; bb += px[i + 2]; n++;
        }
        if (!n) continue;
        for (let y = by; y < Math.min(h, by + block); y++) for (let x = bx; x < Math.min(w, bx + block); x++) {
          const i = (y * w + x) * 4; d[i] = rr / n; d[i + 1] = gg / n; d[i + 2] = bb / n;
        }
      }
    }
  }
  if (r.sharpen > 0.01) sharpenInPlace(img, w, h, clamp(r.sharpen, 0, 1));
  ctx.putImageData(img, 0, 0);
}

function sharpenInPlace(img: ImageData, w: number, h: number, amount: number) {
  const d = img.data;
  const copy = new Uint8ClampedArray(d);
  const k = amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = copy[i + c];
        const neighbors = copy[i - 4 + c] + copy[i + 4 + c] + copy[i - w * 4 + c] + copy[i + w * 4 + c];
        d[i + c] = clamp(center + (center * 4 - neighbors) * k * 0.25, 0, 255);
      }
    }
  }
}

export function drawVignette(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0.01) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${clamp(amount, 0, 1) * 0.85})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export const COLOR_PRESETS: Record<string, { name: string; params: Record<string, number> }> = {
  natural: { name: 'Natural', params: { brightness: 1.02, contrast: 1.04, saturation: 1.05, temperature: 0 } },
  warm: { name: 'Warm', params: { brightness: 1.04, contrast: 1.05, saturation: 1.1, temperature: 0.35, sepia: 0.08 } },
  cool: { name: 'Cool', params: { brightness: 1.0, contrast: 1.06, saturation: 0.95, temperature: -0.3 } },
  cinematic: { name: 'Cinematic', params: { brightness: 0.98, contrast: 1.18, saturation: 0.82, temperature: 0.12 } },
  'black-white': { name: 'Black & White', params: { brightness: 1.03, contrast: 1.15, saturation: 1, grayscale: 1 } },
  vibrant: { name: 'Vibrant', params: { brightness: 1.05, contrast: 1.1, saturation: 1.35, temperature: 0.05 } },
};