import { getMedia, type Project } from '../engine/types';
import { renderFrame } from '../engine/render';
import type { MediaResolver } from '../engine/media';
import { abortable, checkAbort, type BlobLoader } from './lifecycle';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export interface FrameRequest { mediaId: string; sourceTime: number }
export const frameKey = (id: string, time: number) => `${id}:${time}`;

/** Ask the renderer itself, including its previous-clip transition rules. No duplicate clip selection logic. */
export function collectFrameRequests(project: Project, time: number, ctx: Context): FrameRequest[] {
  const requests = new Map<string, FrameRequest>();
  renderFrame({ ...project, media: project.media.filter((m) => m.type === 'image' || m.type === 'video'),
    clips: project.clips.filter((c) => c.kind === 'media') }, time, ctx, {
    frame: (mediaId, sourceTime) => { requests.set(frameKey(mediaId, sourceTime), { mediaId, sourceTime }); return null; },
    size: () => null,
  });
  return [...requests.values()];
}

/** Main-thread rendering shares the preview's FontFaceSet, including caller-registered uploaded fonts. */
export async function prepareExportFonts(project: Project, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  const loads = new Map<string, string>();
  for (const c of project.clips) if (c.text) {
    const font = `${c.text.style.fontWeight} 48px ${JSON.stringify(c.text.style.fontFamily)}`;
    loads.set(font, (loads.get(font) ?? '') + c.text.text);
  }
  if (project.clips.some((c) => c.motif)) {
    for (const family of ['Inter Variable', 'Space Grotesk Variable'])
      for (const weight of [500, 600, 700, 800]) loads.set(`${weight} 48px "${family}"`, 'FalconCut 0123456789');
  }
  await abortable(Promise.all([...loads].map(([font, text]) => document.fonts.load(font, text))), signal);
  await abortable(document.fonts.ready, signal);
}

interface VideoSource { el: HTMLVideoElement; url: string }
const MAX_FRAME_BYTES = 256 * 1024 * 1024;
const MAX_VIDEO_SOURCES = 8;

/** Private decoders never seek preview elements. Browser seeking is NOT a frame-exact demuxer. */
export class ExportFrameResolver implements MediaResolver {
  private frames = new Map<string, ImageBitmap>();
  private videos = new Map<string, VideoSource>();
  constructor(private project: Project, private loadBlob: BlobLoader, private signal?: AbortSignal) {}

  frame(id: string, time: number): CanvasImageSource | null { return this.frames.get(frameKey(id, time)) ?? null; }
  size(id: string) { const a = getMedia(this.project, id); return a ? { width: a.width, height: a.height } : null; }

  private closeVideo(id: string) {
    const v = this.videos.get(id);
    if (!v) return;
    v.el.pause(); v.el.removeAttribute('src'); v.el.load(); URL.revokeObjectURL(v.url);
    this.videos.delete(id);
  }

  private wait(el: HTMLVideoElement, event: string, start: () => void, name: string): Promise<void> {
    checkAbort(this.signal);
    return new Promise((resolve, reject) => {
      const clear = () => { clearTimeout(timer); el.removeEventListener(event, done); el.removeEventListener('error', fail); this.signal?.removeEventListener('abort', cancel); };
      const done = () => { clear(); resolve(); };
      const fail = () => { clear(); reject(new Error(`Cannot decode a frame from ${name}.`)); };
      const cancel = () => { clear(); reject(new DOMException('Export cancelled.', 'AbortError')); };
      const timer = setTimeout(fail, 15_000);
      el.addEventListener(event, done, { once: true }); el.addEventListener('error', fail, { once: true });
      this.signal?.addEventListener('abort', cancel, { once: true });
      try { start(); } catch (error) { clear(); reject(error); }
    });
  }

  async prepare(requests: FrameRequest[]): Promise<void> {
    this.releaseFrames();
    checkAbort(this.signal);
    if (requests.length > 32) throw new Error('Export supports at most 32 simultaneous source frames.');
    let bytes = 0;
    try {
      for (const { mediaId, sourceTime } of requests) {
        checkAbort(this.signal);
        const asset = getMedia(this.project, mediaId);
        if (!asset || (asset.type !== 'image' && asset.type !== 'video')) throw new Error(`Missing visual source: ${mediaId}.`);
        const estimated = asset.width * asset.height * 4;
        if (bytes + estimated > MAX_FRAME_BYTES) throw new Error('Source frames exceed the 256 MiB export memory limit. Resize your source media.');
        let bitmap: ImageBitmap;
        if (asset.type === 'image') {
          const blob = asset.blobKey ? await abortable(this.loadBlob(asset.blobKey), this.signal) : undefined;
          if (!blob) throw new Error(`Missing source image: ${asset.name}. Reimport it.`);
          bitmap = await abortable(createImageBitmap(blob), this.signal, (b) => b.close());
        } else {
          let video = this.videos.get(mediaId);
          if (!video) {
            const blob = asset.blobKey ? await abortable(this.loadBlob(asset.blobKey), this.signal) : undefined;
            if (!blob) throw new Error(`Missing source video: ${asset.name}. Reimport it.`);
            if (this.videos.size >= MAX_VIDEO_SOURCES) this.closeVideo(this.videos.keys().next().value!);
            const el = document.createElement('video');
            video = { el, url: URL.createObjectURL(blob) };
            this.videos.set(mediaId, video);
            el.muted = true; el.playsInline = true; el.preload = 'auto';
            await this.wait(el, 'loadeddata', () => { el.src = video!.url; }, asset.name);
          }
          // LRU: keep only eight decoder elements. Frames already captured remain immutable.
          this.videos.delete(mediaId); this.videos.set(mediaId, video);
          const el = video.el;
          if (!Number.isFinite(sourceTime) || !Number.isFinite(el.duration) || el.duration <= 0) throw new Error(`Invalid source time/duration: ${asset.name}.`);
          const target = Math.max(0, Math.min(sourceTime, Math.max(0, el.duration - 0.001)));
          if (Math.abs(el.currentTime - target) > 0.000001) await this.wait(el, 'seeked', () => { el.currentTime = target; }, asset.name);
          bitmap = await abortable(createImageBitmap(el), this.signal, (b) => b.close());
        }
        bytes += bitmap.width * bitmap.height * 4;
        if (bytes > MAX_FRAME_BYTES) { bitmap.close(); throw new Error('Source frames exceed the 256 MiB export memory limit.'); }
        this.frames.set(frameKey(mediaId, sourceTime), bitmap);
      }
    } catch (error) { this.dispose(); throw error; }
  }

  releaseFrames() { for (const frame of this.frames.values()) frame.close(); this.frames.clear(); }
  dispose() { this.releaseFrames(); for (const id of [...this.videos.keys()]) this.closeVideo(id); }
}
