/**
 * Animated GIF export from the SAME renderFrame the preview uses (WYSIWYG):
 * every frame is decoded from the source files, rendered by the engine, then
 * quantized to a 256-color palette (computed from the middle frame). Bounded
 * to 240 frames so long sections cannot blow up memory; the frame step is
 * stretched instead (the GIF still covers the whole section).
 */
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { getMedia, activeClips, sourceTimeOf, type Project } from '../engine/types';
import { renderFrame } from '../engine/render';
import type { BlobLoader } from './lifecycle';

export interface GifOptions {
  start: number;
  end: number;
  fps: number;
  width: number;
}

const MAX_FRAMES = 240;

export async function projectGIF(
  project: Project,
  loadBlob: BlobLoader,
  opts: GifOptions,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const { start, fps } = opts;
  const duration = opts.end - start;
  if (duration <= 0.05) throw new Error('Nothing to export — mark a section (I / O keys) or use a non-empty project.');
  const frameCount = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration * fps)));
  const step = duration / frameCount;
  const width = Math.max(2, Math.min(opts.width, project.settings.width));
  const height = Math.max(2, Math.round((width * project.settings.height) / project.settings.width));

  // Collect media used inside the section on visible tracks.
  const usedIds = new Set<string>();
  const range = (t: number) => activeClips(project, t).filter((c) => !project.tracks.find((tr) => tr.id === c.trackId)?.hidden);
  for (let i = 0; i < frameCount; i++) {
    for (const clip of range(start + i * step)) {
      const asset = getMedia(project, clip.mediaId);
      if (asset && (asset.type === 'video' || asset.type === 'image')) usedIds.add(asset.id);
    }
  }
  if (usedIds.size === 0 && project.clips.length === 0) throw new Error('Add clips before exporting a GIF.');

  // Decode once: images as bitmaps, videos as seekable hidden elements.
  const images = new Map<string, ImageBitmap>();
  const videos = new Map<string, HTMLVideoElement>();
  const sizes = new Map<string, { width: number; height: number }>();
  const cleanup: (() => void)[] = [];
  try {
    for (const id of usedIds) {
      const asset = getMedia(project, id);
      if (!asset?.blobKey) throw new Error(`Missing source file: ${asset?.name ?? id}. Reimport it.`);
      const blob = await loadBlob(asset.blobKey);
      if (!blob) throw new Error(`Missing source file: ${asset.name}. Reimport it.`);
      if (asset.type === 'image') {
        const bmp = await createImageBitmap(blob);
        images.set(id, bmp);
        cleanup.push(() => bmp.close());
        sizes.set(id, { width: bmp.width, height: bmp.height });
      } else {
        const el = document.createElement('video');
        el.muted = true; el.playsInline = true; el.preload = 'auto';
        const url = URL.createObjectURL(blob);
        cleanup.push(() => { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); });
        await new Promise<void>((res) => {
          const done = () => res();
          el.addEventListener('loadeddata', done, { once: true });
          el.addEventListener('error', done, { once: true });
          el.src = url;
          setTimeout(done, 8000);
        });
        videos.set(id, el);
        sizes.set(id, { width: el.videoWidth || asset.width || 1, height: el.videoHeight || asset.height || 1 });
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const resolver = {
      frame: (id: string, _sourceTime: number) => images.get(id) ?? videos.get(id) ?? null,
      size: (id: string) => sizes.get(id) ?? null,
    };

    const seekTo = (el: HTMLVideoElement, t: number) => new Promise<void>((res) => {
      if (el.readyState < 1 || Math.abs(el.currentTime - t) <= 0.001) return res();
      const done = () => { el.removeEventListener('seeked', done); clearTimeout(timer); res(); };
      const timer = setTimeout(done, 400);
      el.addEventListener('seeked', done, { once: true });
      try { el.currentTime = Math.max(0, t); } catch { done(); }
    });

    /** Position every asset for timeline time `t`, render one frame, return RGBA. */
    const captureFrame = async (t: number): Promise<Uint8ClampedArray> => {
      for (const clip of range(t)) {
        if (typeof clip.mediaId !== 'string') continue;
        const el = videos.get(clip.mediaId);
        if (el) await seekTo(el, sourceTimeOf(clip, t));
      }
      renderFrame(project, t, ctx, resolver);
      return ctx.getImageData(0, 0, width, height).data;
    };

    if (signal?.aborted) throw Object.assign(new Error('GIF export cancelled.'), { name: 'AbortError' });

    // Global palette from the middle frame — one quantization, consistent look.
    const midData = await captureFrame(start + (frameCount / 2) * step);
    const palette = quantize(midData, 256, { format: 'rgb565' });

    const encoder = GIFEncoder();
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) throw Object.assign(new Error('GIF export cancelled.'), { name: 'AbortError' });
      const rgba = i === Math.floor(frameCount / 2) ? midData : await captureFrame(start + i * step);
      const index = applyPalette(rgba, palette, 'rgb565');
      encoder.writeFrame(index, width, height, { palette, delay: Math.max(20, Math.round(step * 1000)) });
      onProgress?.((i + 1) / frameCount);
      // Yield so the tab stays responsive during long runs.
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    encoder.finish();
    return new Blob([encoder.bytes() as BlobPart], { type: 'image/gif' });
  } finally {
    cleanup.forEach((fn) => fn());
  }
}
