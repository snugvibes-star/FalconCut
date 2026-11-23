/**
 * Real video export through WebCodecs. Frames come from the SAME deterministic
 * renderFrame used by the preview (via ExportFrameResolver), audio from the SAME
 * mixProjectAudio graph, so what you see/hear is what you get. H.264/AAC into MP4
 * when the browser supports it, otherwise VP9/VP8 + Opus into WebM.
 */
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { projectDuration, type Project } from '../engine/types';
import { renderFrame } from '../engine/render';
import { collectFrameRequests, ExportFrameResolver, prepareExportFonts } from './frames';
import { mixProjectAudio } from './artifacts';
import { checkAbort, type BlobLoader } from './lifecycle';

export type ExportQuality = 'draft' | 'standard' | 'high';
export interface VideoExportOptions {
  quality: ExportQuality;
  /** Output resolution multiplier (1 = project resolution). */
  scale: number;
  includeAudio: boolean;
}
export interface VideoExportProgress {
  stage: 'prepare' | 'video' | 'audio' | 'finalize';
  pct: number; // 0..1 overall
  frame: number;
  totalFrames: number;
}
export interface VideoExportResult {
  blob: Blob;
  container: 'mp4' | 'webm';
  videoCodec: string;
  hasAudio: boolean;
  frames: number;
  width: number;
  height: number;
}

const QUALITY_MULT: Record<ExportQuality, number> = { draft: 0.55, standard: 1, high: 1.7 };

interface CodecPlan {
  container: 'mp4' | 'webm';
  videoCodec: string;
  muxVideoCodec: string;
  audioCodec: string | null;
  muxAudioCodec: string | null;
}

async function pickCodecPlan(width: number, height: number, fps: number, bitrate: number, wantAudio: boolean): Promise<CodecPlan> {
  const vBase = { width, height, bitrate, framerate: fps };
  const candidates: { container: 'mp4' | 'webm'; codec: string; mux: string; extra?: Record<string, unknown> }[] = [
    { container: 'mp4', codec: 'avc1.640028', mux: 'avc', extra: { avc: { format: 'avc' } } },
    { container: 'mp4', codec: 'avc1.42001f', mux: 'avc', extra: { avc: { format: 'avc' } } },
    { container: 'webm', codec: 'vp09.00.10.08', mux: 'V_VP9' },
    { container: 'webm', codec: 'vp8', mux: 'V_VP8' },
  ];
  for (const c of candidates) {
    const cfg = { ...vBase, codec: c.codec, ...(c.extra ?? {}) } as VideoEncoderConfig;
    try {
      const sup = await VideoEncoder.isConfigSupported(cfg);
      if (!sup.supported) continue;
    } catch { continue; }
    let audioCodec: string | null = null;
    let muxAudioCodec: string | null = null;
    if (wantAudio) {
      const aCodec = c.container === 'mp4' ? 'mp4a.40.2' : 'opus';
      try {
        const sup = await AudioEncoder.isConfigSupported({ codec: aCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });
        if (sup.supported) { audioCodec = aCodec; muxAudioCodec = c.container === 'mp4' ? 'aac' : 'A_OPUS'; }
      } catch { /* no audio */ }
    }
    return { container: c.container, videoCodec: c.codec, muxVideoCodec: c.mux, audioCodec, muxAudioCodec };
  }
  throw new Error('This browser has no usable WebCodecs video encoder (H.264/VP9/VP8). Try Chrome or Edge.');
}

function backpressure(enc: VideoEncoder | AudioEncoder, max: number): Promise<void> {
  if (enc.encodeQueueSize <= max) return Promise.resolve();
  return new Promise((resolve) => {
    const h = () => { if (enc.encodeQueueSize <= max) { enc.removeEventListener('dequeue', h); resolve(); } };
    enc.addEventListener('dequeue', h);
  });
}

export async function exportVideo(
  project: Project,
  loadBlob: BlobLoader,
  opts: VideoExportOptions,
  onProgress: (p: VideoExportProgress) => void,
  signal?: AbortSignal,
): Promise<VideoExportResult> {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Add clips before exporting video.');
  const fps = Math.max(1, Math.round(project.settings.fps || 30));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const width = even(project.settings.width * opts.scale);
  const height = even(project.settings.height * opts.scale);
  const totalFrames = Math.max(1, Math.ceil(duration * fps));
  const bitrate = Math.round(width * height * fps * 0.09 * QUALITY_MULT[opts.quality]);

  onProgress({ stage: 'prepare', pct: 0, frame: 0, totalFrames });
  checkAbort(signal);
  const plan = await pickCodecPlan(width, height, fps, bitrate, opts.includeAudio);
  await prepareExportFonts(project, signal);

  // Audio is optional: mixed through the same graph as preview/WAV export.
  let audio: AudioBuffer | null = null;
  if (plan.audioCodec) {
    // Never downgrade to a silent video behind the user's back: if the mix
    // fails (missing source, undecodable audio, >30 min), fail loudly instead.
    try { audio = await mixProjectAudio(project, loadBlob); }
    catch (e) { throw new Error(`Audio mix failed — export stopped to avoid a silent video. ${e instanceof Error ? e.message : String(e)}`); }
  }
  const hasAudio = !!audio && !!plan.muxAudioCodec;

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Cannot create a 2D context for export.');
  const resolver = new ExportFrameResolver(project, loadBlob, signal);

  let encError: Error | null = null;
  const fail = (e: Error) => { encError = e; };

  // Muxer + encoders ------------------------------------------------------
  let mp4: Mp4Muxer<Mp4Target> | null = null;
  let webm: WebmMuxer<WebmTarget> | null = null;
  let mp4Target: Mp4Target | null = null;
  let webmTarget: WebmTarget | null = null;
  const addVideo = (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => {
    if (mp4) mp4.addVideoChunk(chunk, meta);
    else if (webm) webm.addVideoChunk(chunk, meta);
  };
  const addAudio = (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => {
    if (mp4) mp4.addAudioChunk(chunk, meta);
    else if (webm) webm.addAudioChunk(chunk, meta);
  };

  if (plan.container === 'mp4') {
    mp4Target = new Mp4Target();
    mp4 = new Mp4Muxer({
      target: mp4Target,
      video: { codec: plan.muxVideoCodec as 'avc', width, height, frameRate: fps },
      ...(hasAudio ? { audio: { codec: plan.muxAudioCodec as 'aac', numberOfChannels: audio!.numberOfChannels, sampleRate: audio!.sampleRate } } : {}),
      fastStart: 'in-memory',
    });
  } else {
    webmTarget = new WebmTarget();
    webm = new WebmMuxer({
      target: webmTarget,
      video: { codec: plan.muxVideoCodec, width, height, frameRate: fps },
      ...(hasAudio ? { audio: { codec: plan.muxAudioCodec!, numberOfChannels: audio!.numberOfChannels, sampleRate: audio!.sampleRate } } : {}),
    });
  }

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => addVideo(chunk, meta),
    error: (e) => fail(e instanceof Error ? e : new Error(String(e))),
  });
  videoEncoder.configure({
    codec: plan.videoCodec, width, height, bitrate, framerate: fps,
    latencyMode: 'quality',
    ...(plan.container === 'mp4' ? { avc: { format: 'avc' } } : {}),
  } as VideoEncoderConfig);

  let audioEncoder: AudioEncoder | null = null;
  if (hasAudio) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => addAudio(chunk, meta),
      error: (e) => fail(e instanceof Error ? e : new Error(String(e))),
    });
    audioEncoder.configure({ codec: plan.audioCodec!, sampleRate: audio!.sampleRate, numberOfChannels: audio!.numberOfChannels, bitrate: 128000 });
  }

  const cleanup = () => {
    resolver.dispose();
    try { videoEncoder.close(); } catch { /* already closed */ }
    try { audioEncoder?.close(); } catch { /* already closed */ }
  };

  try {
    // Video frames -------------------------------------------------------
    const keyEvery = Math.max(1, Math.round(fps * 2));
    for (let i = 0; i < totalFrames; i++) {
      checkAbort(signal);
      if (encError) throw encError;
      const t = Math.min(duration - 0.0001, i / fps);
      const requests = collectFrameRequests(project, t, ctx);
      await resolver.prepare(requests);
      renderFrame(project, t, ctx, resolver);
      const timestamp = Math.round((i * 1e6) / fps);
      const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(1e6 / fps) });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      await backpressure(videoEncoder, 8);
      onProgress({ stage: 'video', pct: (i / totalFrames) * 0.8, frame: i, totalFrames });
    }
    checkAbort(signal);
    if (encError) throw encError;
    await videoEncoder.flush();

    // Audio --------------------------------------------------------------
    if (audioEncoder && audio) {
      const sr = audio.sampleRate;
      const ch = audio.numberOfChannels;
      const chunkFrames = 4800;
      const total = audio.length;
      for (let off = 0; off < total; off += chunkFrames) {
        checkAbort(signal);
        if (encError) throw encError;
        const n = Math.min(chunkFrames, total - off);
        const planar = new Float32Array(n * ch);
        for (let c = 0; c < ch; c++) {
          planar.set(audio.getChannelData(c).subarray(off, off + n), c * n);
        }
        const data = new AudioData({
          format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch,
          timestamp: Math.round((off * 1e6) / sr), data: planar,
        });
        audioEncoder.encode(data);
        data.close();
        await backpressure(audioEncoder, 16);
        onProgress({ stage: 'audio', pct: 0.8 + (off / total) * 0.15, frame: totalFrames, totalFrames });
      }
      await audioEncoder.flush();
    }

    checkAbort(signal);
    if (encError) throw encError;
    onProgress({ stage: 'finalize', pct: 0.97, frame: totalFrames, totalFrames });
    if (mp4) mp4.finalize();
    if (webm) webm.finalize();
    const buffer = mp4 ? mp4Target!.buffer : webmTarget!.buffer;
    const mime = plan.container === 'mp4' ? 'video/mp4' : 'video/webm';
    onProgress({ stage: 'finalize', pct: 1, frame: totalFrames, totalFrames });
    return {
      blob: new Blob([buffer], { type: mime }),
      container: plan.container, videoCodec: plan.videoCodec,
      hasAudio, frames: totalFrames, width, height,
    };
  } catch (error) {
    throw error;
  } finally {
    cleanup();
  }
}

/** Cheap capability probe for the Export UI (does not encode). */
export async function videoExportSupport(): Promise<{ supported: boolean; label: string }> {
  if (typeof VideoEncoder === 'undefined') return { supported: false, label: 'WebCodecs unavailable in this browser' };
  const plan = await pickCodecPlan(1280, 720, 30, 2_500_000, true).catch(() => null);
  if (!plan) return { supported: false, label: 'No usable hardware/software encoder' };
  return {
    supported: true,
    label: plan.container === 'mp4' ? `MP4 · H.264${plan.audioCodec ? ' + AAC' : ''}` : `WebM · ${plan.videoCodec.startsWith('vp09') ? 'VP9' : 'VP8'}${plan.audioCodec ? ' + Opus' : ''}`,
  };
}