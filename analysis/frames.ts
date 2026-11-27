/**
 * Frame sampling pass: scene/shot cuts (histogram difference) and face /
 * subject position over time. Uses the browser FaceDetector API when
 * available; otherwise a skin-tone + motion centroid heuristic (honest
 * fallback, best on talking-head footage). One seek pass does both.
 */
import type { FaceSample, MediaAsset } from '../engine/types';

export interface FrameAnalysisResult {
  scenes: number[];
  faces: FaceSample[];
  faceMethod: 'FaceDetector' | 'skin-heuristic' | 'none';
  avgLuma: number;
}

const hasFaceDetector = () => typeof (globalThis as any).FaceDetector !== 'undefined';

function skinCentroid(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; bw: number; bh: number; ratio: number } | null {
  let sx = 0, sy = 0, n = 0;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const yy = 0.299 * r + 0.587 * g + 0.114 * b;
      if (yy > 50 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
        sx += x; sy += y; n++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (n < w * h * 0.008) return null;
  return { x: sx / n / w, y: sy / n / h, bw: (maxX - minX) / w, bh: (maxY - minY) / h, ratio: n / (w * h) };
}

export async function analyzeFrames(
  asset: MediaAsset,
  blob: Blob,
  onProgress?: (pct: number) => void,
  fps = 2,
  maxSamples = 240
): Promise<FrameAnalysisResult> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  await new Promise<void>((res, rej) => {
    video.addEventListener('loadedmetadata', () => res(), { once: true });
    video.addEventListener('error', () => rej(new Error('Cannot load video for analysis')), { once: true });
    setTimeout(() => rej(new Error('Video metadata timeout')), 15000);
  }).catch(() => {});
  const duration = video.duration || asset.duration;
  const W = 96, H = Math.max(2, Math.round((W * (video.videoHeight || 9)) / (video.videoWidth || 16)));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const detector = hasFaceDetector() ? new (globalThis as any).FaceDetector({ fastMode: true, maxDetectedFaces: 3 }) : null;

  const scenes: number[] = [];
  const faces: FaceSample[] = [];
  let prevHist: Float32Array | null = null;
  const diffs: { t: number; d: number }[] = [];
  let lumaSum = 0, lumaN = 0;
  let ema: FaceSample | null = null;
  // Cap the number of seeks: at 2 fps a 2-hour movie would need 14,400 seeks
  // (~hours). Long files still get an evenly spaced, clearly sampled map.
  const step = Math.max(1 / fps, duration / Math.max(1, maxSamples));

  for (let t = 0; t < duration; t += step) {
    await new Promise<void>((res) => {
      const done = () => { video.removeEventListener('seeked', done); res(); };
      video.addEventListener('seeked', done, { once: true });
      try { video.currentTime = Math.min(t, duration - 0.05); } catch { done(); }
      setTimeout(done, 500);
    });
    if (video.readyState < 2) continue;
    ctx.drawImage(video, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    // 16-bin luma histogram
    const hist = new Float32Array(16);
    let luma = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const l = (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) / 255;
      hist[Math.min(15, Math.floor(l * 16))]++;
      luma += l;
    }
    const px = W * H;
    for (let i = 0; i < 16; i++) hist[i] /= px;
    lumaSum += luma / px; lumaN++;
    if (prevHist) {
      let d = 0;
      for (let i = 0; i < 16; i++) d += Math.abs(hist[i] - prevHist[i]);
      diffs.push({ t, d: d / 2 });
    }
    prevHist = hist;

    // face / subject
    let sample: FaceSample | null = null;
    if (detector) {
      try {
        const bmp = await createImageBitmap(canvas);
        const found = await detector.detect(bmp);
        bmp.close();
        if (found.length) {
          const f = found[0].boundingBox;
          sample = { t, x: (f.x + f.width / 2) / W, y: (f.y + f.height / 2) / H, w: f.width / W, h: f.height / H, conf: 0.9 };
        }
      } catch { /* detector failed on this frame */ }
    }
    if (!sample) {
      const skin = skinCentroid(img.data, W, H);
      if (skin) sample = { t, x: skin.x, y: skin.y, w: Math.max(0.12, skin.bw), h: Math.max(0.12, skin.bh), conf: Math.min(0.6, skin.ratio * 4) };
    }
    if (sample) {
      if (ema) {
        const a = 0.45;
        ema = { t, x: ema.x * (1 - a) + sample.x * a, y: ema.y * (1 - a) + sample.y * a, w: ema.w * (1 - a) + sample.w * a, h: ema.h * (1 - a) + sample.h * a, conf: sample.conf };
      } else ema = sample;
      faces.push({ ...ema });
    } else if (ema) {
      faces.push({ ...ema, t, conf: ema.conf * 0.7 });
    }
    onProgress?.(Math.min(1, t / duration));
  }

  // adaptive cut threshold: median + 3*MAD, floor 0.22
  const ds = diffs.map((d) => d.d).sort((a, b) => a - b);
  const median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  const mad = ds.length ? ds.map((d) => Math.abs(d - median)).sort((a, b) => a - b)[Math.floor(ds.length / 2)] : 0;
  const thr = Math.max(0.22, median + 3 * mad);
  let lastCut = -10;
  for (const { t, d } of diffs) {
    if (d > thr && t - lastCut > 0.4) { scenes.push(Math.round(t * 100) / 100); lastCut = t; }
  }

  video.pause(); video.src = ''; URL.revokeObjectURL(url);
  return {
    scenes,
    faces,
    faceMethod: detector ? 'FaceDetector' : faces.some((f) => f.conf > 0.1) ? 'skin-heuristic' : 'none',
    avgLuma: lumaN ? lumaSum / lumaN : 0,
  };
}