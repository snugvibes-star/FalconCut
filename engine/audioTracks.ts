/**
 * Multi-audio-track support for ISO-BMFF files (MP4/MOV/M4A).
 *
 * `probeAudioTracks` reads only the file header + `moov` box with mp4box, so a
 * 2 GB movie does not have to be loaded just to list its languages. The
 * selected track is decoded with WebCodecs (`AudioDecoder`) from mp4box-
 * extracted AAC samples into a normal AudioBuffer, which then flows through
 * the SAME preview and export audio graph as every other clip.
 *
 * Honest limits:
 * - Only ISO-BMFF containers are probed; MKV/AVI/WebM keep the browser's
 *   default decoding.
 * - Alternate tracks need WebCodecs AudioDecoder plus a codec the browser can
 *   decode. When that is unavailable the track is reported as undecodable
 *   instead of silently playing a different language.
 * - Waveform/transcript analysis is still per media file (default track).
 */
import type { AudioTrackInfo } from './types';
import type { MP4File, MP4Info, MP4Module, MP4SampleEntry, MP4TrackInfo } from 'mp4box';

const ISO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'm4a', 'm4b', 'm4p', 'm4r', '3gp', '3g2']);
const PROBE_TIMEOUT_MS = 5000;
const DECODE_TIMEOUT_MS = 20000;
/** 30 minutes of 48 kHz audio — a hard memory ceiling for one decoded track. */
const MAX_AUDIO_FRAMES = 30 * 60 * 48000;

export class AudioTrackDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioTrackDecodeError';
  }
}

let modulePromise: Promise<MP4Module> | null = null;

/** mp4box is a ~300 KB CommonJS bundle; load it only when a file needs it. */
async function mp4box(): Promise<MP4Module> {
  if (!modulePromise) {
    modulePromise = import('mp4box').then((mod) => {
      const m = mod as unknown as { default?: MP4Module; createFile?: MP4Module['createFile'] };
      if (m.default?.createFile) return m.default;
      if (m.createFile) return m as unknown as MP4Module;
      throw new Error('mp4box module has no createFile export');
    });
  }
  return modulePromise;
}

function extensionOf(name: string): string {
  const clean = name.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

/** Quick gate: only ISO-BMFF files are worth handing to mp4box. */
export function isIsoBmffCandidate(blob: Blob, fileName = ''): boolean {
  const mime = (blob.type || '').toLowerCase();
  if (mime.includes('mp4') || mime.includes('quicktime') || mime.includes('3gpp')) return true;
  return ISO_EXTENSIONS.has(extensionOf(fileName));
}

interface BoxHeader { type: string; start: number; size: number }

/** Read top-level box headers from a Blob without loading media data. */
async function topLevelBoxes(blob: Blob): Promise<BoxHeader[]> {
  const boxes: BoxHeader[] = [];
  let offset = 0;
  for (let i = 0; i < 64 && offset + 8 <= blob.size; i++) {
    const head = await blob.slice(offset, Math.min(offset + 16, blob.size)).arrayBuffer();
    if (head.byteLength < 8) break;
    const view = new DataView(head);
    let size = view.getUint32(0);
    const type = String.fromCharCode(
      view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7),
    );
    let header = 8;
    if (size === 1) {
      if (head.byteLength < 16) break;
      const hi = view.getUint32(8);
      const lo = view.getUint32(12);
      size = hi * 2 ** 32 + lo;
      header = 16;
    } else if (size === 0) {
      size = blob.size - offset;
    }
    if (!Number.isFinite(size) || size < header || offset + size > blob.size + 1) break;
    boxes.push({ type, start: offset, size });
    if (type === 'moov') break;
    offset += size;
  }
  return boxes;
}

function feed(file: MP4File, buffer: ArrayBuffer, start: number, last: boolean): void {
  const slot = buffer as ArrayBuffer & { fileStart?: number };
  slot.fileStart = start;
  file.appendBuffer(slot, last);
}

function trackInfo(track: MP4TrackInfo, index: number): AudioTrackInfo {
  return {
    id: track.id,
    index,
    codec: track.codec || 'unknown',
    language: track.language || 'und',
    channels: Math.max(1, track.audio?.channel_count || 2),
    sampleRate: Math.max(0, track.audio?.sample_rate || 0),
    // mp4box reports bits/second; keep the human-facing unit in kbps.
    bitrate: track.bitrate ? Math.round(track.bitrate / 1000) : undefined,
  };
}

/**
 * List the audio tracks in an MP4/MOV/M4A file. Returns an empty array for a
 * valid file with no audio and `null` when the container cannot be inspected.
 */
export interface IsoBmffProbe {
  tracks: AudioTrackInfo[];
  duration: number;
  timescale: number;
}

export async function probeIsoBmff(blob: Blob, fileName = ''): Promise<IsoBmffProbe | null> {
  if (!isIsoBmffCandidate(blob, fileName)) return null;
  const boxes = await topLevelBoxes(blob);
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) return null;

  let file: MP4File | null = null;
  try {
    const { createFile } = await mp4box();
    file = createFile();
    const ready = new Promise<MP4Info | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      file!.onReady = (info) => { clearTimeout(timer); resolve(info); };
      file!.onError = () => { clearTimeout(timer); resolve(null); };
    });

    // The parser needs fileStart 0 to initialise, then the moov box wherever
    // it lives (front, middle or end). Media payload is never loaded.
    const headLen = Math.min(4096, blob.size);
    if (moov.start < headLen) {
      const end = Math.max(headLen, Math.min(blob.size, moov.start + moov.size));
      feed(file, await blob.slice(0, end).arrayBuffer(), 0, true);
    } else {
      feed(file, await blob.slice(0, headLen).arrayBuffer(), 0, false);
      feed(file, await blob.slice(moov.start, moov.start + moov.size).arrayBuffer(), moov.start, true);
    }

    const info = await ready;
    if (!info) return null;
    const audio = info.audioTracks?.length
      ? info.audioTracks
      : info.tracks.filter((t) => !!t.audio);
    const tracks = audio.map((t, i) => trackInfo(t, i + 1));
    // Ask the browser once at import time which of these codecs it can really
    // decode, so disabled options show an honest reason instead of failing
    // silently when the user selects them.
    for (const t of tracks) {
      try {
        const trak = file.getTrackById(t.id);
        const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
        tracks[tracks.indexOf(t)].decodable = await isTrackSupported(t, entry);
      } catch {
        tracks[tracks.indexOf(t)].decodable = false;
      }
    }
    const timescale = info.timescale || 1000;
    return {
      tracks,
      duration: info.duration / timescale,
      timescale,
    };
  } catch {
    return null;
  } finally {
    try { file?.stop(); } catch { /* already stopped */ }
  }
}

/** Tracks-only convenience wrapper used by the UI and tests. */
export async function probeAudioTracks(blob: Blob, fileName = ''): Promise<AudioTrackInfo[] | null> {
  return (await probeIsoBmff(blob, fileName))?.tracks ?? null;
}

/** AudioSpecificConfig from an esds box (the AAC decoder description). */
function audioSpecificConfig(entry: MP4SampleEntry | undefined): Uint8Array | undefined {
  const dec = entry?.esds?.esd?.descs?.find((d) => d.tag === 4);
  const specific = dec?.descs?.find((d) => d.tag === 5);
  return specific?.data ? new Uint8Array(specific.data) : undefined;
}

/** Per-track support probe. No description is required for most codecs but
 * AAC-in-MP4 needs its AudioSpecificConfig, which lives in the moov box we
 * already read during the header probe. */
async function isTrackSupported(track: AudioTrackInfo, entry: MP4SampleEntry | undefined): Promise<boolean> {
  const wc = globalThis as unknown as WebCodecsAudio;
  if (!wc.AudioDecoder) return false;
  try {
    const result = await wc.AudioDecoder.isConfigSupported({
      codec: track.codec,
      sampleRate: Math.max(8000, track.sampleRate || 48000),
      numberOfChannels: Math.max(1, track.channels),
      ...(audioSpecificConfig(entry) ? { description: audioSpecificConfig(entry)! } : {}),
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

function isWebCodecsAudioAvailable(): boolean {
  const wc = globalThis as unknown as WebCodecsAudio;
  return typeof wc.AudioDecoder !== 'undefined' && typeof wc.EncodedAudioChunk !== 'undefined';
}

/* Minimal WebCodecs audio typings — TS 5.6's DOM lib predates them, and global
 * ambient declarations would collide once the compiler ships its own. */
interface DecodedAudioData {
  numberOfFrames: number;
  numberOfChannels: number;
  copyTo(destination: Float32Array, options: { planeIndex: number; format?: 'f32' | 'f32-planar' }): void;
  close(): void;
}
interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: Uint8Array;
}
interface WebAudioDecoder {
  configure(config: AudioDecoderConfigLike): void;
  decode(chunk: object): void;
  flush(): Promise<void>;
  close(): void;
  readonly decodeQueueSize: number;
}
interface WebCodecsAudio {
  AudioDecoder?: {
    new (init: { output: (data: DecodedAudioData) => void; error: (error: Error) => void }): WebAudioDecoder;
    isConfigSupported(config: AudioDecoderConfigLike): Promise<{ supported?: boolean }>;
  };
  EncodedAudioChunk?: new (init: { type: 'key'; timestamp: number; duration: number; data: Uint8Array }) => object;
}

/** Reject a hung WebCodecs flush instead of leaving the track pending forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AudioTrackDecodeError(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Decode one audio track from an ISO-BMFF blob into an AudioBuffer.
 *
 * Samples are decoded straight into the final AudioBuffer as mp4box emits
 * them: no full-length Float32Array staging copy and no sample array. The MP4
 * edit list (`media_time`) is trimmed so source time 0 lines up with the
 * picture exactly like the browser's own `decodeAudioData` path.
 */
export async function decodeMp4AudioTrack(blob: Blob, trackId: number, expectedDuration?: number): Promise<AudioBuffer> {
  // Reject before touching the blob: a 2-hour soundtrack cannot fit in an
  // AudioBuffer, and reading gigabytes just to fail is the import-hang bug.
  if (expectedDuration && expectedDuration > MAX_AUDIO_FRAMES / 48000) {
    throw new AudioTrackDecodeError('Selected audio track exceeds the 30-minute decode limit. Split the source file first.');
  }
  const wc = globalThis as unknown as WebCodecsAudio;
  if (!wc.AudioDecoder || !wc.EncodedAudioChunk) {
    throw new AudioTrackDecodeError('This browser has no WebCodecs AudioDecoder, so alternate audio tracks cannot be decoded.');
  }
  const AudioDecoderClass = wc.AudioDecoder;
  const EncodedChunkClass = wc.EncodedAudioChunk;
  const { createFile } = await mp4box();
  const file = createFile();
  try {
    const ready = new Promise<MP4Info>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AudioTrackDecodeError('Timed out reading the audio track.')), DECODE_TIMEOUT_MS);
      file.onReady = (i) => { clearTimeout(timer); resolve(i); };
      file.onError = (e) => { clearTimeout(timer); reject(new AudioTrackDecodeError(`MP4 parse failed: ${e}`)); };
    });
    // Feed the file in bounded slices. A single arrayBuffer() of a multi-GB
    // movie is what made long imports hang or crash the tab.
    const CHUNK = 8 * 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const end = Math.min(blob.size, offset + CHUNK);
      feed(file, await blob.slice(offset, end).arrayBuffer(), offset, end === blob.size);
    }
    const meta = await ready;
    const track = meta.audioTracks?.find((t) => t.id === trackId)
      ?? meta.tracks.find((t) => t.id === trackId && !!t.audio);
    if (!track) throw new AudioTrackDecodeError(`Audio track ${trackId} is not present in this file.`);

    const trak = file.getTrackById(trackId);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const description = audioSpecificConfig(entry);
    const sampleRate = Math.max(8000, track.audio?.sample_rate || 48000);
    const channels = Math.max(1, track.audio?.channel_count || 2);
    const config: AudioDecoderConfigLike = {
      codec: track.codec,
      sampleRate,
      numberOfChannels: channels,
      ...(description ? { description } : {}),
    };
    if (!(await isTrackSupported(trackInfo(track, 1), entry))) {
      throw new AudioTrackDecodeError(`This browser cannot decode ${audioCodecName(track.codec)} (${track.codec}) audio.`);
    }

    const timescale = track.timescale || sampleRate;
    const mediaTime = Math.max(0, track.edits?.[0]?.media_time ?? 0);
    const trimSamples = Math.round((mediaTime / timescale) * sampleRate);
    const declaredFrames = Number.isFinite(track.duration) && track.duration > 0
      ? Math.round((track.duration / timescale) * sampleRate)
      : 0;
    const length = Math.min(MAX_AUDIO_FRAMES, Math.max(1, declaredFrames));
    if (declaredFrames > MAX_AUDIO_FRAMES) {
      throw new AudioTrackDecodeError('Selected audio track exceeds the 30-minute decode limit. Split the source file first.');
    }
    const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
    const planes = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
    let write = -trimSamples;
    let planeScratch = new Float32Array(4096);
    let interleavedScratch = new Float32Array(4096);
    let decodeError: string | null = null;
    let decodedAny = false;

    const decoder = new AudioDecoderClass({
      output: (data: DecodedAudioData) => {
        try {
          const n = data.numberOfFrames;
          if (n <= 0) return;
          decodedAny = true;
          const start = write;
          write += n;
          const copyFrom = Math.max(0, -start);
          const copyTo = Math.min(n, length - start);
          if (copyTo <= copyFrom) return;
          const dest = Math.max(0, start + copyFrom);
          let planar = true;
          if (planeScratch.length < n) planeScratch = new Float32Array(n);
          try {
            data.copyTo(planeScratch, { planeIndex: 0, format: 'f32-planar' });
          } catch {
            planar = false;
          }
          if (planar) {
            for (let ch = 0; ch < channels; ch++) {
              const plane = ch === 0 ? planeScratch : new Float32Array(n);
              if (ch > 0) {
                try {
                  data.copyTo(plane, { planeIndex: Math.min(ch, data.numberOfChannels - 1), format: 'f32-planar' });
                } catch {
                  plane.set(planeScratch.subarray(0, n));
                }
              }
              planes[ch].set(plane.subarray(copyFrom, copyTo), dest);
            }
          } else {
            const need = n * data.numberOfChannels;
            if (interleavedScratch.length < need) interleavedScratch = new Float32Array(need);
            data.copyTo(interleavedScratch, { planeIndex: 0, format: 'f32' });
            for (let ch = 0; ch < channels; ch++) {
              const srcCh = Math.min(ch, data.numberOfChannels - 1);
              for (let i = copyFrom; i < copyTo; i++) {
                planes[ch][dest + i - copyFrom] = interleavedScratch[i * data.numberOfChannels + srcCh];
              }
            }
          }
        } finally {
          data.close();
        }
      },
      error: (e) => { decodeError = e?.message ?? 'decoder error'; },
    });

    try {
      decoder.configure(config);
      // Stream samples into the decoder as mp4box emits them. Holding every
      // sample plus a second PCM copy made long movies exhaust browser memory.
      file.onSamples = (_id, _user, batch) => {
        if (decodeError) return;
        for (const s of batch) {
          if (!s.data?.byteLength) continue;
          decoder.decode(new EncodedChunkClass({
            type: 'key',
            timestamp: Math.round((s.cts / (s.timescale || timescale)) * 1e6),
            duration: Math.round((s.duration / (s.timescale || timescale)) * 1e6),
            data: s.data,
          }));
        }
      };
      file.setExtractionOptions(trackId, null, { nbSamples: 500 });
      file.start();
      file.flush();
      await withTimeout(decoder.flush(), DECODE_TIMEOUT_MS, 'Timed out decoding the selected audio track.');
    } finally {
      try { decoder.close(); } catch { /* already closed */ }
    }
    if (decodeError) throw new AudioTrackDecodeError(`Audio decoder failed: ${decodeError}`);
    if (!decodedAny) throw new AudioTrackDecodeError('The selected audio track has no decodable samples.');
    const actual = Math.max(1, Math.min(length, write));
    if (actual === length) return buffer;
    // The decoder may emit fewer frames than the declared duration (AAC
    // priming). Trim the tail so the buffer length matches the real samples.
    const trimmed = new AudioBuffer({ length: actual, numberOfChannels: channels, sampleRate });
    for (let ch = 0; ch < channels; ch++) trimmed.copyToChannel(planes[ch].subarray(0, actual), ch);
    return trimmed;
  } finally {
    try { file.stop(); } catch { /* already stopped */ }
  }
}

/** Key used by both preview and export buffer maps. A plain media id is the
 * file's default mix; `mediaId#trackId` is one explicitly selected track. */
export function audioBufferKey(mediaId: string, trackId?: number): string {
  return trackId == null ? mediaId : `${mediaId}#${trackId}`;
}

/** Kdenlive-style technical stream label. Language is a detail, not the
 * headline — a single Hindi-tagged stream is still just "Stream 1". */
export function audioStreamLabel(track: AudioTrackInfo): string {
  const layout = track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels}ch`;
  const rate = track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)}kHz` : 'unknown rate';
  const language = track.language && track.language !== 'und' ? ` · ${languageName(track.language)}` : '';
  return `Stream ${track.index} · ${layout} · ${rate} · ${audioCodecName(track.codec)}${language}`;
}

/** Human label for a track selector: "2. Hindi · AAC mono". */
export function audioTrackLabel(track: AudioTrackInfo): string {
  const language = languageName(track.language);
  const layout = track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels}ch`;
  return `${track.index}. ${language} · ${audioCodecName(track.codec)} ${layout}`;
}

export function audioCodecName(codec: string): string {
  const c = codec.toLowerCase();
  // MP3-in-MP4 uses mp4a.69 / mp4a.6b — test it before the generic AAC rule.
  if (c === 'mp4a.69' || c === 'mp4a.6b' || c.startsWith('mp3')) return 'MP3';
  if (c.startsWith('mp4a')) return 'AAC';
  if (c === 'ac-3' || c === 'ac3') return 'AC-3';
  if (c === 'ec-3' || c === 'eac3') return 'E-AC-3';
  if (c.startsWith('opus')) return 'Opus';
  if (c.startsWith('alac')) return 'ALAC';
  if (c.startsWith('flac')) return 'FLAC';
  return codec || 'audio';
}

let displayNames: Intl.DisplayNames | null | undefined;
export function languageName(code: string | undefined): string {
  const c = (code || 'und').toLowerCase();
  if (!c || c === 'und') return 'Unlabelled';
  if (displayNames === undefined) {
    try { displayNames = new Intl.DisplayNames(['en'], { type: 'language' }); }
    catch { displayNames = null; }
  }
  try {
    const name = displayNames?.of(c);
    if (name && name.toLowerCase() !== c) return name;
  } catch { /* unknown subtag */ }
  return c.toUpperCase();
}

/** True when this browser can decode per-track audio with WebCodecs. */
export function canDecodeAlternateAudio(): boolean {
  return isWebCodecsAudioAvailable();
}
