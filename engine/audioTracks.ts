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
import type { MP4File, MP4Info, MP4Module, MP4Sample, MP4SampleEntry, MP4TrackInfo } from 'mp4box';

const ISO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'm4a', 'm4b', 'm4p', 'm4r', '3gp', '3g2']);
const PROBE_TIMEOUT_MS = 5000;

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
export async function probeAudioTracks(blob: Blob, fileName = ''): Promise<AudioTrackInfo[] | null> {
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
    return audio.map((t, i) => trackInfo(t, i + 1));
  } catch {
    return null;
  } finally {
    try { file?.stop(); } catch { /* already stopped */ }
  }
}

/** AudioSpecificConfig from an esds box (the AAC decoder description). */
function audioSpecificConfig(entry: MP4SampleEntry | undefined): Uint8Array | undefined {
  const dec = entry?.esds?.esd?.descs?.find((d) => d.tag === 4);
  const specific = dec?.descs?.find((d) => d.tag === 5);
  return specific?.data ? new Uint8Array(specific.data) : undefined;
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

/**
 * Decode one audio track from an ISO-BMFF blob into an AudioBuffer.
 *
 * The returned buffer starts at the track's first presented sample (the MP4
 * edit list's `media_time` is trimmed), so source time 0 lines up with the
 * picture exactly like the browser's own `decodeAudioData` path.
 */
export async function decodeMp4AudioTrack(blob: Blob, trackId: number): Promise<AudioBuffer> {
  const wc = globalThis as unknown as WebCodecsAudio;
  if (!wc.AudioDecoder || !wc.EncodedAudioChunk) {
    throw new AudioTrackDecodeError('This browser has no WebCodecs AudioDecoder, so alternate audio tracks cannot be decoded.');
  }
  const AudioDecoderClass = wc.AudioDecoder;
  const EncodedChunkClass = wc.EncodedAudioChunk;
  const { createFile } = await mp4box();
  const file = createFile();
  try {
    const data = await blob.arrayBuffer();
    const ready = new Promise<MP4Info>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AudioTrackDecodeError('Timed out reading the audio track.')), PROBE_TIMEOUT_MS * 2);
      file.onReady = (i) => { clearTimeout(timer); resolve(i); };
      file.onError = (e) => { clearTimeout(timer); reject(new AudioTrackDecodeError(`MP4 parse failed: ${e}`)); };
    });
    feed(file, data, 0, true);
    const meta = await ready;
    const track = meta.audioTracks?.find((t) => t.id === trackId)
      ?? meta.tracks.find((t) => t.id === trackId && !!t.audio);
    if (!track) throw new AudioTrackDecodeError(`Audio track ${trackId} is not present in this file.`);

    const trak = file.getTrackById(trackId);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const description = audioSpecificConfig(entry);
    const sampleRate = Math.max(8000, track.audio?.sample_rate || 48000);
    const declaredChannels = Math.max(1, track.audio?.channel_count || 2);
    const config: AudioDecoderConfigLike = {
      codec: track.codec,
      sampleRate,
      numberOfChannels: declaredChannels,
      ...(description ? { description } : {}),
    };
    let supported = false;
    try {
      supported = (await AudioDecoderClass.isConfigSupported(config)).supported === true;
    } catch {
      supported = false;
    }
    if (!supported) {
      throw new AudioTrackDecodeError(`This browser cannot decode ${audioCodecName(track.codec)} (${track.codec}) audio.`);
    }

    const samples: MP4Sample[] = [];
    file.onSamples = (_id, _user, batch) => { for (const s of batch) samples.push(s); };
    file.setExtractionOptions(trackId, null, { nbSamples: 500 });
    file.start();
    file.flush();
    // mp4box delivers samples synchronously for a fully provided file, but a
    // microtask keeps this correct if a future version batches asynchronously.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!samples.length) throw new AudioTrackDecodeError('The selected audio track has no samples.');

    const timescale = track.timescale || samples[0].timescale || sampleRate;
    const firstCts = samples[0].cts;
    const last = samples[samples.length - 1];
    const lastEnd = last.cts + last.duration;
    const mediaTime = Math.max(0, track.edits?.[0]?.media_time ?? 0);
    const trim = Math.max(0, mediaTime - firstCts);
    const expected = Math.max(
      1,
      Math.ceil(((lastEnd - firstCts) / timescale) * sampleRate) - Math.round((trim / timescale) * sampleRate),
    );
    // A little slack absorbs decoder rounding / priming differences; the final
    // buffer is trimmed to the presentation length.
    const capacity = expected + 4096;
    let channels = declaredChannels;
    let pcm = Array.from({ length: channels }, () => new Float32Array(capacity));
    let write = -Math.round((trim / timescale) * sampleRate);
    let planeScratch = new Float32Array(4096);
    let interleavedScratch = new Float32Array(4096);

    const decoder = new AudioDecoderClass({
      output: (data: DecodedAudioData) => {
        try {
          const n = data.numberOfFrames;
          if (n <= 0) return;
          if (data.numberOfChannels > channels) {
            channels = data.numberOfChannels;
            pcm = Array.from({ length: channels }, (_, ch) => {
              const next = new Float32Array(capacity);
              next.set(pcm[ch] ?? []);
              return next;
            });
          }
          const start = write;
          write += n;
          const copyFrom = Math.max(0, -start);
          const copyTo = Math.min(n, capacity - start);
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
                  // Channel layout mismatch — duplicate the first plane rather
                  // than dropping the sample.
                  plane.set(planeScratch.subarray(0, n));
                }
              }
              pcm[ch].set(plane.subarray(copyFrom, copyTo), dest);
            }
          } else {
            const need = n * data.numberOfChannels;
            if (interleavedScratch.length < need) interleavedScratch = new Float32Array(need);
            data.copyTo(interleavedScratch, { planeIndex: 0, format: 'f32' });
            for (let ch = 0; ch < channels; ch++) {
              const srcCh = Math.min(ch, data.numberOfChannels - 1);
              for (let i = copyFrom; i < copyTo; i++) {
                pcm[ch][dest + i - copyFrom] = interleavedScratch[i * data.numberOfChannels + srcCh];
              }
            }
          }
        } finally {
          data.close();
        }
      },
      error: () => { /* flush() rejects with the useful error */ },
    });

    try {
      decoder.configure(config);
      for (const s of samples) {
        if (!s.data?.byteLength) continue;
        decoder.decode(new EncodedChunkClass({
          type: 'key',
          timestamp: Math.round((s.cts / (s.timescale || timescale)) * 1e6),
          duration: Math.round((s.duration / (s.timescale || timescale)) * 1e6),
          data: s.data,
        }));
        if (decoder.decodeQueueSize > 128) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      await decoder.flush();
    } finally {
      try { decoder.close(); } catch { /* already closed */ }
    }

    const length = Math.max(1, Math.min(capacity, write));
    const buffer = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
    for (let ch = 0; ch < channels; ch++) buffer.copyToChannel(pcm[ch].subarray(0, length), ch);
    return buffer;
  } finally {
    try { file.stop(); } catch { /* already stopped */ }
  }
}

/** Key used by both preview and export buffer maps. A plain media id is the
 * file's default mix; `mediaId#trackId` is one explicitly selected track. */
export function audioBufferKey(mediaId: string, trackId?: number): string {
  return trackId == null ? mediaId : `${mediaId}#${trackId}`;
}

/** Human label for a track selector: "2. Hindi · AAC mono". */
export function audioTrackLabel(track: AudioTrackInfo): string {
  const language = languageName(track.language);
  const layout = track.channels === 1 ? 'mono' : track.channels === 2 ? 'stereo' : `${track.channels}ch`;
  return `${track.index}. ${language} · ${audioCodecName(track.codec)} ${layout}`;
}

export function audioCodecName(codec: string): string {
  const c = codec.toLowerCase();
  if (c.startsWith('mp4a')) return 'AAC';
  if (c === 'ac-3' || c === 'ac3') return 'AC-3';
  if (c === 'ec-3' || c === 'eac3') return 'E-AC-3';
  if (c.startsWith('opus')) return 'Opus';
  if (c.startsWith('alac')) return 'ALAC';
  if (c.startsWith('flac')) return 'FLAC';
  if (c.startsWith('mp3') || c === 'mp4a.69' || c === 'mp4a.6b') return 'MP3';
  return codec || 'audio';
}

let displayNames: Intl.DisplayNames | null | undefined;
function languageName(code: string | undefined): string {
  const c = (code || 'und').toLowerCase();
  if (!c || c === 'und' || c === 'und') return 'Unlabelled';
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
