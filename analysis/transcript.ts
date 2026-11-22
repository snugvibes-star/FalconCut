/**
 * Main-thread client for the Whisper worker. Resamples audio to 16 kHz mono,
 * processes long videos in overlapping chunks, streams progress, and converts
 * ASR output into word timestamps + segments. Audio never leaves the device.
 */
import type { TranscriptSegment, TranscriptWord } from '../engine/types';
import { resampleLinear, toMono } from './audioAnalysis';
import { segmentWords } from './textAnalysis';

export type WhisperModel = 'onnx-community/whisper-tiny.en' | 'onnx-community/whisper-tiny' | 'onnx-community/whisper-base.en' | 'onnx-community/whisper-base';
export type AsrMode = 'word' | 'chunk' | 'text';

export interface TranscriptProgress { stage: 'download' | 'load' | 'transcribe'; pct: number; note?: string }
export interface TranscribeOptions {
  /** Length of each processingwindow in seconds. Default 30. */
  chunkSec?: number;
  /** Overlap between windows in seconds. Default 2. */
  overlapSec?: number;
}

const SAMPLE_RATE = 16000;
const MIN_CHUNK_SEC = 8;
const MAX_CHUNK_SEC = 60;

/** Convert one ASR result into words. Exported so timing behaviour is testable. */
export function wordsFromAsr(
  out: any,
  durationSec: number,
  estimated: boolean,
  mode: AsrMode,
): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  const chunks: { text: string; timestamp: [number, number] }[] = out?.chunks ?? [];
  if (chunks.length) {
    for (const ch of chunks) {
      const text = ch.text.trim();
      if (!text) continue;
      const [s, e] = ch.timestamp ?? [0, 0];
      const parts = text.split(/\s+/);
      const flag = (mode !== 'word' || parts.length > 1) ? { estimated: true } : {};
      if (parts.length === 1) {
        words.push({ word: parts[0], start: s ?? 0, end: Math.max((s ?? 0) + 0.08, e ?? s + 0.2), ...flag });
      } else {
        const total = parts.reduce((a, w) => a + w.length, 0);
        let t = s ?? 0;
        const span = Math.max(0.1, (e ?? t + 0.3) - t);
        for (const part of parts) {
          const d = (part.length / total) * span;
          words.push({ word: part, start: t, end: t + d, estimated: true });
          t += d;
        }
      }
    }
  } else if (out?.text) {
    const parts = out.text.trim().split(/\s+/);
    const per = durationSec / Math.max(1, parts.length);
    parts.forEach((w: string, i: number) => words.push({
      word: w, start: i * per, end: (i + 1) * per, estimated: true,
    }));
  }
  // Make timing monotonic and sane.
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].end) words[i].start = words[i - 1].end;
    if (words[i].end <= words[i].start) words[i].end = words[i].start + 0.06;
  }
  return words.filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
}

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
        if (type === 'progress') {
          const note = e.data.note ?? e.data.file;
          const stage = e.data.file === 'timing' ? 'transcribe'
            : /Model ready|Downloading/i.test(String(note ?? '')) ? 'download' : 'transcribe';
          p.onProgress?.({ stage, pct: e.data.pct ?? 0, note });
        }
        else if (type === 'ready') { this.pending.delete(id); p.resolve(true); }
        else if (type === 'result') {
          this.pending.delete(id);
          p.resolve({ out: e.data.out, estimated: !!e.data.estimated, mode: e.data.mode ?? 'word' });
        }
        else if (type === 'chunk_result') {
          this.pending.delete(id);
          p.resolve({ out: e.data.out, estimated: !!e.data.estimated, mode: e.data.mode ?? 'word', offset: e.data.offset ?? 0 });
        }
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
    onProgress?: (p: TranscriptProgress) => void,
    options: TranscribeOptions = {},
  ): Promise<{ segments: TranscriptSegment[]; words: TranscriptWord[]; language?: string; model: string; estimated: boolean; note?: string }> {
    await this.load(model, onProgress);
    onProgress?.({ stage: 'transcribe', pct: 0.03, note: 'Preparing audio' });

    const mono = toMono(buffer);
    const audio = resampleLinear(mono, buffer.sampleRate, SAMPLE_RATE);
    const totalSec = audio.length / SAMPLE_RATE;

    const wanted = Math.max(MIN_CHUNK_SEC, Math.min(MAX_CHUNK_SEC, options.chunkSec ?? 30));
    const overlap = Math.max(0, Math.min(5, options.overlapSec ?? 2));
    const useChunks = totalSec > wanted + overlap;

    const words: TranscriptWord[] = [];
    let estimated = false;
    let languageDetected: string | undefined;
    let acceptedUntil = -Infinity;
    let chunkIndex = 0;
    const chunkCount = useChunks
      ? Math.ceil(totalSec / Math.max(1, wanted - overlap)) : 1;

    const consume = (response: any, offset: number, chunkSec: number) => {
      const out = response?.out ?? response;
      const isEstimated = !!response?.estimated || !!out?.estimatedTimestamps;
      const mode: AsrMode = response?.mode ?? (isEstimated ? 'chunk' : 'word');
      estimated = estimated || isEstimated;
      languageDetected = languageDetected || out?.language;
      const local = wordsFromAsr(out, chunkSec, isEstimated, mode);
      for (const w of local) {
        const start = w.start + offset;
        // Drop words already covered by the overlapping previous chunk.
        if (start < acceptedUntil - 0.1) continue;
        const end = w.end + offset;
        words.push({ ...w, start, end });
        if (end > acceptedUntil) acceptedUntil = end;
      }
    };

    if (useChunks) {
      const stride = Math.max(1, wanted - overlap);
      for (let start = 0; start < totalSec; start += stride) {
        const from = Math.floor(start * SAMPLE_RATE);
        const to = Math.min(audio.length, Math.floor((start + wanted) * SAMPLE_RATE));
        if (to - from < SAMPLE_RATE) break;
        // Copy only this window — structured clone of a subarray view can copy
        // the entire source buffer and blow memory on long videos.
        const chunk = new Float32Array(audio.subarray(from, to));
        onProgress?.({
          stage: 'transcribe',
          pct: 0.05 + 0.9 * (chunkIndex / chunkCount),
          note: `Transcribing ${chunkIndex + 1}/${chunkCount} (${start.toFixed(0)}s–${Math.min(totalSec, start + wanted).toFixed(0)}s)`,
        });
        const response = await this.call('transcribe_chunk', { audio: chunk, offset: start }, (p) => {
          onProgress?.({
            stage: 'transcribe',
            pct: 0.05 + 0.9 * ((chunkIndex + p.pct) / chunkCount),
            note: p.note ?? `Transcribing ${chunkIndex + 1}/${chunkCount}`,
          });
        });
        consume(response, start, chunk.length / SAMPLE_RATE);
        chunkIndex++;
      }
    } else {
      onProgress?.({ stage: 'transcribe', pct: 0.15, note: 'Running Whisper (this can take a while on CPU)' });
      const response = await this.call('transcribe', { audio, language }, (p) => onProgress?.(p));
      consume(response, 0, totalSec);
    }

    words.sort((a, b) => a.start - b.start || a.end - b.end);
    const segments = segmentWords(words);
    onProgress?.({ stage: 'transcribe', pct: 1, note: `Transcribed ${words.length} words` });
    const note = estimated
      ? 'This model has no word-level timestamps. Word timing is estimated from recognized text and is fully editable.'
      : undefined;
    return {
      segments, words, language: languageDetected, model, estimated, note,
    };
  }

  /** Transcribe one already-extracted audio window. Used by the chunk job. */
  async transcribeSegment(
    audio: Float32Array,
    offset: number,
    model: WhisperModel,
    language: string | undefined,
    onProgress?: (p: TranscriptProgress) => void,
  ): Promise<any> {
    await this.load(model, onProgress);
    return this.call('transcribe_chunk', { audio, offset }, onProgress);
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
