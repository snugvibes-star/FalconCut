/**
 * WebM export (VP9 + Opus) via MediaRecorder.
 *
 * Preview = export: we render frames straight through the same `renderFrame`
 * the preview uses, draw them to an OffscreenCanvas whose `captureStream(fps)`
 * feeds a MediaRecorder, and mix the project's audio through the same engine
 * (`mixProjectAudio`) into a real-time AudioDestination stream. Both tracks go
 * into one MediaRecorder → one WebM download.
 *
 * Honest limits (see checklist):
 * - Records in real time: a 60s project takes ~60s to export.
 * - Frame accuracy depends on render keeping up with the clock; long or
 *   effect-heavy projects may drop frames.
 * - Audio is mixed down first (volume, fades, enabled effects all apply).
 */
import { projectDuration, type Project } from '../engine/types';
import { renderFrame } from '../engine/render';
import { mixProjectAudio } from './artifacts';
import type { BlobLoader } from './lifecycle';

const MAX_DURATION = 300; // seconds — bound memory / real-time cost

/** Seek a video element to `t`, waiting for the frame to land. */
async function seekFrame(el: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(el.currentTime - t) <= 0.02) return;
  el.currentTime = Math.max(0, Math.min(t, (el.duration || t) - 0.001));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('video seek timeout')), 10_000);
    const done = () => { clearTimeout(timer); el.removeEventListener('seeked', done); el.removeEventListener('error', fail); resolve(); };
    const fail = () => { clearTimeout(timer); el.removeEventListener('seeked', done); el.removeEventListener('error', fail); reject(new Error('cannot decode video frame')); };
    el.addEventListener('seeked', done, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

/** One <video> per visual asset, reused across frames (never touches preview). */
const videoByAsset = new Map<string, HTMLVideoElement>();
function videoFor(asset: { blobKey?: string; name: string; duration?: number }, loadBlob: BlobLoader): HTMLVideoElement {
  let el = videoByAsset.get(asset.name);
  if (!el) {
    el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    videoByAsset.set(asset.name, el);
  }
  return el;
}

export async function projectWebM(
  project: Project,
  loadBlob: BlobLoader,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('Add clips to the timeline before exporting video.');
  if (duration > MAX_DURATION) throw new Error(`Video export is limited to ${MAX_DURATION} seconds.`);
  const { width, height, fps = 30 } = project.settings;

  // Mixed audio (volume, fades, enabled effects). Silence if no audio clips.
  const audioBuffer = await mixProjectAudio(project, loadBlob);

  // Load each source video once. Without this the elements have no src and
  // every exported frame is just the background colour.
  const objectUrls: string[] = [];
  for (const asset of project.media) {
    if (asset.type !== 'video' || !asset.blobKey) continue;
    const blob = await loadBlob(asset.blobKey);
    if (!blob) continue;
    const el = videoFor(asset, loadBlob);
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    el.src = url;
    await new Promise<void>((res) => {
      if (el.readyState >= 2) return res();
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(timer); res(); } };
      const timer = setTimeout(finish, 5000);
      el.addEventListener('loadeddata', finish, { once: true });
      el.addEventListener('error', finish, { once: true });
    });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  // Draw frame 0 first: captureStream on an untouched canvas yields an ended
  // track (Chromium quirk). A drawn canvas yields a live track.
  renderFrame(project, 0, ctx, {
    frame: () => null,
    size: (id) => { const a = project.media.find((m) => m.id === id); return a ? { width: a.width ?? width, height: a.height ?? height } : null; },
  });
  const videoTrack = canvas.captureStream(fps).getVideoTracks()[0];

  // Real-time audio stream synced to the same wall clock as the recorder.
  const ctxAudio = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctxAudio.state === 'suspended') await ctxAudio.resume();
  const dest = ctxAudio.createMediaStreamDestination();
  const src = ctxAudio.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(dest);
  const audioTrack = dest.stream.getAudioTracks()[0];
  const stream = new MediaStream([videoTrack, audioTrack]);

  const chunks: Blob[] = [];
  let rejectExport: (e: Error) => void = () => { /* replaced by the promise below */ };
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let finished = false;
  recorder.onerror = (e) => { rejectExport(e instanceof Error ? e : new Error('Recorder failed')); };
  recorder.onstop = () => {
    finished = true; videoTrack.stop(); audioTrack.stop(); src.stop();
    ctxAudio.close().catch(() => {});
    for (const url of objectUrls) URL.revokeObjectURL(url);
  };

  const startWall = performance.now();
  let startAudioAt = 0;

  recorder.start(1000); // flush every ~1s so memory stays bounded
  if (startAudioAt === 0) { startAudioAt = ctxAudio.currentTime; src.start(startAudioAt); }

  const stopAt = startWall + duration * 1000;
  let lastFrame = -1;

  const drawLoop = (now: number): void => {
    if (signal?.aborted) { recorder.stop(); return; }
    const elapsed = (now - startWall) / 1000;
    if (finished || elapsed >= duration) {
      recorder.stop();
      onProgress?.(1);
      return;
    }
    const frameIndex = Math.floor(elapsed * fps);
    if (frameIndex !== lastFrame) {
      lastFrame = frameIndex;
      ctx.clearRect(0, 0, width, height);
      renderFrame(project, elapsed, ctx, {
        frame: (mediaId, sourceTime) => {
          const asset = project.media.find((m) => m.id === mediaId);
          if (!asset || asset.type !== 'video') return null;
          const el = videoFor(asset, loadBlob);
          // fire-and-forget seek; drawLoop will redraw next frame once seeked
          void seekFrame(el, sourceTime).catch(() => {
            // A failed seek must not become an unhandled rejection; the next
            // frame will retry and the canvas still renders other layers.
          });
          return el.readyState >= 2 ? el : null;
        },
        size: (id) => { const a = project.media.find((m) => m.id === id); return a ? { width: a.width ?? width, height: a.height ?? height } : null; },
      });
      onProgress?.(0.1 + 0.8 * Math.min(1, elapsed / duration));
    }
    requestAnimationFrame(drawLoop);
  };
  requestAnimationFrame(drawLoop);

  return new Promise<Blob>((resolve, reject) => {
    rejectExport = reject;
    const wait = () => {
      if (finished) resolve(new Blob(chunks, { type: 'video/webm' }));
      else if (signal?.aborted) reject(new DOMException('Export cancelled.', 'AbortError'));
      else setTimeout(wait, 50);
    };
    wait();
  });
}
