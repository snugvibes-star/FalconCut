/**
 * Region Crop / Extract Area workspace.
 *
 * Non-destructive region extraction. Shows the SELECTED media clip's SOURCE
 * frame (ignoring its current crop) fit to the preview; the user drags a
 * rectangle with resizable corners/edges. Everything commits as `set_transform`
 * crop fields — the SAME fields the renderer (preview) and the exporter consume
 * — so no re-encode, no resolution change, source pixels preserved.
 *
 *   - Apply Crop: crops the original clip in place (non-destructive).
 *   - Extract as New Clip: leaves the original untouched and adds an independent
 *     clip (same source mediaId / timing) whose content is only the selected
 *     region, on a free video track.
 *
 * Deliberately minimal UI (drag + two actions) so it fits any canvas aspect,
 * including tall 9:16 projects on small screens.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { defaultTransform, getMedia, sourceTimeOf, uid, type Action, type Clip } from '../../../engine';

interface Rect { x: number; y: number; w: number; h: number } // source pixels
type Handle = 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';
type Drag =
  | { kind: 'new'; start: { x: number; y: number } }
  | { kind: 'move'; start: { x: number; y: number }; orig: Rect }
  | { kind: 'handle'; h: Handle; start: { x: number; y: number }; orig: Rect };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampRect(r: Rect, sw: number, sh: number): Rect {
  const minW = Math.max(8, sw * 0.04), minH = Math.max(8, sh * 0.04);
  let { x, y, w, h } = r;
  w = clamp(w, minW, sw);
  h = clamp(h, minH, sh);
  x = clamp(x, 0, sw - w);
  y = clamp(y, 0, sh - h);
  return { x, y, w, h };
}

export function CropOverlay({ scale }: { scale: number }) {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const frameTick = useStore((s) => s.frameTick);
  const selection = useStore((s) => s.selection);
  const pool = useStore.getState().pool;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const clip: Clip | undefined = selection[0] ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const asset = clip && clip.kind === 'media' ? getMedia(project, clip.mediaId) : undefined;
  const usable = !!asset && (asset.type === 'video' || asset.type === 'image');
  const size = usable
    ? pool.size(asset!.id) ?? { width: asset!.width || project.settings.width, height: asset!.height || project.settings.height }
    : null;

  const W = project.settings.width, H = project.settings.height;
  const fs = size ? Math.min(W / size.width, H / size.height) : 1;
  const ox = size ? (W - size.width * fs) / 2 : 0;
  const oy = size ? (H - size.height * fs) / 2 : 0;

  const clipId = clip?.id;
  const cropSig = clip
    ? `${clip.transform.cropL}|${clip.transform.cropR}|${clip.transform.cropT}|${clip.transform.cropB}`
    : '';
  useEffect(() => {
    if (!clip || !size) { rectRef.current = null; setRect(null); return; }
    const r: Rect = {
      x: (clip.transform.cropL || 0) * size.width,
      y: (clip.transform.cropT || 0) * size.height,
      w: (1 - (clip.transform.cropL || 0) - (clip.transform.cropR || 0)) * size.width,
      h: (1 - (clip.transform.cropT || 0) - (clip.transform.cropB || 0)) * size.height,
    };
    rectRef.current = r;
    setRect(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, cropSig, size?.width, size?.height]);

  const commitRect = (r: Rect | null) => { rectRef.current = r; setRect(r); };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dw = Math.max(1, Math.round(W * scale)), dh = Math.max(1, Math.round(H * scale));
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);
    ctx.fillStyle = '#0b0b0e';
    ctx.fillRect(0, 0, dw, dh);

    if (!size) {
      // Small canvases (9:16 on a phone) get shorter, smaller copy so the
      // hint never overflows the frame.
      const small = dw < 320;
      const fsPx = Math.max(9, Math.min(13, Math.round(dw / 24)));
      ctx.fillStyle = '#d7dbe6';
      ctx.font = `500 ${fsPx}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = small
        ? ['Select a video clip', 'then drag a region']
        : ['Select a video or image clip on the timeline,', 'then drag a region to keep'];
      lines.forEach((line, i) => {
        ctx.fillText(line, dw / 2, dh / 2 + (i - (lines.length - 1) / 2) * fsPx * 1.5);
      });
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    const src = usable ? pool.frame(asset!.id, sourceTimeOf(clip!, playhead), clip!.id) : null;
    const ix = ox * scale, iy = oy * scale, iw = size.width * fs * scale, ih = size.height * fs * scale;
    if (src) ctx.drawImage(src, ix, iy, iw, ih);
    else { ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.strokeRect(ix, iy, iw, ih); }

    const r = rectRef.current;
    if (!r) return;
    const rx = (ox + r.x * fs) * scale, ry = (oy + r.y * fs) * scale;
    const rw = r.w * fs * scale, rh = r.h * fs * scale;

    ctx.fillStyle = 'rgba(3,4,7,0.72)';
    ctx.fillRect(ix, iy, iw, Math.max(0, ry - iy));
    ctx.fillRect(ix, ry + rh, iw, Math.max(0, iy + ih - (ry + rh)));
    ctx.fillRect(ix, ry, Math.max(0, rx - ix), rh);
    ctx.fillRect(rx + rw, ry, Math.max(0, ix + iw - (rx + rw)), rh);

    ctx.strokeStyle = '#FF3B30'; // selection border — the reference red box
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(255,59,48,0.45)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(rx + (rw * i) / 3, ry); ctx.lineTo(rx + (rw * i) / 3, ry + rh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, ry + (rh * i) / 3); ctx.lineTo(rx + rw, ry + (rh * i) / 3); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = 1;
    const handles: [number, number][] = [
      [rx, ry], [rx + rw / 2, ry], [rx + rw, ry],
      [rx, ry + rh / 2], [rx + rw, ry + rh / 2],
      [rx, ry + rh], [rx + rw / 2, ry + rh], [rx + rw, ry + rh],
    ];
    for (const [hx, hy] of handles) { ctx.fillRect(hx - 4, hy - 4, 8, 8); ctx.strokeRect(hx - 4, hy - 4, 8, 8); }
  };

  useEffect(redraw);

  const toSource = (e: React.PointerEvent) => {
    const el = canvasRef.current!;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / scale;
    const py = (e.clientY - r.top) / scale;
    return { x: clamp((px - ox) / fs, 0, size!.width), y: clamp((py - oy) / fs, 0, size!.height) };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!size || !rectRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const p = toSource(e);
    const r = rectRef.current;
    const tol = 12 / scale / fs;
    const near = (a: number, b: number) => Math.abs(a - b) <= tol;
    const nx = near(p.x, r.x) ? 'l' : near(p.x, r.x + r.w) ? 'r' : null;
    const ny = near(p.y, r.y) ? 't' : near(p.y, r.y + r.h) ? 'b' : null;
    if (nx && ny) { dragRef.current = { kind: 'handle', h: `${ny}${nx}` as Handle, start: p, orig: { ...r } }; return; }
    if (nx || ny) { dragRef.current = { kind: 'handle', h: (nx || ny) as Handle, start: p, orig: { ...r } }; return; }
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      dragRef.current = { kind: 'move', start: p, orig: { ...r } };
      return;
    }
    dragRef.current = { kind: 'new', start: p };
    commitRect({ x: p.x, y: p.y, w: 0, h: 0 });
    redraw();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || !size) return;
    const p = toSource(e);
    let next: Rect;
    if (drag.kind === 'new') {
      next = { x: Math.min(drag.start.x, p.x), y: Math.min(drag.start.y, p.y), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
    } else if (drag.kind === 'move') {
      next = { x: drag.orig.x + (p.x - drag.start.x), y: drag.orig.y + (p.y - drag.start.y), w: drag.orig.w, h: drag.orig.h };
    } else {
      next = resizeHandle(drag.orig, drag.h, p);
    }
    commitRect(clampRect(next, size.width, size.height));
    redraw();
  };

  const onUp = () => { dragRef.current = null; redraw(); };

  const patchFromRect = (r: Rect) => ({
    cropL: +clamp(r.x / size!.width, 0, 0.95).toFixed(5),
    cropR: +clamp((size!.width - (r.x + r.w)) / size!.width, 0, 0.95).toFixed(5),
    cropT: +clamp(r.y / size!.height, 0, 0.95).toFixed(5),
    cropB: +clamp((size!.height - (r.y + r.h)) / size!.height, 0, 0.95).toFixed(5),
  });

  const applyCrop = () => {
    if (!clip || !size || !rect) return;
    useStore.getState().commit([{ type: 'set_transform', clipId: clip.id, patch: patchFromRect(rect) }], 'Apply region crop', 'human');
    useUI.getState().setDrawTool('select');
  };

  const extractAsNewClip = () => {
    if (!clip || !asset || !size || !rect) return;
    const s = useStore.getState();
    const p = s.project;
    const start = clip.start, duration = clip.duration, inPoint = clip.inPoint;
    const end = start + duration;
    const free = (tid: string) => !p.clips.some((c) => c.trackId === tid && c.start < end && start < c.start + c.duration);
    const videoTracks = p.tracks.filter((t) => t.kind === 'video' && !t.locked);
    let trackId = videoTracks.find((t) => free(t.id))?.id;
    const actions: Action[] = [];
    if (!trackId) {
      trackId = uid('trk');
      actions.push({ type: 'add_track', track: { id: trackId, kind: 'video', name: `V${p.tracks.filter((t) => t.kind === 'video').length + 1}` }, index: 0 });
    }
    const tr = { ...defaultTransform(), ...patchFromRect(rect) };
    actions.push({
      type: 'add_clip',
      clip: { trackId, mediaId: clip.mediaId, start, duration, inPoint, fit: 'fill', name: `${clip.name || asset.name || 'Region'} · region`, transform: tr },
    });
    s.commit(actions, 'Extract region as new clip', 'human');
    useUI.getState().toast('Region extracted as an independent clip on a video track', 'success');
    useUI.getState().setDrawTool('select');
  };

  void frameTick;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: 'crosshair' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 max-w-[calc(100%-0.75rem)] rounded-md border border-line bg-ink-950/85 px-1.5 py-0.5 text-[clamp(8px,2vw,10px)] leading-tight text-paper-dim">
        <span className="font-semibold text-signal">REGION</span>
        <span className="ml-1 hidden min-[360px]:inline">drag the box or its handles</span>
      </div>
      <div className="absolute bottom-1.5 left-1/2 z-20 flex max-w-[calc(100%-0.75rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg border border-line bg-ink-950/90 px-1.5 py-1 shadow-panel">
        <button className="btn-ghost px-2 py-1 text-[clamp(9px,2.2vw,11px)] leading-tight" onClick={applyCrop} disabled={!rect || !size} title="Crop the original clip (non-destructive)">Apply Crop</button>
        <button className="btn-solid px-2 py-1 text-[clamp(9px,2.2vw,11px)] leading-tight" onClick={extractAsNewClip} disabled={!rect || !size} title="Create an independent clip containing only the selected region">Extract as New Clip</button>
      </div>
    </>
  );
}

function resizeHandle(orig: Rect, h: Handle, p: { x: number; y: number }): Rect {
  let { x, y, w, h: hh } = orig;
  if (h.includes('l')) { w = orig.x + orig.w - p.x; x = p.x; }
  else if (h.includes('r')) { w = p.x - orig.x; }
  if (h.includes('t')) { hh = orig.y + orig.h - p.y; y = p.y; }
  else if (h.includes('b')) { hh = p.y - orig.y; }
  return { x, y, w, h: hh };
}
