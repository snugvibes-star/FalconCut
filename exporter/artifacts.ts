import { getMedia, projectDuration, activeClips, sourceTimeOf, type Project } from '../engine/types';
import { buildAudioGraph } from '../engine/audio';
import { renderFrame } from '../engine/render';
import { abortable, type BlobLoader } from './lifecycle';
import { collectFrameRequests, ExportFrameResolver, prepareExportFonts } from './frames';
import { encodeWAV } from '../engine/wav';
export type { BlobLoader } from './lifecycle';
export { encodeWAV };

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, '0')}:${String(Math.floor(ms / 60_000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

export function projectSRT(project: Project): string {
  return project.clips.filter((c) => c.text?.role === 'caption' && !project.tracks.find((t) => t.id === c.trackId)?.hidden)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text!.text.replace(/\r\n/g, '\n').trim()}\n`)
    .join('\n');
}

export async function mixProjectAudio(project: Project, loadBlob: BlobLoader): Promise<AudioBuffer> {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Add clips before exporting audio.');
  if (duration > 300) throw new Error('Offline WAV export is currently limited to 5 minutes to bound memory usage.');
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * project.settings.sampleRate), project.settings.sampleRate);
  const buffers = new Map<string, AudioBuffer>();
  const ids = new Set(project.clips.filter((c) => !project.tracks.find((t) => t.id === c.trackId)?.muted).map((c) => c.mediaId));
  for (const asset of project.media) {
    if (!ids.has(asset.id)) continue;
    // Generators are procedural and carry no audio blob — skip, don't fail.
    if (asset.type === 'generator' || !asset.blobKey) continue;
    // Decode every used asset's audio, not only assets flagged hasAudio — the
    // probe flag is unreliable (videos with real audio are often flagged false).
    // A silent video decodes to silence and mixes in harmlessly.
    const blob = await loadBlob(asset.blobKey);
    if (!blob) throw new Error(`Missing source audio: ${asset.name}. Reimport the file.`);
    try { buffers.set(asset.id, await ctx.decodeAudioData(await blob.arrayBuffer())); }
    catch { /* no decodable audio in this container — fine for images/silent video */ }
  }
  const graph = buildAudioGraph(project, ctx, ctx.destination, buffers, { startAt: 0, when: 0 });
  try { return await ctx.startRendering(); }
  finally { graph.stop(); }
}

export async function projectPNG(project: Project, time: number, loadBlob: BlobLoader): Promise<Blob> {
  await document.fonts.ready;
  const frames = new Map<string, CanvasImageSource>();
  const cleanup: (() => void)[] = [];
  try {
    for (const clip of activeClips(project, time)) {
      if (project.tracks.find((t) => t.id === clip.trackId)?.hidden) continue;
      const asset = getMedia(project, clip.mediaId);
      if (!asset || !['image', 'video'].includes(asset.type)) continue;
      const blob = asset.blobKey ? await loadBlob(asset.blobKey) : undefined;
      if (!blob) throw new Error(`Missing source image/video: ${asset.name}. Reimport it.`);
      const t = sourceTimeOf(clip, time);
      const key = `${asset.id}:${t}`;
      if (asset.type === 'image') {
        const bitmap = await createImageBitmap(blob);
        cleanup.push(() => bitmap.close());
        frames.set(key, bitmap);
      } else {
        const el = document.createElement('video');
        const url = URL.createObjectURL(blob);
        el.muted = true; el.preload = 'auto';
        cleanup.push(() => { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); });
        const wait = (event: string, start: () => void) => new Promise<void>((resolve, reject) => {
          const clear = () => { clearTimeout(timer); el.removeEventListener(event, done); el.removeEventListener('error', fail); };
          const done = () => { clear(); resolve(); };
          const fail = () => { clear(); reject(new Error(`Cannot decode a frame from ${asset.name}.`)); };
          const timer = setTimeout(fail, 10_000);
          el.addEventListener(event, done, { once: true }); el.addEventListener('error', fail, { once: true });
          start();
        });
        await wait('loadeddata', () => { el.src = url; });
        const target = Math.max(0, Math.min(t, el.duration - 0.001));
        if (Math.abs(el.currentTime - target) > 0.0001) await wait('seeked', () => { el.currentTime = target; });
        frames.set(key, el);
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = project.settings.width; canvas.height = project.settings.height;
    renderFrame(project, time, canvas.getContext('2d')!, {
      frame: (id, t) => frames.get(`${id}:${t}`) ?? null,
      size: (id) => { const asset = getMedia(project, id); return asset ? { width: asset.width, height: asset.height } : null; },
    });
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('PNG encoding failed.')), 'image/png'));
  } finally { cleanup.forEach((fn) => fn()); }
}
