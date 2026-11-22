/**
 * Main-thread client for the Whisper worker. Resamples audio to 16 kHz mono,
 * streams progress, converts whisper chunks into word timestamps + segments.
 */
import type { TranscriptSegment, TranscriptWord } from '../engine/types';
import { resampleLinear, toMono } from './audioAnalysis';
import { segmentWords } from './textAnalysis';

export type WhisperModel = 'onnx-community/whisper-tiny.en' | 'onnx-community/whisper-tiny' | 'onnx-community/whisper-base.en' | 'onnx-community/whisper-base';

export interface TranscriptProgress { stage: 'download' | 'load' | 'transcribe'; pct: number; note?: string }

export class TranscriptClient {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: TranscriptProgress) => void }>();
  private seq = 0;
  private loadedModel: string | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        if (type === 'progress') p.onProgress?.({ stage: 'download', pct: e.data.pct ?? 0, note: e.data.file });
        else if (type === 'ready') { this.pending.delete(id); p.resolve(true); }
        else if (type === 'result') { this.pending.delete(id); p.resolve(e.data.out); }
        else if (type === 'error') { this.pending.delete(id); p.reject(new Error(e.data.message)); }
      };
      this.worker.onerror = (e) => {
        for (const [, p] of this.pending) p.reject(new Error(e.message || 'Whisper worker failed'));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call(type: string, payload: any, onProgress?: (p: TranscriptProgress) => void): Promise<any> {
    const worker = this.ensureWorker();
    const id = `w${this.seq++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ type, id, ...payload });
    });
  }

  async load(model: WhisperModel, onProgress?: (p: TranscriptProgress) => void): Promise<void> {
    if (this.loadedModel === model) return;
    await this.call('load', { model }, onProgress);
    this.loadedModel = model;
  }

  async transcribe(
    buffer: AudioBuffer,
    model: WhisperModel,
    language: string | undefined,
    onProgress?: (p: TranscriptProgress) => void
  ): Promise<{ segments: TranscriptSegment[]; words: TranscriptWord[]; language?: string; model: string }> {
    await this.load(model, onProgress);
    onProgress?.({ stage: 'transcribe', pct: 0.05, note: 'Preparing audio' });
    const mono = toMono(buffer);
    const audio = resampleLinear(mono, buffer.sampleRate, 16000);
    onProgress?.({ stage: 'transcribe', pct: 0.15, note: 'Running Whisper (this can take a while on CPU)' });
    const out = await this.call('transcribe', { audio, language }, (p) => onProgress?.(p));
    onProgress?.({ stage: 'transcribe', pct: 0.95, note: 'Aligning words' });

    const words: TranscriptWord[] = [];
    const chunks: { text: string; timestamp: [number, number] }[] = out?.chunks ?? [];
    if (chunks.length) {
      for (const ch of chunks) {
        const text = ch.text.trim();
        if (!text) continue;
        const [s, e] = ch.timestamp ?? [0, 0];
        const parts = text.split(/\s+/);
        if (parts.length === 1) {
          words.push({ word: parts[0], start: s ?? 0, end: Math.max((s ?? 0) + 0.08, e ?? s + 0.2) });
        } else {
          // chunk contains several words: distribute time by character length
          const total = parts.reduce((a, w) => a + w.length, 0);
          let t = s ?? 0;
          const span = Math.max(0.1, (e ?? t + 0.3) - t);
          for (const part of parts) {
            const d = (part.length / total) * span;
            words.push({ word: part, start: t, end: t + d });
            t += d;
          }
        }
      }
    } else if (out?.text) {
      // no timestamps: interpolate across the whole audio
      const parts = out.text.trim().split(/\s+/);
      const per = buffer.duration / Math.max(1, parts.length);
      parts.forEach((w: string, i: number) => words.push({ word: w, start: i * per, end: (i + 1) * per }));
    }
    // sanity: monotonic times
    for (let i = 1; i < words.length; i++) {
      if (words[i].start < words[i - 1].end) words[i].start = words[i - 1].end;
      if (words[i].end <= words[i].start) words[i].end = words[i].start + 0.06;
    }
    const segments = segmentWords(words);
    onProgress?.({ stage: 'transcribe', pct: 1 });
    return { segments, words, language: out?.language, model };
  }

  /** Stop any in-flight load/transcription and clean up the worker. */
  cancelAll() {
    for (const [, p] of this.pending) p.reject(new Error('Cancelled by user'));
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.loadedModel = null;
  }

  /** Drop the in-memory pipeline for one model after its cache was cleared. */
  forget(model: WhisperModel) {
    if (this.loadedModel === model) {
      this.worker?.terminate();
      this.worker = null;
      this.loadedModel = null;
    }
  }

  dispose() {
    this.cancelAll();
  }
}

export const transcriptClient = new TranscriptClient();