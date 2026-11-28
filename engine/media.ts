/**
 * Media resolution for preview. The renderer itself is pure: it asks a
 * MediaResolver for the frame of a media asset at a source time.
 * Preview uses this pool (HTMLVideoElement seek/play sync).
 * Export uses an exact-frame resolver (WebCodecs) with the same interface.
 */
import type { Clip, MediaAsset } from './types';
import { sourceTimeOf, speedAtLocal, LARGE_MEDIA_BYTES, LONG_MEDIA_SECONDS } from './types';
import { audioBufferKey, decodeMp4AudioTrack } from './audioTracks';
import { rgbaToGrey, type GreyFrame } from './tracking';

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
  seekTimer?: ReturnType<typeof setTimeout>;
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
  /** Long audio assets use a native <audio> element instead of an in-memory
   * AudioBuffer, exactly like long video files use their element's audio. */
  private audios = new Map<string, { el: HTMLAudioElement; url: string }>();
  private useAudios = new Map<string, { el: HTMLAudioElement; url: string }>();
  /** Per-use clones: key `${mediaId}|${useKey}` — additional <video> elements
   * for the same asset so two clips can show different times of one source
   * simultaneously (a transition between two cuts of the same clip, a
   * picture-in-picture of itself, etc.). */
  private useVideos = new Map<string, VideoEntry>();
  /** Hidden elements dedicated to frame sampling (tracking/thumbnails). Never
   * seek the preview element — that would race the playhead. */
  private samplers = new Map<string, HTMLVideoElement>();
  private images = new Map<string, ImageBitmap>();
  /** Last successfully decoded frame per asset. Served while a video element
   * reloads/seeks so a clip never flashes black after a timeline edit. */
  private lastFrames = new Map<string, HTMLCanvasElement>();
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

  /** Cache a small snapshot of a decoded frame. Only used as a fallback while
   * an element is loading, never for final export. */
  private captureFrame(mediaId: string, el: HTMLVideoElement): void {
    if (!el.videoWidth || !el.videoHeight) return;
    const asset = this.assets.get(mediaId);
    if (asset && (!asset.width || !asset.height)) { asset.width = el.videoWidth; asset.height = el.videoHeight; }
    const scale = Math.min(1, 1280 / el.videoWidth);
    const w = Math.max(2, Math.round(el.videoWidth * scale));
    const h = Math.max(2, Math.round(el.videoHeight * scale));
    let c = this.lastFrames.get(mediaId);
    if (!c) { c = document.createElement('canvas'); this.lastFrames.set(mediaId, c); }
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    try { c.getContext('2d')?.drawImage(el, 0, 0, w, h); } catch { /* element not paintable yet */ }
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
        if (entry.seekTimer) { clearTimeout(entry.seekTimer); entry.seekTimer = undefined; }
        entry.lastDrawn = el.currentTime;
        this.captureFrame(asset.id, el);
        this.onFrameReady?.();
      });
      this.videos.set(asset.id, entry);
      el.addEventListener('loadeddata', () => { this.captureFrame(asset.id, el); this.onFrameReady?.(); });
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
        if (asset.type === 'audio') {
          const url = URL.createObjectURL(blob);
          const el = new Audio(url);
          el.preload = 'auto';
          this.audios.set(asset.id, { el, url });
        }
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
        if (v!.seekTimer) { clearTimeout(v!.seekTimer); v!.seekTimer = undefined; }
        v!.lastDrawn = el.currentTime;
        this.captureFrame(mediaId, el);
        this.onFrameReady?.();
      });
      el.addEventListener('loadeddata', () => { this.captureFrame(mediaId, el); this.onFrameReady?.(); });
      this.useVideos.set(key, v);
    }
    return v;
  }

  /** Create/fetch the per-clip element ahead of playback so the element-audio
   * fallback can unmute the element that will actually be played. */
  ensureElement(mediaId: string, useKey: string): HTMLVideoElement | null {
    return this.entryFor(mediaId, useKey)?.el ?? null;
  }

  /** Per-clip <audio> element for a long audio asset. */
  ensureAudioElement(mediaId: string, useKey: string): HTMLAudioElement | null {
    const base = this.audios.get(mediaId);
    if (!base) return null;
    const key = `${mediaId}|${useKey}`;
    let entry = this.useAudios.get(key);
    if (!entry) {
      const el = new Audio(base.url);
      el.preload = 'auto';
      el.muted = true;
      entry = { el, url: base.url };
      this.useAudios.set(key, entry);
    }
    return entry.el;
  }

  private audioEntryFor(mediaId: string, useKey: string) {
    const key = `${mediaId}|${useKey}`;
    return this.useAudios.get(key) ?? this.audios.get(mediaId) ?? null;
  }

  /** Re-mute every preview video element (used when playback stops). */
  muteAllElements() {
    for (const v of this.videos.values()) v.el.muted = true;
    for (const v of this.useVideos.values()) v.el.muted = true;
    for (const a of this.audios.values()) a.el.muted = true;
    for (const a of this.useAudios.values()) a.el.muted = true;
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
    if (v.el.readyState < 2) {
      // Never leave a hole/black frame while a newly created per-clip element
      // loads — show the last decoded frame of that same source instead.
      return this.lastFrames.get(mediaId) ?? null;
    }
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
    // A seek that never fires 'seeked' must not lock the element forever —
    // that was the permanent stale/black frame after a timeline move.
    if (v.seekTimer) clearTimeout(v.seekTimer);
    v.seekTimer = setTimeout(() => {
      if (v.seekingTo !== null) {
        v.seekingTo = null;
        this.onFrameReady?.();
      }
      v.seekTimer = undefined;
    }, 1500);
    try { v.el.currentTime = Math.max(0, Math.min(t, (v.el.duration || t) - 0.001)); }
    catch { v.seekingTo = null; if (v.seekTimer) { clearTimeout(v.seekTimer); v.seekTimer = undefined; } }
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
    // Long audio assets have no AudioBuffer: play their native <audio>
    // element so preview still has sound (clip DSP/fades do not apply).
    for (const { clip, asset } of active) {
      if (asset.type !== 'audio') continue;
      const entry = this.audioEntryFor(asset.id, clip.id);
      if (!entry) continue;
      const expected = sourceTimeOf(clip, timelineT);
      const speed = speedAtLocal(clip, timelineT - clip.start);
      if (clip.reversed) {
        if (!entry.el.paused) entry.el.pause();
        if (Math.abs(entry.el.currentTime - expected) > 0.04) entry.el.currentTime = expected;
        continue;
      }
      entry.el.playbackRate = Math.max(0.1, Math.min(4, speed * previewRate));
      if (playing) {
        if (Math.abs(entry.el.currentTime - expected) > 0.2) entry.el.currentTime = expected;
        if (entry.el.paused) entry.el.play().catch(() => {});
      } else {
        if (!entry.el.paused) entry.el.pause();
        if (Math.abs(entry.el.currentTime - expected) > 0.04) entry.el.currentTime = expected;
      }
    }
    const wantedAudio = new Set(active.filter((x) => x.asset.type === 'audio').map((x) => `${x.asset.id}|${x.clip.id}`));
    for (const [key, a] of this.useAudios) {
      if (!wantedAudio.has(key) && !a.el.paused) a.el.pause();
    }
  }

  pauseAll() {
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    for (const v of this.useVideos.values()) if (!v.el.paused) v.el.pause();
    for (const a of this.audios.values()) if (!a.el.paused) a.el.pause();
    for (const a of this.useAudios.values()) if (!a.el.paused) a.el.pause();
  }

  size(mediaId: string): { width: number; height: number } | null {
    const a = this.assets.get(mediaId);
    // A failed/timeout probe leaves 0×0 metadata. Never return that: the
    // renderer would treat the crop rect as empty and paint a black frame.
    if (a && a.width > 0 && a.height > 0) return { width: a.width, height: a.height };
    const v = this.videos.get(mediaId);
    if (v && v.el.videoWidth > 0 && v.el.videoHeight > 0) return { width: v.el.videoWidth, height: v.el.videoHeight };
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

  /** Grayscale 0..1 pixels from a small canvas (downscaled to `w` columns).
   * Video seeks use a dedicated hidden element with a 500 ms guard, so a
   * stalled decode cannot hang the track task forever. */
  async sampleGrey(mediaId: string, sourceTime: number, w = 160): Promise<GreyFrame | null> {
    const size = this.size(mediaId);
    if (!size || !(size.width > 0 && size.height > 0)) return null;
    const width = Math.max(2, Math.round(w));
    const height = Math.max(2, Math.round((width * size.height) / size.width));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const img = this.images.get(mediaId);
    if (img) {
      ctx.drawImage(img, 0, 0, width, height);
      return rgbaToGrey(ctx.getImageData(0, 0, width, height).data, width, height);
    }
    const v = this.videos.get(mediaId);
    if (!v) return null; // generators have no decodable frame
    let el = this.samplers.get(mediaId);
    if (!el) {
      el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = v.url;
      this.samplers.set(mediaId, el);
    }
    try {
      if (el.readyState < 2) {
        await new Promise<void>((res, rej) => {
          const timer = setTimeout(() => { cleanup(); rej(new Error('sample load timeout')); }, 4000);
          const done = () => { cleanup(); res(); };
          const fail = () => { cleanup(); rej(new Error('sample decode')); };
          const cleanup = () => {
            clearTimeout(timer);
            el!.removeEventListener('loadeddata', done);
            el!.removeEventListener('error', fail);
          };
          el!.addEventListener('loadeddata', done, { once: true });
          el!.addEventListener('error', fail, { once: true });
        });
      }
      const target = Math.max(0, Math.min(sourceTime, Math.max(0, (el.duration || sourceTime) - 0.001)));
      await new Promise<void>((res) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          el!.removeEventListener('seeked', finish);
          res();
        };
        const timer = setTimeout(finish, 500);
        el!.addEventListener('seeked', finish, { once: true });
        // A seek to the CURRENT time may not emit 'seeked'. Decide before
        // assigning: currentTime changes synchronously even while decoding.
        if (Math.abs(el!.currentTime - target) < 0.02 && el!.readyState >= 2) { finish(); return; }
        try { el!.currentTime = target; } catch { finish(); }
      });
      ctx.drawImage(el, 0, 0, width, height);
      return rgbaToGrey(ctx.getImageData(0, 0, width, height).data, width, height);
    } catch {
      return null;
    }
  }

  unregister(mediaId: string) {
    const sampler = this.samplers.get(mediaId);
    if (sampler) { sampler.pause(); sampler.removeAttribute('src'); sampler.load(); this.samplers.delete(mediaId); }
    const v = this.videos.get(mediaId);
    if (v) { v.el.pause(); URL.revokeObjectURL(v.url); v.el.src = ''; this.videos.delete(mediaId); }
    for (const [key, uv] of this.useVideos) {
      if (key.startsWith(mediaId + '|')) { uv.el.pause(); uv.el.removeAttribute('src'); uv.el.load(); this.useVideos.delete(key); }
    }
    const av = this.audios.get(mediaId);
    if (av) { av.el.pause(); URL.revokeObjectURL(av.url); av.el.src = ''; this.audios.delete(mediaId); }
    for (const [key, a] of this.useAudios) {
      if (key.startsWith(mediaId + '|')) { a.el.pause(); a.el.src = ''; this.useAudios.delete(key); }
    }
    this.images.get(mediaId)?.close();
    this.images.delete(mediaId);
    this.lastFrames.delete(mediaId);
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
    for (const sampler of this.samplers.values()) { sampler.pause(); sampler.removeAttribute('src'); sampler.load(); }
    this.samplers.clear();
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }
}