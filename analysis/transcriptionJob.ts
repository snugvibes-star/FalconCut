/**
 * Background chunking job for long-video caption transcription.
 * Owns the chunk queue, sequential inference, pause/resume/cancel, per-chunk
 * retry, and merging of all recognized words back onto the video timeline.
 */
import type { TranscriptWord } from '../engine/types';
import { wordsFromAsr, type TranscriptProgress, type WhisperModel } from './transcript';

export type ChunkStatus = 'waiting' | 'processing' | 'done' | 'failed';
export interface ChunkState {
  index: number;
  start: number;
  end: number;
  status: ChunkStatus;
  error?: string;
  words: TranscriptWord[];
}

export interface JobProgress {
  pct: number;
  stage: string;
  current: number;
  completed: number;
  total: number;
  failed: number;
  elapsed: number;
  etaSec?: number;
  chunks: ChunkState[];
  chunkSec: number;
  overlapSec: number;
}

export interface JobResult {
  words: TranscriptWord[];
  estimated: boolean;
  language?: string;
  note?: string;
}

export interface JobParams {
  audio: Float32Array; // 16 kHz mono
  durationSec: number;
  model: WhisperModel;
  language?: string;
  chunkSec: number;
  overlapSec: number;
  autoRetry: boolean;
  onProgress: (p: JobProgress) => void;
  onDone: (r: JobResult) => void;
  onError: (message: string, result?: JobResult) => void;
}

const SAMPLE_RATE = 16000;

/** Pick a safe chunk size from duration and device memory. */
export function autoChunkSec(durationSec: number): number {
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (durationSec > 900 || (mem != null && mem <= 4)) return 15;
  return 30;
}

export class TranscriptionJob {
  private chunks: ChunkState[] = [];
  private results = new Map<number, { words: TranscriptWord[]; estimated: boolean; language?: string }>();
  private paused = false;
  private cancelled = false;
  private running = false;
  private resumeResolve: (() => void) | null = null;
  private startedAt = 0;
  private current = -1;

  constructor(private client: { transcribeSegment: (...args: any[]) => Promise<any>; cancelAll: () => void }, private p: JobParams) {
    const stride = Math.max(1, p.chunkSec - p.overlapSec);
    for (let start = 0, i = 0; start < p.durationSec - 0.05; start += stride, i++) {
      this.chunks.push({ index: i, start, end: Math.min(p.durationSec, start + p.chunkSec), status: 'waiting', words: [] });
    }
    if (!this.chunks.length) {
      this.chunks.push({ index: 0, start: 0, end: p.durationSec, status: 'waiting', words: [] });
    }
  }

  get total() { return this.chunks.length; }

  start() {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    void this.loop();
  }

  pause() { this.paused = true; }

  resume() {
    this.paused = false;
    this.resumeResolve?.();
    this.resumeResolve = null;
  }

  cancel() {
    this.cancelled = true;
    this.running = false;
    this.paused = false;
    this.resumeResolve?.();
    this.resumeResolve = null;
    this.client.cancelAll();
    this.emit('Transcription cancelled', 0, -1);
  }

  retryFailed() {
    let retried = 0;
    for (const c of this.chunks) {
      if (c.status === 'failed') { c.status = 'waiting'; c.error = undefined; retried++; }
    }
    if (retried && !this.running) this.start();
  }

  private waitIfPaused(): Promise<void> {
    if (!this.paused || this.cancelled) return Promise.resolve();
    return new Promise((resolve) => { this.resumeResolve = resolve; });
  }

  private emit(stage: string, localPct: number, index: number) {
    const done = this.chunks.filter((c) => c.status === 'done').length;
    const failed = this.chunks.filter((c) => c.status === 'failed').length;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const fraction = (done + Math.max(0, Math.min(1, localPct))) / this.chunks.length;
    const etaSec = done > 0 && elapsed > 4 && fraction > 0
      ? Math.max(0, Math.round(elapsed / fraction - elapsed)) : undefined;
    this.p.onProgress({
      pct: Math.max(0, Math.min(1, fraction)),
      stage,
      current: index,
      completed: done,
      failed,
      total: this.chunks.length,
      elapsed: Math.round(elapsed),
      etaSec,
      chunks: this.chunks.map((c) => ({ ...c, words: [...c.words] })),
      chunkSec: this.p.chunkSec,
      overlapSec: this.p.overlapSec,
    });
  }

  private async loop() {
    for (const chunk of this.chunks) {
      if (this.cancelled || !this.running) return;
      if (chunk.status === 'done') continue;
      await this.waitIfPaused();
      if (this.cancelled || !this.running) return;

      chunk.status = 'processing';
      this.current = chunk.index;
      this.emit(`Transcribing chunk ${chunk.index + 1}/${this.chunks.length}`, 0, chunk.index);

      const from = Math.floor(chunk.start * SAMPLE_RATE);
      const to = Math.min(this.p.audio.length, Math.floor(chunk.end * SAMPLE_RATE));
      const window = new Float32Array(this.p.audio.subarray(from, to));

      try {
        const response = await this.client.transcribeSegment(
          window, chunk.start, this.p.model, this.p.language,
          (progress: TranscriptProgress) => this.emit(
            progress.note ?? `Transcribing chunk ${chunk.index + 1}/${this.chunks.length}`,
            progress.pct, chunk.index,
          ),
        );
        if (this.cancelled) return;
        const out = response?.out ?? response;
        const estimated = !!response?.estimated || !!out?.estimatedTimestamps;
        const mode = response?.mode ?? (estimated ? 'chunk' : 'word');
        const local = wordsFromAsr(out, window.length / SAMPLE_RATE, estimated, mode)
          .map((w) => ({ ...w, start: w.start + chunk.start, end: w.end + chunk.start }));
        chunk.words = local;
        chunk.status = 'done';
        this.results.set(chunk.index, { words: local, estimated, language: out?.language });
        this.emit(`Chunk ${chunk.index + 1}/${this.chunks.length} complete`, 1, chunk.index);
      } catch (err) {
        if (this.cancelled) return;
        chunk.status = 'failed';
        chunk.error = (err as Error).message;
        this.emit(`Chunk ${chunk.index + 1}/${this.chunks.length} failed — ${chunk.error}`, 0, chunk.index);
        if (!this.p.autoRetry) {
          // Keep going with later chunks; the failed one can be retried alone.
          continue;
        }
        chunk.status = 'waiting';
        try { await this.loopChunk(chunk); } catch (e) {
          chunk.status = 'failed';
          chunk.error = (e as Error).message;
          this.emit(`Chunk ${chunk.index + 1}/${this.chunks.length} failed — ${chunk.error}`, 0, chunk.index);
        }
      }
    }

    this.running = false;
    if (this.cancelled) return;
    const failed = this.chunks.filter((c) => c.status === 'failed');
    if (failed.length) {
      this.p.onError(`${failed.length} chunk${failed.length === 1 ? '' : 's'} failed. Completed chunks were kept.`, this.merge());
      return;
    }
    this.p.onDone(this.merge());
  }

  /** One retry attempt inside automatic-retry flow. */
  private async loopChunk(chunk: ChunkState): Promise<void> {
    const from = Math.floor(chunk.start * SAMPLE_RATE);
    const to = Math.min(this.p.audio.length, Math.floor(chunk.end * SAMPLE_RATE));
    const window = new Float32Array(this.p.audio.subarray(from, to));
    chunk.status = 'processing';
    const response = await this.client.transcribeSegment(
      window, chunk.start, this.p.model, this.p.language,
      (progress: TranscriptProgress) => this.emit(`Retrying chunk ${chunk.index + 1}`, progress.pct, chunk.index),
    );
    const out = response?.out ?? response;
    const estimated = !!response?.estimated || !!out?.estimatedTimestamps;
    const mode = response?.mode ?? (estimated ? 'chunk' : 'word');
    chunk.words = wordsFromAsr(out, window.length / SAMPLE_RATE, estimated, mode)
      .map((w) => ({ ...w, start: w.start + chunk.start, end: w.end + chunk.start }));
    chunk.status = 'done';
    this.results.set(chunk.index, { words: chunk.words, estimated, language: out?.language });
  }

  private merge(): JobResult {
    let acceptedUntil = -Infinity;
    const words: TranscriptWord[] = [];
    let estimated = false;
    let language: string | undefined;
    for (const chunk of [...this.chunks].sort((a, b) => a.start - b.start)) {
      const r = this.results.get(chunk.index);
      if (!r) continue;
      estimated = estimated || r.estimated;
      language = language || r.language;
      for (const w of r.words) {
        if (w.start < acceptedUntil - 0.12) continue; // overlap duplicate
        words.push(w);
        if (w.end > acceptedUntil) acceptedUntil = w.end;
      }
    }
    words.sort((a, b) => a.start - b.start || a.end - b.end);
    return {
      words,
      estimated,
      language,
      note: estimated ? 'Some word timing was estimated from recognized text and is fully editable.' : undefined,
    };
  }
}
