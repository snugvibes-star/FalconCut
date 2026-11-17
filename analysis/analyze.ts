/**
 * Analysis orchestrator + task queue. Runs in the background after import,
 * reports progress per stage, stores results in the project JSON.
 * Transcription is optional (needs a one-time model download).
 */
import type { Analysis, MediaAnalysis, MediaAsset, Project } from '../engine/types';
import { analyzeAudio, detectSilences } from './audioAnalysis';
import { analyzeFrames } from './frames';
import { detectFillers, detectRetakes, extractKeywords, textEmphasis } from './textAnalysis';
import { transcriptClient, type TranscriptProgress, type WhisperModel } from './transcript';
import { buildStoryboard } from './storyboard';

export interface AnalyzeOptions {
  transcribe: boolean;
  model: WhisperModel;
  language?: string;
  silenceThresholdDb: number;
  silenceMinMs: number;
}

export const defaultAnalyzeOptions: AnalyzeOptions = {
  transcribe: false,
  model: 'onnx-community/whisper-tiny.en',
  silenceThresholdDb: -38,
  silenceMinMs: 600,
};

export type ProgressFn = (stage: string, pct: number, note?: string) => void;

async function decodeBlob(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    return buf;
  } catch {
    return null;
  }
}

export async function analyzeMedia(
  asset: MediaAsset,
  blob: Blob | null,
  opts: AnalyzeOptions,
  onProgress: ProgressFn
): Promise<MediaAnalysis> {
  const flags: string[] = [];
  const ma: MediaAnalysis = {
    mediaId: asset.id,
    duration: asset.duration,
    silences: [], fillers: [], retakes: [], scenes: [], faces: [], faceMethod: 'none',
    loudness: [], integratedLoudness: -70, truePeak: 0, speechRatio: 0, isMusic: false,
    beats: [], bpm: 0, emphasis: [], keywords: [], analyzedAt: Date.now(), flags,
  };

  if (asset.type === 'image' || asset.type === 'generator') {
    flags.push(asset.type === 'generator' ? 'procedural media: no audio/transcript analysis' : 'still image: no audio analysis');
    if (asset.type === 'image' && blob) {
      try {
        const fr = await analyzeFrames(asset, blob, (p) => onProgress('frames', p), 1);
        ma.faces = fr.faces.slice(0, 1);
        ma.faceMethod = fr.faceMethod;
      } catch { /* image face detect optional */ }
    }
    onProgress('done', 1);
    return ma;
  }

  // Audio
  let audioBuffer: AudioBuffer | null = null;
  if (blob && (asset.type === 'audio' || asset.hasAudio)) {
    onProgress('audio', 0.05, 'Decoding audio');
    audioBuffer = await decodeBlob(blob);
    if (audioBuffer) {
      onProgress('audio', 0.2, 'Loudness, silence, beats');
      const ar = await analyzeAudio(audioBuffer, opts);
      Object.assign(ma, {
        loudness: ar.loudness, silences: ar.silences, integratedLoudness: ar.integratedLoudness,
        truePeak: ar.truePeak, speechRatio: ar.speechRatio, isMusic: ar.isMusic,
        beats: ar.beats, bpm: ar.bpm, emphasis: ar.emphasis,
      });
      if (ar.isMusic) flags.push(`classified as music (~${ar.bpm} BPM)`);
    } else {
      flags.push('audio could not be decoded in this browser (container unsupported)');
    }
  } else if (asset.type === 'video') {
    flags.push('video has no audio track');
  }
  onProgress('audio', 1);

  // Frames (video only)
  if (asset.type === 'video' && blob) {
    try {
      const fr = await analyzeFrames(asset, blob, (p) => onProgress('frames', p));
      ma.scenes = fr.scenes;
      ma.faces = fr.faces;
      ma.faceMethod = fr.faceMethod;
      if (fr.faceMethod === 'skin-heuristic') flags.push('face tracking uses skin-tone heuristic (FaceDetector API unavailable)');
      if (fr.avgLuma < 0.04) flags.push('footage is very dark on average');
    } catch (e) {
      flags.push(`frame analysis failed: ${(e as Error).message}`);
    }
  }
  onProgress('frames', 1);

  // Transcript
  if (opts.transcribe && audioBuffer && !ma.isMusic) {
    try {
      const tr = await transcriptClient.transcribe(audioBuffer, opts.model, opts.language, (p: TranscriptProgress) => {
        onProgress('transcript', p.stage === 'download' ? p.pct * 0.5 : 0.5 + p.pct * 0.5, p.note);
      });
      ma.transcript = { segments: tr.segments, words: tr.words, language: tr.language, model: opts.model, complete: true };
      ma.fillers = detectFillers(tr.words);
      ma.retakes = detectRetakes(tr.words);
      ma.keywords = extractKeywords(tr.words);
      const tEmph = textEmphasis(tr.words);
      ma.emphasis = [...new Set([...ma.emphasis, ...tEmph])].sort((a, b) => a - b);
      if (tr.segments.some((s) => s.speaker)) flags.push('speaker labels are pause-based heuristics, not true diarization');
    } catch (e) {
      flags.push(`transcription failed: ${(e as Error).message} (needs one-time model download + network)`);
      ma.transcript = { segments: [], words: [], model: opts.model, complete: false };
    }
  } else if (!opts.transcribe && audioBuffer && !ma.isMusic) {
    flags.push('transcript disabled — enable it in Analysis settings (one-time Whisper download)');
  }
  onProgress('done', 1);
  ma.analyzedAt = Date.now();
  return ma;
}

/** Recompute only the silence map when the user changes threshold/min length. */
export function recomputeSilences(ma: MediaAnalysis, thresholdDb: number, minMs: number): MediaAnalysis {
  return { ...ma, silences: detectSilences(ma.loudness, thresholdDb, minMs, ma.duration) };
}

export function mergeAnalysis(p: Project, ma: MediaAnalysis, settings: { silenceThresholdDb: number; silenceMinMs: number }): Analysis {
  const byMedia = { ...(p.analysis?.byMedia ?? {}), [ma.mediaId]: ma };
  const next: Analysis = { byMedia, settings, storyboard: '', updatedAt: Date.now() };
  next.storyboard = buildStoryboard({ ...p, analysis: next });
  return next;
}

/* ---------- sequential task queue ---------- */
export interface QueuedTask {
  id: string;
  label: string;
  run: (onProgress: ProgressFn) => Promise<void>;
}

export class TaskQueue {
  private queue: QueuedTask[] = [];
  private running = false;
  current: { task: QueuedTask; stage: string; pct: number; note?: string } | null = null;
  onUpdate: (() => void) | null = null;

  push(task: QueuedTask) {
    this.queue.push(task);
    this.onUpdate?.();
    this.drain();
  }

  cancelAll() {
    this.queue = [];
    this.onUpdate?.();
  }

  get pending() { return this.queue.length; }

  private async drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const task = this.queue.shift()!;
      this.current = { task, stage: 'starting', pct: 0 };
      this.onUpdate?.();
      try {
        await task.run((stage, pct, note) => {
          this.current = { task, stage, pct, note };
          this.onUpdate?.();
        });
      } catch (e) {
        console.error('Task failed:', task.label, e);
      }
      this.current = null;
      this.onUpdate?.();
    }
    this.running = false;
  }
}

export const taskQueue = new TaskQueue();