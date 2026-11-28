/**
 * Audio analysis: loudness envelope, silence map, K-weighted integrated
 * loudness (~LUFS, ITU-R BS.1770 approximation), true peak, speech/music
 * heuristic, beat grid (spectral flux + autocorrelation tempo), emphasis.
 * All real DSP on the decoded AudioBuffer — no network, no model.
 */
import type { LoudnessPoint, SilenceSpan } from '../engine/types';

export interface AudioAnalysisResult {
  /** Sample-accurate peak envelope for the timeline waveform (100 samples/s). */
  peaks: { t: number; peak: number }[];
  loudness: LoudnessPoint[];
  silences: SilenceSpan[];
  integratedLoudness: number;
  truePeak: number;
  speechRatio: number;
  isMusic: boolean;
  beats: number[];
  bpm: number;
  emphasis: number[];
}

export function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}

export function resampleLinear(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return data;
  const ratio = fromRate / toRate;
  const len = Math.floor(data.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    out[i] = data[i0] * (1 - frac) + (data[Math.min(data.length - 1, i0 + 1)] ?? 0) * frac;
  }
  return out;
}

/** 10 Hz RMS + peak envelope. */
export function computeEnvelope(mono: Float32Array, sampleRate: number): LoudnessPoint[] {
  const win = Math.max(1, Math.round(sampleRate * 0.1));
  const points: LoudnessPoint[] = [];
  for (let start = 0, t = 0; start < mono.length; start += win, t += 0.1) {
    let sum = 0, peak = 0;
    const end = Math.min(mono.length, start + win);
    for (let i = start; i < end; i++) {
      const v = mono[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    points.push({ t: Math.round(t * 10) / 10, rms: Math.sqrt(sum / Math.max(1, end - start)), peak });
  }
  return points;
}

export const rmsToDb = (rms: number) => (rms > 1e-7 ? 20 * Math.log10(rms) : -100);

/** Silence spans below threshold for at least minMs. Edges snapped to 10 Hz grid. */
export function detectSilences(env: LoudnessPoint[], thresholdDb: number, minMs: number, duration: number): SilenceSpan[] {
  const minLen = minMs / 1000;
  const spans: SilenceSpan[] = [];
  let runStart: number | null = null;
  for (const p of env) {
    const quiet = rmsToDb(p.rms) < thresholdDb;
    if (quiet && runStart === null) runStart = p.t;
    if (!quiet && runStart !== null) {
      if (p.t - runStart >= minLen) spans.push({ start: runStart, end: p.t });
      runStart = null;
    }
  }
  if (runStart !== null && duration - runStart >= minLen) spans.push({ start: runStart, end: duration });
  return spans;
}

/** K-weighted gated loudness ≈ LUFS. Uses OfflineAudioContext biquads. */
export async function measureLoudness(buffer: AudioBuffer): Promise<{ integrated: number; truePeak: number }> {
  const mono = toMono(buffer);
  let truePeak = 0;
  for (let i = 0; i < mono.length; i++) truePeak = Math.max(truePeak, Math.abs(mono[i]));
  try {
    const off = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
    const src = off.createBufferSource();
    const mb = off.createBuffer(1, buffer.length, buffer.sampleRate);
    mb.copyToChannel(mono, 0);
    src.buffer = mb;
    // K-weighting approximation: high shelf +4 dB @1681 Hz, then high-pass 38 Hz
    const shelf = off.createBiquadFilter();
    shelf.type = 'highshelf'; shelf.frequency.value = 1681; shelf.gain.value = 4; shelf.Q.value = 0.707;
    const hp = off.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    src.connect(shelf); shelf.connect(hp); hp.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const d = rendered.getChannelData(0);
    const sr = rendered.sampleRate;
    const blockLen = Math.round(sr * 0.4);
    const hop = Math.round(sr * 0.1);
    const blocks: number[] = [];
    for (let s = 0; s + blockLen <= d.length; s += hop) {
      let sum = 0;
      for (let i = s; i < s + blockLen; i++) sum += d[i] * d[i];
      const ms = sum / blockLen;
      blocks.push(ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -100);
    }
    const absGated = blocks.filter((b) => b > -70);
    if (!absGated.length) return { integrated: -70, truePeak };
    const meanAbs = absGated.reduce((a, b) => a + Math.pow(10, b / 10), 0) / absGated.length;
    const relThr = -0.691 + 10 * Math.log10(meanAbs) - 10;
    const gated = absGated.filter((b) => b > relThr);
    const mean = gated.reduce((a, b) => a + Math.pow(10, b / 10), 0) / Math.max(1, gated.length);
    return { integrated: Math.round((-0.691 + 10 * Math.log10(mean)) * 10) / 10, truePeak };
  } catch {
    // fallback: plain RMS loudness
    let sum = 0;
    for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, mono.length));
    return { integrated: Math.round(rmsToDb(rms) * 10) / 10, truePeak };
  }
}

/* ---------- FFT (radix-2) ---------- */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Spectral-flux onset envelope at ~43 Hz (22050 / 512). */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): { flux: Float32Array; hopSec: number; flatness: Float32Array } {
  const sr = 22050;
  const data = resampleLinear(mono, sampleRate, sr);
  const N = 1024, hop = 512;
  const frames = Math.max(0, Math.floor((data.length - N) / hop));
  const flux = new Float32Array(frames);
  const flatness = new Float32Array(frames);
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N), im = new Float32Array(N);
  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) { re[i] = data[off + i] * window[i]; im[i] = 0; }
    fft(re, im);
    let sumFlux = 0, logSum = 0, linSum = 0;
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const diff = mag - prev[k];
      if (diff > 0) sumFlux += diff;
      prev[k] = mag;
      logSum += Math.log(mag + 1e-9);
      linSum += mag;
    }
    flux[f] = sumFlux;
    flatness[f] = Math.exp(logSum / (N / 2 - 1)) / (linSum / (N / 2 - 1) + 1e-9);
  }
  return { flux, hopSec: hop / sr, flatness };
}

/** Beat grid: peak-pick onsets, autocorrelation tempo 60-180 BPM, phase align. */
export function detectBeats(flux: Float32Array, hopSec: number, duration: number): { beats: number[]; bpm: number; strength: number } {
  if (flux.length < 32) return { beats: [], bpm: 0, strength: 0 };
  // normalize + smooth
  let mean = 0;
  for (const v of flux) mean += v;
  mean /= flux.length;
  let std = 0;
  for (const v of flux) std += (v - mean) * (v - mean);
  std = Math.sqrt(std / flux.length) || 1;
  const norm = Float32Array.from(flux, (v) => Math.max(0, (v - mean) / std));
  // peak pick
  const peaks: number[] = [];
  for (let i = 2; i < norm.length - 2; i++) {
    if (norm[i] > 0.6 && norm[i] >= norm[i - 1] && norm[i] >= norm[i + 1] && norm[i] > norm[i - 2] && norm[i] > norm[i + 2]) peaks.push(i);
  }
  if (peaks.length < 4) return { beats: [], bpm: 0, strength: 0 };
  // autocorrelation over lag range
  const fps = 1 / hopSec;
  const minLag = Math.round((fps * 60) / 180), maxLag = Math.round((fps * 60) / 60);
  let bestLag = 0, bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    for (const p of peaks) {
      const q = p + lag;
      // nearest peak distance
      let nearest = Infinity;
      for (const r of peaks) { const d = Math.abs(r - q); if (d < nearest) nearest = d; if (r > q + 2) break; }
      if (nearest <= 2) score += 1 - nearest / 3;
    }
    score /= peaks.length;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore < 0.18) return { beats: [], bpm: 0, strength: bestScore };
  const periodSec = bestLag * hopSec;
  const bpm = Math.round(60 / periodSec);
  // phase: try offsets, maximize onset energy on grid
  let bestPhase = 0, bestE = -1;
  for (let ph = 0; ph < bestLag; ph += Math.max(1, Math.floor(bestLag / 24))) {
    let e = 0;
    for (let i = ph; i < norm.length; i += bestLag) e += norm[i];
    if (e > bestE) { bestE = e; bestPhase = ph; }
  }
  const beats: number[] = [];
  for (let t = bestPhase * hopSec; t < duration; t += periodSec) beats.push(Math.round(t * 1000) / 1000);
  return { beats, bpm, strength: bestScore };
}

/** Speech vs music heuristic + emphasis points. */
export function classifyAudio(env: LoudnessPoint[], flatness: Float32Array, beatStrength: number, silences: SilenceSpan[], duration: number): { speechRatio: number; isMusic: boolean } {
  const active = env.filter((p) => rmsToDb(p.rms) > -45).length / Math.max(1, env.length);
  let fMean = 0, fVar = 0;
  for (const v of flatness) fMean += v;
  fMean /= Math.max(1, flatness.length);
  for (const v of flatness) fVar += (v - fMean) * (v - fMean);
  fVar /= Math.max(1, flatness.length);
  const silenceRatio = silences.reduce((a, s) => a + (s.end - s.start), 0) / Math.max(0.1, duration);
  // music: steady beat, low flatness variance, few long silences
  const isMusic = beatStrength > 0.32 && fVar < 0.004 && silenceRatio < 0.2 && active > 0.7;
  const speechRatio = isMusic ? Math.max(0, 0.3 - beatStrength) : Math.min(1, active * (0.5 + silenceRatio));
  return { speechRatio: Math.round(speechRatio * 100) / 100, isMusic };
}

export function detectEmphasis(env: LoudnessPoint[], silences: SilenceSpan[]): number[] {
  const out: number[] = [];
  const speech = env.filter((p) => !silences.some((s) => p.t >= s.start && p.t < s.end));
  if (speech.length < 5) return out;
  const sorted = [...speech].map((p) => p.rms).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let last = -10;
  for (let i = 2; i < speech.length - 2; i++) {
    const p = speech[i];
    if (p.rms > median * 1.45 && p.rms >= speech[i - 1].rms && p.rms >= speech[i + 1].rms && p.t - last > 1.5) {
      out.push(p.t);
      last = p.t;
    }
  }
  return out;
}

export async function analyzeAudio(buffer: AudioBuffer, opts: { silenceThresholdDb: number; silenceMinMs: number }): Promise<AudioAnalysisResult> {
  const mono = toMono(buffer);
  const env = computeEnvelope(mono, buffer.sampleRate);
  const silences = detectSilences(env, opts.silenceThresholdDb, opts.silenceMinMs, buffer.duration);
  const { integrated, truePeak } = await measureLoudness(buffer);
  const { flux, hopSec, flatness } = onsetEnvelope(mono, buffer.sampleRate);
  const { beats, bpm, strength } = detectBeats(flux, hopSec, buffer.duration);
  const { speechRatio, isMusic } = classifyAudio(env, flatness, strength, silences, buffer.duration);
  const emphasis = detectEmphasis(env, silences);
  // Waveform peaks: 100 bins per second, local max of |sample|. Cheap enough
  // for long files because it is a single linear scan of the mono buffer.
  const peaks: { t: number; peak: number }[] = [];
  const win = Math.max(64, Math.floor(buffer.sampleRate / 100));
  for (let i = 0; i < mono.length; i += win) {
    let max = 0;
    for (let j = i; j < Math.min(mono.length, i + win); j++) max = Math.max(max, Math.abs(mono[j]));
    peaks.push({ t: i / buffer.sampleRate, peak: max });
  }
  return { peaks, loudness: env, silences, integratedLoudness: integrated, truePeak, speechRatio, isMusic, beats, bpm, emphasis };
}