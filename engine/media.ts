/**
 * Media resolution for preview. The renderer itself is pure: it asks a
 * MediaResolver for the frame of a media asset at a source time.
 * Preview uses this pool (HTMLVideoElement seek/play sync).
 * Export uses an exact-frame resolver (WebCodecs) with the same interface.
 */
import type { Clip, MediaAsset } from './types';
import { sourceTimeOf, speedAtLocal, LARGE_MEDIA_BYTES, LONG_MEDIA_SECONDS } from './types';
import { audioBufferKey, decodeMp4AudioTrack } from './audioTracks';

export interface MediaResolver {
  /** Synchronous: returns the best currently-available frame source, or null.
   * `useKey` (optional) identifies WHICH use of the asset is drawing — two
   * clips sharing one asset (e.g. the same video on two tracks) each get
   * their own element instead of fighting over one <video>'s currentTime. */
  frame(mediaId: string, sourceTime: number, useKey?: string): CanvasImageSource | null;
  size(mediaId: string): { width: number; height: number } | null;
  /** Hint that a precise frame will be needed soon (preview prefetch). */
  hint?(mediaId: string, sourceTime: number, useKey?: string): void;
}

interface VideoEntry {
  el: HTMLVideoElement;
  url: string;
  seekingTo: number | null;
  lastDrawn: number;
}

/** Cheap peak scan: a whole-file buffer that is completely silent means the
 * browser picked a disabled/empty track, not that the movie has no sound. */
function isSilent(buffer: AudioBuffer): boolean {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    const step = Math.max(1, Math.floor(data.length / 20000));
    for (let i = 0; i < data.length; i += step) if (Math.abs(data[i]) > 1e-4) return false;
  }
  return true;
}

export class MediaPool implements MediaResolver {
  private videos = new Map<string, VideoEntry>();
  /** Per-use clones: key `${mediaId}|${useKey}` — additional <video> elements
   * for the same asset so two clips can show different times of one source
   * simultaneously (a transition between two cuts of the same clip, a
   * picture-in-picture of itself, etc.). */
  private useVideos = new Map<string, VideoEntry>();
  private images = new Map<string, ImageBitmap>();
  private buffers = new Map<string, AudioBuffer>();
  private assets = new Map<string, MediaAsset>();
  /** Source blobs kept so an alternate track can be decoded on first use. */
  private blobs = new Map<string, Blob>();
  private trackPromises = new Map<string, Promise<AudioBuffer | undefined>>();
  private audioCtx: AudioContext | null = null;
  /** Buffer keys whose audio the browser could not decode (e.g. AC3 in MP4,
   * or an alternate WebCodecs track this browser cannot handle). */
  private decodeFailed = new Set<string>();
  /** Large files intentionally use the video element's own audio instead of
   * an in-memory AudioBuffer, so preview still has sound. */
  private elementAudio = new Set<string>();
  onFrameReady: (() => void) | null = null;
  /** Fires when a (possibly late) buffer is ready, or with a reason when a
   * selected track failed — the consumer decides how to surface it. */
  onBufferReady: ((key: string, error?: string) => void) | null = null;

  private ctx(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }

  async register(asset: MediaAsset, blob?: Blob): Promise<void> {
    this.assets.set(asset.id, asset);
    if (blob) this.blobs.set(asset.id, blob);
    if (asset.type === 'video' && blob) {
      const url = URL.createObjectURL(blob);
      const el = document.createElement('video');
      el.muted = true;
      el.playsInline = true;
      // 'auto' on a 2-hour movie makes the browser buffer/parse the whole file
      // during import. Metadata is enough; frames load on demand when scrubbed.
      el.preload = asset.duration > 600 || (blob?.size ?? 0) > 200 * 1024 * 1024 ? 'metadata' : 'auto';
      el.src = url;
      const entry: VideoEntry = { el, url, seekingTo: null, lastDrawn: -1 };
      el.addEventListener('seeked', () => {
        entry.seekingTo = null;
        entry.lastDrawn = el.currentTime;
        this.onFrameReady?.();
      });
      this.videos.set(asset.id, entry);
      el.addEventListener('loadeddata', () => this.onFrameReady?.());
      await new Promise<void>((res) => {
        if (el.readyState >= 2) return res();
        let done = false;
        const finish = () => { if (!done) { done = true; clearTimeout(timer); res(); } };
        const timer = setTimeout(finish, 5000);
        el.addEventListener('loadeddata', finish, { once: true });
        el.addEventListener('error', finish, { once: true });
      });
      this.onFrameReady?.();
    } else if (asset.type === 'image' && blob) {
      this.images.set(asset.id, await createImageBitmap(blob));
    }
    // A 2-hour movie would need gigabytes of PCM if decoded whole. Use the
    // video element's own audio for those files instead of stalling or
    // crashing the tab during import.
    if (blob && (blob.size > LARGE_MEDIA_BYTES || asset.duration > LONG_MEDIA_SECONDS)) {
      if (asset.type !== 'image') {
        this.elementAudio.add(asset.id);
        this.onBufferReady?.(asset.id);
      }
    } else if ((asset.type === 'audio' || asset.hasAudio) && blob) {
      this.decodeAudio(asset, blob);
    } else if (asset.type === 'video' && blob) {
      // Best-effort: probe's hasAudio detection is unreliable in Chromium
      // (webkitAudioDecodedByteCount is 0 until the element plays), which left
      // many video files with real audio tracks permanently silent. Decode
      // unconditionally — a video without audio decodes to silence, harmless.
      this.decodeAudio(asset, blob);
    }
  }

  private async decodeAudio(asset: MediaAsset, blob: Blob) {
    const mediaId = asset.id;
    if (this.buffers.has(mediaId)) return;
    try {
      const arr = await blob.arrayBuffer();
      let buf = await this.ctx().decodeAudioData(arr);
      // Some containers expose a disabled/silent "default" track to
      // decodeAudioData. When the file declares real audio tracks, use the
      // first decoded track instead of playing silence.
      if (asset.audioTracks?.length && isSilent(buf)) {
        buf = await decodeMp4AudioTrack(blob, asset.audioTracks[0].id);
      }
      this.buffers.set(mediaId, buf);
      this.onBufferReady?.(mediaId);
    } catch {
      // Browser cannot decode this audio (e.g. AC3/E-AC3 in MP4). Remember it
      // so preview can fall back to the video element's own audio.
      this.decodeFailed.add(mediaId);
      this.onBufferReady?.(mediaId);
    }
  }

  /** `trackId` omitted = the file's default mix; given = one decoded track. */
  getBuffer(mediaId: string, trackId?: number): AudioBuffer | undefined {
    return this.buffers.get(audioBufferKey(mediaId, trackId));
  }

  /** True when this media's audio exists but the browser cannot decode it. */
  decodeFailedFor(mediaId: string, trackId?: number): boolean {
    return this.decodeFailed.has(audioBufferKey(mediaId, trackId))
      || (trackId == null && this.elementAudio.has(mediaId));
  }

  /** Decode an explicitly selected MP4 audio track on first use. The in-flight
   * promise is shared so a selection and an immediate export never decode the
   * same track twice. Failures are recorded instead of falling back to a
   * different language. */
  getOrDecodeTrackBuffer(mediaId: string, trackId: number): Promise<AudioBuffer | undefined> {
    const key = audioBufferKey(mediaId, trackId);
    const existing = this.buffers.get(key);
    if (existing) return Promise.resolve(existing);
    if (this.decodeFailed.has(key)) return Promise.resolve(undefined);
    const blob = this.blobs.get(mediaId);
    if (!blob) return Promise.resolve(undefined);
    let pending = this.trackPromises.get(key);
    if (!pending) {
      pending = decodeMp4AudioTrack(blob, trackId)
        .then((buf) => { this.buffers.set(key, buf); this.onBufferReady?.(key); return buf; })
        .catch((e: unknown) => {
          const reason = e instanceof Error ? e.message : String(e);
          this.decodeFailed.add(key);
          this.onBufferReady?.(key, reason);
          return undefined;
        })
        .finally(() => { this.trackPromises.delete(key); });
      this.trackPromises.set(key, pending);
    }
    return pending;
  }

  ensureTrackBuffer(mediaId: string, trackId: number): void {
    void this.getOrDecodeTrackBuffer(mediaId, trackId);
  }

  /** The live preview <video> element for a media asset, if any. When `useKey`
   * is given, return the per-clip clone that actually plays during preview —
   * the primary element is only a frame source. */
  elementFor(mediaId: string, useKey?: string): HTMLVideoElement | null {
    if (useKey) return this.useVideos.get(`${mediaId}|${useKey}`)?.el ?? this.videos.get(mediaId)?.el ?? null;
    return this.videos.get(mediaId)?.el ?? null;
  }

  /** Element for one use of an asset: the primary element when unkeyed, else
   * a lazily-created clone sharing the same object URL. */
  private entryFor(mediaId: string, useKey?: string): VideoEntry | null {
    if (!useKey) return this.videos.get(mediaId) ?? null;
    const key = `${mediaId}|${useKey}`;
    let v = this.useVideos.get(key);
    if (!v) {
      const base = this.videos.get(mediaId);
      if (!base) return null;
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = base.url;
      v = { el, url: base.url, seekingTo: null, lastDrawn: -1 };
      el.addEventListener('seeked', () => {
        v!.seekingTo = null;
        v!.lastDrawn = el.currentTime;
        this.onFrameReady?.();
      });
      this.useVideos.set(key, v);
    }
    return v;
  }

  /** Create/fetch the per-clip element ahead of playback so the element-audio
   * fallback can unmute the element that will actually be played. */
  ensureElement(mediaId: string, useKey: string): HTMLVideoElement | null {
    return this.entryFor(mediaId, useKey)?.el ?? null;
  }

  /** Re-mute every preview video element (used when playback stops). */
  muteAllElements() {
    for (const v of this.videos.values()) v.el.muted = true;
    for (const v of this.useVideos.values()) v.el.muted = true;
  }

  ensureAudio(asset: MediaAsset, blob: Blob) {
    if (blob.size > LARGE_MEDIA_BYTES || asset.duration > LONG_MEDIA_SECONDS) return;
    if (!this.buffers.has(asset.id) && !this.decodeFailed.has(asset.id)) this.decodeAudio(asset, blob);
  }

  /** True when preview deliberately uses the video element's own audio. */
  usesElementAudio(mediaId: string): boolean {
    return this.elementAudio.has(mediaId);
  }

  frame(mediaId: string, sourceTime: number, useKey?: string): CanvasImageSource | null {
    const img = this.images.get(mediaId);
    if (img) return img;
    const v = this.entryFor(mediaId, useKey);
    if (!v) return null;
    if (v.el.readyState < 2) return null;
    if (Math.abs(v.el.currentTime - sourceTime) > 0.06 && v.seekingTo === null && v.el.paused) {
      this.seekEntry(v, sourceTime);
    }
    return v.el;
  }

  hint(mediaId: string, sourceTime: number, useKey?: string) {
    const v = this.entryFor(mediaId, useKey);
    if (v && v.el.paused && Math.abs(v.el.currentTime - sourceTime) > 0.06) this.seekEntry(v, sourceTime);
  }

  seek(mediaId: string, t: number) {
    const v = this.videos.get(mediaId);
    if (v) this.seekEntry(v, t);
  }

  private seekEntry(v: VideoEntry, t: number) {
    if (v.el.readyState < 1) return;
    if (v.seekingTo !== null && Math.abs(v.seekingTo - t) < 0.001) return;
    v.seekingTo = t;
    try { v.el.currentTime = Math.max(0, Math.min(t, (v.el.duration || t) - 0.001)); } catch { v.seekingTo = null; }
  }

  /** Keep playing elements in sync with the timeline during playback. Each
   * active clip drives its OWN element (keyed by asset+clip), so two clips
   * sharing one asset stay independently positioned instead of fighting. */
  syncPlayback(active: { clip: Clip; asset: MediaAsset }[], timelineT: number, playing: boolean, previewRate = 1) {
    const wanted = new Map<string, { mediaId: string; expected: number; speed: number; reversed: boolean }>();
    for (const { clip, asset } of active) {
      if (asset.type !== 'video') continue;
      wanted.set(asset.id + '|' + clip.id, { mediaId: asset.id, expected: sourceTimeOf(clip, timelineT), speed: speedAtLocal(clip, timelineT - clip.start), reversed: !!clip.reversed });
    }
    const usedMedia = new Set([...wanted.values()].map((w) => w.mediaId));
    for (const [id, v] of this.videos) {
      if (!usedMedia.has(id) && !v.el.paused) v.el.pause();
    }
    for (const [key, w] of wanted) {
      const sep = key.indexOf('|');
      const v = this.entryFor(key.slice(0, sep), key.slice(sep + 1));
      if (!v || v.el.readyState < 2) continue;
      if (w.reversed) {
        // Browsers cannot play a video element backward — scrub instead
        // (seek per frame, same path as paused scrubbing). Honest, stable.
        if (!v.el.paused) v.el.pause();
        if (Math.abs(v.el.currentTime - w.expected) > 0.04) this.seekEntry(v, w.expected);
        continue;
      }
      // previewRate is a preview-only multiplier; the export engine never sees it.
      v.el.playbackRate = Math.max(0.1, Math.min(4, w.speed * previewRate));
      if (playing) {
        const drift = Math.abs(v.el.currentTime - w.expected);
        if (drift > 0.15) {
          v.el.currentTime = w.expected;
        }
        if (v.el.paused) v.el.play().catch(() => {});
      } else {
        if (!v.el.paused) v.el.pause();
        if (Math.abs(v.el.currentTime - w.expected) > 0.04) this.seekEntry(v, w.expected);
      }
    }
    for (const [key, v] of this.useVideos) {
      if (!wanted.has(key) && !v.el.paused) v.el.pause();
    }
  }

  pauseAll() {
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    for (const v of this.useVideos.values()) if (!v.el.paused) v.el.pause();
  }

  size(mediaId: string): { width: number; height: number } | null {
    const a = this.assets.get(mediaId);
    if (a) return { width: a.width, height: a.height };
    const v = this.videos.get(mediaId);
    if (v && v.el.videoWidth) return { width: v.el.videoWidth, height: v.el.videoHeight };
    const i = this.images.get(mediaId);
    if (i) return { width: i.width, height: i.height };
    return null;
  }

  async thumbnail(mediaId: string, t: number, w = 160): Promise<string | null> {
    const img = this.images.get(mediaId);
    const size = this.size(mediaId);
    if (!size) return null;
    const h = Math.max(2, Math.round((w * size.height) / size.width));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    if (img) { ctx.drawImage(img, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.6); }
    const v = this.videos.get(mediaId);
    if (!v) return null;
    // Dedicated element: never seek the preview video, which would race the playhead.
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = v.url;
    try {
      await new Promise<void>((res, rej) => {
        const timer = setTimeout(() => rej(new Error('thumbnail timeout')), 4000);
        el.addEventListener('loadeddata', () => { clearTimeout(timer); res(); }, { once: true });
        el.addEventListener('error', () => { clearTimeout(timer); rej(new Error('thumbnail decode')); }, { once: true });
      });
      await new Promise<void>((res) => {
        const done = () => { el.removeEventListener('seeked', done); res(); };
        el.addEventListener('seeked', done, { once: true });
        try { el.currentTime = Math.max(0, Math.min(t, (el.duration || t) - 0.001)); } catch { done(); }
        setTimeout(done, 1500);
      });
      ctx.drawImage(el, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.6);
    } catch { return null; }
    finally { el.pause(); el.removeAttribute('src'); el.load(); }
  }

  unregister(mediaId: string) {
    const v = this.videos.get(mediaId);
    if (v) { v.el.pause(); URL.revokeObjectURL(v.url); v.el.src = ''; this.videos.delete(mediaId); }
    for (const [key, uv] of this.useVideos) {
      if (key.startsWith(mediaId + '|')) { uv.el.pause(); uv.el.removeAttribute('src'); uv.el.load(); this.useVideos.delete(key); }
    }
    this.images.get(mediaId)?.close();
    this.images.delete(mediaId);
    this.buffers.delete(mediaId);
    for (const key of [...this.buffers.keys(), ...this.decodeFailed, ...this.trackPromises.keys()]) {
      if (key === mediaId || key.startsWith(mediaId + '#')) {
        this.buffers.delete(key);
        this.decodeFailed.delete(key);
        this.trackPromises.delete(key);
      }
    }
    this.blobs.delete(mediaId);
    this.assets.delete(mediaId);
  }

  dispose() {
    for (const id of [...this.assets.keys()]) this.unregister(id);
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}