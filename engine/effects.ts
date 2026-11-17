/**
 * Visual effect pipeline. Same code path for preview and export.
 * Uses ctx.filter where available; CPU pixel fallback otherwise.
 * Pixel ops (temperature, chroma key, sharpen) always run on a scratch canvas.
 */
import type { Clip, Effect } from './types';
import { evalKeyframes } from './easing';

export interface ResolvedEffects {
  filter: string;
  brightness: number; contrast: number; saturation: number; temperature: number;
  grayscale: number; sepia: number; hue: number; blur: number; sharpen: number;
  vignette: number; negate: number; normalize: number;
  chroma?: { color: [number, number, number]; tolerance: number; softness: number };
  /** Lift/gamma/gain grading (Kdenlive `lift_gamma_gain` model): per-channel
   * shadow lift (additive), gamma (exponent), and highlight gain (multiplier).
   * Present only when non-neutral; always requires the CPU pixel pass. */
  lgg?: { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] };
  needsPixels: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function resolveEffects(clip: Clip, localT: number, filterSupported: boolean): ResolvedEffects {
  const r: ResolvedEffects = {
    filter: '', brightness: 1, contrast: 1, saturation: 1, temperature: 0,
    grayscale: 0, sepia: 0, hue: 0, blur: 0, sharpen: 0, vignette: 0, negate: 0, normalize: 0, needsPixels: false,
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
          r.lgg = { lift, gamma, gain };
          r.needsPixels = true; // CSS filter has no gamma — CPU pass required even where filters work
        }
        break;
      }
      case 'blur': r.blur += val(e, 'amount', 4); break;
      case 'sharpen': r.sharpen += val(e, 'amount', 0.5); r.needsPixels = true; break;
      case 'vignette': r.vignette = Math.max(r.vignette, val(e, 'amount', 0.5)); break;
      case 'negate': r.negate = Math.max(r.negate, clamp(val(e, 'invert', 1), 0, 1)); r.needsPixels = true; break;
      case 'normalize': r.normalize = Math.max(r.normalize, clamp(val(e, 'strength', 1), 0, 1)); r.needsPixels = true; break;
      case 'chromaKey': {
        const hex = String(e.params.color ?? '#00FF00');
        const n = parseInt(hex.slice(1), 16);
        r.chroma = { color: [(n >> 16) & 255, (n >> 8) & 255, n & 255], tolerance: val(e, 'tolerance', 0.28), softness: val(e, 'softness', 0.12) };
        r.needsPixels = true;
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
    if (chroma) {
      const dr = R - chroma.color[0], dg = G - chroma.color[1], db = B - chroma.color[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.7;
      const t0 = chroma.tolerance, soft = Math.max(0.01, chroma.softness);
      if (dist < t0) d[i + 3] = 0;
      else if (dist < t0 + soft) d[i + 3] = Math.round(d[i + 3] * ((dist - t0) / soft));
    }
    d[i] = clamp(R, 0, 255); d[i + 1] = clamp(G, 0, 255); d[i + 2] = clamp(B, 0, 255);
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