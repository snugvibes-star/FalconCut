import { getMedia, projectDuration, type Project } from '../engine/types';
import { buildAudioGraph } from '../engine/audio';
import { audioBufferKey, decodeMp4AudioTrack } from '../engine/audioTracks';
import { renderFrame } from '../engine/render';
import { abortable, type BlobLoader } from './lifecycle';
import { collectFrameRequests, frameKey, ExportFrameResolver, prepareExportFonts } from './frames';
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

/** WebVTT export of the caption track — accepted by YouTube, Vimeo and most editors. */
export function projectVTT(project: Project): string {
  const cues = project.clips
    .filter((c) => c.text?.role === 'caption' && !project.tracks.find((t) => t.id === c.trackId)?.hidden)
    .sort((a, b) => a.start - b.start);
  if (!cues.length) return '';
  const t = (s: number) => srtTime(s).replace(',', '.');
  return `WEBVTT\n\n${cues.map((c) => `${t(c.start)} --> ${t(c.start + c.duration)}\n${c.text!.text.replace(/\r\n/g, '\n').trim()}`).join('\n\n')}\n`;
}

export async function mixProjectAudio(project: Project, loadBlob: BlobLoader): Promise<AudioBuffer> {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Add clips before exporting audio.');
  const sr = project.settings.sampleRate;
  if (duration > 1800) throw new Error('Audio export is limited to 30 minutes to bound browser memory. Split the project into parts.');
  // Source audio is decoded once into a small context; each timeline window is
  // then rendered independently. This removes the old 5-minute hard cap that
  // silently produced video with NO audio because video.ts swallowed the error.
  const decoder = new OfflineAudioContext(1, 1, sr);
  const buffers = new Map<string, AudioBuffer>();
  const audibleClips = project.clips.filter((c) => !project.tracks.find((t) => t.id === c.trackId)?.muted);
  const ids = new Set(audibleClips.map((c) => c.mediaId));
  // Explicitly chosen tracks must be decoded separately: the browser's
  // decodeAudioData always picks the file's default track.
  const chosenTracks = new Map<string, Set<number>>();
  for (const c of audibleClips) {
    if (c.audioTrackId == null || !c.mediaId) continue;
    const set = chosenTracks.get(c.mediaId) ?? new Set<number>();
    set.add(c.audioTrackId);
    chosenTracks.set(c.mediaId, set);
  }
  for (const asset of project.media) {
    if (!ids.has(asset.id)) continue;
    if (asset.type === 'generator' || !asset.blobKey) continue;
    const blob = await loadBlob(asset.blobKey);
    if (!blob) throw new Error(`Missing source audio: ${asset.name}. Reimport the file.`);
    try { buffers.set(asset.id, await decoder.decodeAudioData(await blob.arrayBuffer())); }
    catch { /* no decodable audio in this container — fine for images/silent video */ }
    for (const trackId of chosenTracks.get(asset.id) ?? []) {
      const key = audioBufferKey(asset.id, trackId);
      if (buffers.has(key)) continue;
      try {
        buffers.set(key, await decodeMp4AudioTrack(blob, trackId));
      } catch (e) {
        // Fail loudly instead of exporting the wrong language silently.
        throw new Error(`Selected audio track ${trackId} of "${asset.name}" could not be decoded: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const CHUNK = 120; // seconds per offline render
  const PREROLL = 2.5; // seconds of overlap so delay/compressor tails carry across chunks
  const rendered: { offset: number; buffer: AudioBuffer }[] = [];
  for (let start = 0; start < duration; start += CHUNK) {
    const end = Math.min(duration, start + CHUNK);
    const renderStart = Math.max(0, start - PREROLL);
    const skip = Math.round((start - renderStart) * sr);
    const len = Math.ceil((end - start) * sr);
    const ctx = new OfflineAudioContext(2, Math.ceil((end - renderStart) * sr), sr);
    const graph = buildAudioGraph(project, ctx, ctx.destination, buffers, { startAt: renderStart, when: 0, endAt: end });
    let full: AudioBuffer;
    try { full = await ctx.startRendering(); }
    finally { graph.stop(); }
    if (skip === 0 && full.length === len) {
      rendered.push({ offset: Math.round(start * sr), buffer: full });
      continue;
    }
    const chunk = decoder.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      chunk.getChannelData(ch).set(full.getChannelData(ch).subarray(skip, Math.min(full.length, skip + len)));
    }
    rendered.push({ offset: Math.round(start * sr), buffer: chunk });
  }
  if (rendered.length === 1) return rendered[0].buffer;
  const out = decoder.createBuffer(2, Math.ceil(duration * sr), sr);
  for (const { offset, buffer } of rendered) {
    for (let ch = 0; ch < 2; ch++) out.getChannelData(ch).set(buffer.getChannelData(ch), offset);
  }
  return out;
}

export async function projectPNG(project: Project, time: number, loadBlob: BlobLoader): Promise<Blob> {
  // Same font preparation as video export — otherwise a not-yet-requested font
  // renders with a fallback here but correctly in the exported video.
  await prepareExportFonts(project);
  await document.fonts.ready;
  const frames = new Map<string, CanvasImageSource>();
  const cleanup: (() => void)[] = [];
  try {
    // Ask the renderer which frames it wants — including the previous/next
    // clip at a transition — instead of only activeClips(). This keeps the
    // still-image export WYSIWYG at cut boundaries just like the video exporter.
    const scratch = document.createElement('canvas').getContext('2d')!;
    const requests = collectFrameRequests(project, time, scratch);
    for (const req of requests) {
      const asset = getMedia(project, req.mediaId);
      if (!asset || !['image', 'video'].includes(asset.type)) continue;
      const blob = asset.blobKey ? await loadBlob(asset.blobKey) : undefined;
      if (!blob) throw new Error(`Missing source image/video: ${asset.name}. Reimport it.`);
      const t = req.sourceTime;
      const key = frameKey(asset.id, t);
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
