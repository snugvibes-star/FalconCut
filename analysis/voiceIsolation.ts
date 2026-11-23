/**
 * Voice isolation (DSP, NOT AI stem separation).
 * Spectral-noise suppression with a learned noise floor from the first seconds.
 * Runs entirely on the decoded AudioBuffer, so the derived WAV is consumed by
 * both preview and export through the normal media/audio graph.
 */
import { fft, toMono } from './audioAnalysis';

export interface VoiceIsolationOptions {
  /** 0..1 — how much of the estimated noise floor to remove. */
  reduction?: number;
  /** Seconds of leading audio used to estimate the stationary noise floor. */
  noiseWindow?: number;
}

const N = 1024;
const HOP = N / 2;
const BINS = N / 2 + 1;

function spectrum(frame: Float32Array, window: Float32Array, re: Float32Array, im: Float32Array, mag: Float32Array) {
  for (let i = 0; i < N; i++) { re[i] = frame[i] * window[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < BINS; k++) mag[k] = Math.hypot(re[k], im[k]);
}

export function isolateVoice(buffer: AudioBuffer, options: VoiceIsolationOptions = {}): AudioBuffer {
  const reduction = Math.max(0, Math.min(0.98, options.reduction ?? 0.85));
  const noiseWindow = Math.max(0.2, Math.min(5, options.noiseWindow ?? 1.5));
  const mono = toMono(buffer);
  if (mono.length < N * 2) return buffer;
  const sr = buffer.sampleRate;

  const window = new Float32Array(N);
  for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

  // Estimate the noise floor from quiet frames at the start of the clip.
  const frames: Float32Array[] = [];
  const maxFrame = Math.min(mono.length - N, Math.round(noiseWindow * sr));
  for (let off = 0; off < maxFrame && frames.length < 60; off += HOP) {
    frames.push(mono.subarray(off, off + N));
  }
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(BINS);
  const noise = new Float32Array(BINS);
  const tmp: number[] = [];
  for (const f of frames) { spectrum(f, window, re, im, mag); tmp.push(...mag); }
  for (let k = 0; k < BINS; k++) {
    const sorted = tmp.filter((_, i) => i % BINS === k).sort((a, b) => a - b);
    noise[k] = (sorted[Math.floor(sorted.length * 0.1)] ?? 0) * 1.15;
  }

  const floor = 1 - reduction;
  const out = new Float32Array(mono.length);
  const norm = 1 / (N * 0.5);
  const frame = new Float32Array(N);
  for (let off = 0; off + N <= mono.length; off += HOP) {
    frame.set(mono.subarray(off, off + N));
    spectrum(frame, window, re, im, mag);
    for (let k = 0; k < BINS; k++) {
      const power = mag[k] * mag[k];
      const n = noise[k] * noise[k];
      const gain = Math.max(floor, power > 1e-12 ? 1 - n / power : floor);
      re[k] *= gain; im[k] *= gain;
    }
    // Inverse FFT: conjugate → forward FFT → conjugate / N.
    for (let k = 0; k < N; k++) im[k] = -im[k];
    fft(re, im);
    for (let k = 0; k < N; k++) {
      out[off + k] += re[k] * window[k] * norm;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));

  const ctx = new OfflineAudioContext(1, out.length, sr);
  const result = ctx.createBuffer(1, out.length, sr);
  result.copyToChannel(out, 0);
  return result;
}
