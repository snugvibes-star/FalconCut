/**
 * Direct-manipulation layer over the preview canvas. Everything the user does
 * here goes through the SAME engine actions as the AI tools and the inspector
 * (set_transform / set_text_style / add_drawing / set_drawing), so undo, redo
 * and export all treat preview edits as first-class edits.
 *
 * Select tool: click overlay elements (text, drawings, media), drag to move,
 * corner handles resize, top handle rotates, double-click text edits inline.
 * Snap guides appear at the canvas center lines while dragging.
 * Draw tools: freehand / shapes / stickers rasterize through the engine's
 * drawStrokes and commit as independent drawing clips (editable overlay
 * layers, never burned into the underlying video).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import {
  activeClips, getMedia, resolvedTransform, strokeBounds, layoutCaption, drawStrokes,
  type Clip, type DrawingStroke, type Project,
} from '../../../engine';
import type { MediaPool } from '../../../engine';

interface Hit {
  clip: Clip;
  kind: 'text' | 'drawing' | 'media';
  cx: number; cy: number; // center in project px
  hw: number; hh: number; // half extents in project px (unrotated)
  rot: number; // radians
}

type Drag =
  | { mode: 'move'; hit: Hit; sp: { x: number; y: number }; ox: number; oy: number }
  | { mode: 'resize'; hit: Hit; hw0: number; hh0: number; baseScale: number; baseFontSize: number }
  | { mode: 'rotate'; hit: Hit; cx: number; cy: number; a0: number; rot0: number }
  | { mode: 'draw'; stroke: DrawingStroke }
  | { mode: 'erase' };

const HANDLE_R = 9; // display px hit radius
const SNAP_PX = 10; // project px snap threshold

function rectFor(project: Project, clip: Clip, t: number, pool: MediaPool, measure: CanvasRenderingContext2D): Hit | null {
  const W = project.settings.width, H = project.settings.height;
  const localT = t - clip.start;
  const tr = resolvedTransform(clip, localT);
  if (tr.opacity <= 0.05) return null;
  if (clip.kind === 'text' && clip.text) {
    const layout = layoutCaption(measure, clip.text.text, clip.text.style, W, H, localT, clip.text.words);
    if (!layout.lines.length) return null;
    return { clip, kind: 'text', cx: clip.text.style.x * W, cy: clip.text.style.y * H, hw: layout.blockW / 2, hh: layout.blockH / 2, rot: 0 };
  }
  if (clip.kind === 'drawing' && clip.drawing?.strokes.length) {
    const b = strokeBounds(clip.drawing.strokes);
    if (!b) return null;
    const cx0 = (b.minX + b.maxX) / 2, cy0 = (b.minY + b.maxY) / 2;
    return { clip, kind: 'drawing', cx: cx0 + tr.x, cy: cy0 + tr.y, hw: (b.maxX - b.minX) / 2 * tr.scale, hh: (b.maxY - b.minY) / 2 * tr.scale, rot: (tr.rotation * Math.PI) / 180 };
  }
  if (clip.kind === 'media') {
    const asset = getMedia(project, clip.mediaId);
    if (!asset) return null;
    const size = pool.size(asset.id);
    const sw = size?.width ?? asset.width ?? W, sh = size?.height ?? asset.height ?? H;
    const cw = sw * (1 - tr.cropL - tr.cropR), ch = sh * (1 - tr.cropT - tr.cropB);
    if (cw <= 2 || ch <= 2) return null;
    let s: number;
    if (clip.fit === 'fill') s = Math.max(W / cw, H / ch);
    else s = clip.fit === 'contain' ? Math.min(W / cw, H / ch) : Math.max(W / cw, H / ch);
    return { clip, kind: 'media', cx: W / 2 + tr.x, cy: H / 2 + tr.y, hw: (cw * s * tr.scale) / 2, hh: (ch * s * tr.scale) / 2, rot: (tr.rotation * Math.PI) / 180 };
  }
  return null;
}

/** Hit rects in the same order renderFrame paints (first = bottom-most). */
function hitList(project: Project, t: number, pool: MediaPool, measure: CanvasRenderingContext2D): Hit[] {
  const tracks = [...project.tracks].reverse().sort((a, b) => Number(a.kind === 'text') - Number(b.kind === 'text'));
  const out: Hit[] = [];
  for (const track of tracks) {
    if (track.kind === 'audio' || track.hidden) continue;
    const clips = project.clips
      .filter((c) => c.trackId === track.id && t >= c.start && t < c.start + c.duration)
      .sort((a, b) => a.start - b.start);
    for (const clip of clips) { const h = rectFor(project, clip, t, pool, measure); if (h) out.push(h); }
  }
  return out;
}

function inRect(h: Hit, px: number, py: number): boolean {
  const dx = px - h.cx, dy = py - h.cy;
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c;
  return Math.abs(lx) <= h.hw && Math.abs(ly) <= h.hh;
}

/** Corner display coords for a hit, given display scale S. */
function corners(h: Hit, S: number): { x: number; y: number }[] {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  const pt = (lx: number, ly: number) => ({ x: (h.cx + lx * c - ly * s) * S, y: (h.cy + lx * s + ly * c) * S });
  return [pt(-h.hw, -h.hh), pt(h.hw, -h.hh), pt(h.hw, h.hh), pt(-h.hw, h.hh)];
}

/** Local (unrotated) coords of a project-space point relative to a hit center. */
function localPoint(h: Hit, px: number, py: number): { lx: number; ly: number } {
  const dx = px - h.cx, dy = py - h.cy;
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  return { lx: dx * c + dy * s, ly: -dx * s + dy * c };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function OverlayEditor({ scale }: { scale: number }) {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const draw = useUI((s) => s.draw);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<Hit | null>(null);
  const guideRef = useRef<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [editing, setEditing] = useState<{ clipId: string; value: string; x: number; y: number; w: number; h: number; fontSize: number } | null>(null);

  const pool = useStore.getState().pool;

  useEffect(() => { dragRef.current = null; guideRef.current = { v: false, h: false }; }, [draw.tool]);

  const W = project.settings.width, H = project.settings.height;

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const S = scale;
    const dw = Math.max(1, Math.round(W * S)), dh = Math.max(1, Math.round(H * S));
    if (canvas.width !== dw) canvas.width = dw;
    if (canvas.height !== dh) canvas.height = dh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, dw, dh);
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d');

    // Live stroke preview while a draw gesture is in progress.
    const drag = dragRef.current;
    if (drag?.mode === 'draw') {
      ctx.save();
      ctx.scale(S, S);
      drawStrokes(ctx, [drag.stroke], 0, 0);
      ctx.restore();
      return; // drawing mode hides the selection chrome
    }
    if (draw.tool !== 'select') return;

    const hits = hitList(project, playhead, pool, measureRef.current!);
    // Every visible media layer gets a faint boundary so overlapping overlays
    // are obvious even when they are not selected.
    for (const h of hits) {
      if (h.kind !== 'media' || h.clip.id === selection[0]) continue;
      const cs = corners(h, S);
      ctx.save();
      ctx.strokeStyle = 'rgba(234,234,234,0.35)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    const sel = hits.find((h) => h.clip.id === selection[0]);
    if (hoverRef.current && !sel) {
      const h = hoverRef.current;
      const cs = corners(h, S);
      ctx.save();
      ctx.strokeStyle = 'rgba(234,234,234,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    if (sel) {
      const cs = corners(sel, S);
      ctx.save();
      ctx.strokeStyle = '#4C9AFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      // corner handles + rotate handle
      const s2 = Math.sin(sel.rot);
      const topMid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
      for (const p of cs) {
        ctx.fillStyle = '#4C9AFF';
        ctx.strokeStyle = '#101012';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(p.x - 4, p.y - 4, 8, 8);
        ctx.fill();
        ctx.stroke();
      }
      if (sel.kind !== 'text') {
        // rotate handle above the top edge + stem
        const rp = { x: topMid.x + s2 * 22, y: topMid.y - Math.cos(sel.rot) * 22 };
        ctx.strokeStyle = 'rgba(76,154,255,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(topMid.x, topMid.y); ctx.lineTo(rp.x, rp.y); ctx.stroke();
        ctx.fillStyle = '#101012';
        ctx.strokeStyle = '#4C9AFF';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rp.x, rp.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    // snap guides
    const g = guideRef.current;
    if (g.v || g.h) {
      ctx.save();
      ctx.strokeStyle = '#38BDF8';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1;
      if (g.v) { ctx.beginPath(); ctx.moveTo(dw / 2, 0); ctx.lineTo(dw / 2, dh); ctx.stroke(); }
      if (g.h) { ctx.beginPath(); ctx.moveTo(0, dh / 2); ctx.lineTo(dw, dh / 2); ctx.stroke(); }
      ctx.restore();
    }
  };

  useEffect(redraw);

  const toProject = (e: React.PointerEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const commit = (actions: Parameters<ReturnType<typeof useStore.getState>['commit']>[0], label: string, coalesce?: string) =>
    useStore.getState().commit(actions, label, 'human', coalesce);

  const eraseAt = (px: number, py: number) => {
    const s = useStore.getState();
    if (!measureRef.current) return;
    const hits = hitList(s.project, s.playhead, s.pool, measureRef.current).filter((h) => h.kind === 'drawing');
    const radius = draw.size + 6;
    for (const h of hits) {
      const strokes = h.clip.drawing!.strokes;
      const kept = strokes.filter((st) => {
        if (st.tool === 'sticker') return Math.hypot(st.points[0][0] - px, st.points[0][1] - py) > radius;
        return !st.points.some(([x, y]) => Math.hypot(x - px, y - py) < radius);
      });
      if (kept.length !== strokes.length) {
        if (kept.length === 0) commit([{ type: 'remove_clip', clipId: h.clip.id, ripple: false }], 'Erase drawing', `${h.clip.id}:erase`);
        else commit([{ type: 'set_drawing', clipId: h.clip.id, strokes: kept }], 'Erase stroke', `${h.clip.id}:erase`);
        return;
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useStore.getState();
    if (s.playing) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const p = toProject(e);
    const d = useUI.getState().draw;
    if (d.tool === 'crop') return; // handled by CropOverlay

    if (d.tool !== 'select') {
      if (d.tool === 'eraser') { dragRef.current = { mode: 'erase' }; eraseAt(p.x, p.y); redraw(); return; }
      const stroke: DrawingStroke = {
        tool: d.tool,
        points: [[p.x, p.y]],
        color: d.color,
        size: d.tool === 'sticker' ? Math.max(16, d.size * 6) : Math.max(1, d.size),
        opacity: clamp(d.opacity, 0.05, 1),
        ...(d.tool === 'rect-round' ? { radius: 16 } : {}),
        ...(d.tool === 'sticker' ? { char: d.char } : {}),
        ...(['rect', 'rect-round', 'ellipse', 'polygon'].includes(d.tool) && d.fill ? { fill: d.color } : {}),
      };
      if (d.tool === 'sticker') {
        commit([{ type: 'add_drawing', start: s.playhead, duration: 3, strokes: [stroke] }], 'Add sticker');
        return;
      }
      dragRef.current = { mode: 'draw', stroke };
      redraw();
      return;
    }

    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d');
    const hits = hitList(s.project, s.playhead, s.pool, measureRef.current!);
    const locked = s.lockedIds();

    // 1) handles of the current selection
    const sel = hits.find((h) => h.clip.id === s.selection[0]);
    if (sel) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top; // display px
      const cs = corners(sel, scale);
      for (let i = 0; i < cs.length; i++) {
        if (Math.hypot(cs[i].x - mx, cs[i].y - my) <= HANDLE_R) {
          const tr = resolvedTransform(sel.clip, s.playhead - sel.clip.start);
          dragRef.current = { mode: 'resize', hit: sel, hw0: sel.hw, hh0: sel.hh, baseScale: tr.scale, baseFontSize: sel.clip.text?.style.fontSize ?? 0 };
          return;
        }
      }
      if (sel.kind !== 'text') {
        const c = Math.cos(sel.rot), s2 = Math.sin(sel.rot);
        const topMid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
        const rp = { x: topMid.x + s2 * 22, y: topMid.y - c * 22 };
        if (Math.hypot(rp.x - mx, rp.y - my) <= HANDLE_R + 2) {
          dragRef.current = { mode: 'rotate', hit: sel, cx: sel.cx, cy: sel.cy, a0: Math.atan2(p.y - sel.cy, p.x - sel.cx), rot0: resolvedTransform(sel.clip, s.playhead - sel.clip.start).rotation };
          return;
        }
      }
    }

    // 2) elements, topmost first
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (locked.has(h.clip.id)) continue;
      if (!inRect(h, p.x, p.y)) continue;
      s.select([h.clip.id]);
      dragRef.current = h.kind === 'text'
        ? { mode: 'move', hit: h, sp: p, ox: h.clip.text!.style.x, oy: h.clip.text!.style.y }
        : { mode: 'move', hit: h, sp: p, ox: Number.isFinite(h.clip.transform.x) ? h.clip.transform.x : 0, oy: Number.isFinite(h.clip.transform.y) ? h.clip.transform.y : 0 };
      return;
    }
    s.select([]);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = useStore.getState();
    const p = toProject(e);
    const drag = dragRef.current;
    const d = useUI.getState().draw;

    if (!drag) {
      // hover highlight + cursor
      if (d.tool !== 'select' || !measureRef.current) { if (canvasRef.current) canvasRef.current.style.cursor = d.tool === 'select' ? 'default' : 'crosshair'; return; }
      const hits = hitList(s.project, s.playhead, s.pool, measureRef.current);
      const locked = s.lockedIds();
      let cur = 'default';
      let hover: Hit | null = null;
      const sel = hits.find((h) => h.clip.id === s.selection[0]);
      if (sel) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const cs = corners(sel, scale);
        for (let i = 0; i < cs.length; i++) {
          if (Math.hypot(cs[i].x - mx, cs[i].y - my) <= HANDLE_R) { cur = i === 0 || i === 2 ? 'nwse-resize' : 'nesw-resize'; break; }
        }
        if (cur === 'default' && sel.kind !== 'text') {
          const c = Math.cos(sel.rot), s2 = Math.sin(sel.rot);
          const topMid = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
          const rp = { x: topMid.x + s2 * 22, y: topMid.y - c * 22 };
          if (Math.hypot(rp.x - mx, rp.y - my) <= HANDLE_R + 2) cur = 'grab';
        }
      }
      if (cur === 'default') {
        for (let i = hits.length - 1; i >= 0; i--) {
          const h = hits[i];
          if (locked.has(h.clip.id)) continue;
          if (inRect(h, p.x, p.y)) { hover = h; cur = 'move'; break; }
        }
      }
      hoverRef.current = hover;
      if (canvasRef.current && canvasRef.current.style.cursor !== cur) canvasRef.current.style.cursor = cur;
      redraw();
      return;
    }

    if (drag.mode === 'erase') { eraseAt(p.x, p.y); redraw(); return; }

    if (drag.mode === 'draw') {
      const st = drag.stroke;
      const last = st.points[st.points.length - 1];
      if (['line', 'arrow', 'rect', 'rect-round', 'ellipse'].includes(st.tool)) {
        if (Math.hypot(p.x - last[0], p.y - last[1]) > 2) st.points[1] = [p.x, p.y];
      } else if (Math.hypot(p.x - last[0], p.y - last[1]) > 2) {
        st.points.push([p.x, p.y]);
      }
      redraw();
      return;
    }

    if (!s.playing) {
      if (drag.mode === 'move') {
        const dx0 = p.x - drag.sp.x;
        const dy0 = p.y - drag.sp.y;
        // snap the element center to the canvas center lines
        guideRef.current = { v: false, h: false };
        const snapX = Math.abs(drag.hit.cx + dx0 - W / 2) < SNAP_PX ? W / 2 - drag.hit.cx : dx0;
        const snapY = Math.abs(drag.hit.cy + dy0 - H / 2) < SNAP_PX ? H / 2 - drag.hit.cy : dy0;
        if (snapX !== dx0) guideRef.current.v = true;
        if (snapY !== dy0) guideRef.current.h = true;
        const h = drag.hit;
        if (h.kind === 'text') {
          commit([{ type: 'set_text_style', clipId: h.clip.id, patch: { x: clamp((drag.ox * W + snapX) / W, 0, 1), y: clamp((drag.oy * H + snapY) / H, 0, 1) } }], 'Move text', `${h.clip.id}:move`);
        } else {
          commit([{ type: 'set_transform', clipId: h.clip.id, patch: { x: Math.round(drag.ox + snapX), y: Math.round(drag.oy + snapY) } }], 'Move', `${h.clip.id}:move`);
        }
      } else if (drag.mode === 'resize') {
        const h = drag.hit;
        const { lx, ly } = localPoint(h, p.x, p.y);
        const r = clamp((Math.abs(lx) / Math.max(1, drag.hw0) + Math.abs(ly) / Math.max(1, drag.hh0)) / 2, 0.05, 40);
        if (h.kind === 'text') {
          commit([{ type: 'set_text_style', clipId: h.clip.id, patch: { fontSize: clamp(drag.baseFontSize * r, 0.008, 0.35) } }], 'Resize text', `${h.clip.id}:resize`);
        } else {
          commit([{ type: 'set_transform', clipId: h.clip.id, patch: { scale: clamp(drag.baseScale * r, 0.05, 40) } }], 'Resize', `${h.clip.id}:resize`);
        }
      } else if (drag.mode === 'rotate') {
        const a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
        let deg = drag.rot0 + ((a - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        commit([{ type: 'set_transform', clipId: drag.hit.clip.id, patch: { rotation: Math.round(deg * 10) / 10 } }], 'Rotate', `${drag.hit.clip.id}:rotate`);
      }
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    guideRef.current = { v: false, h: false };
    if (drag?.mode === 'draw') {
      const st = drag.stroke;
      const [a, b] = [st.points[0], st.points[st.points.length - 1]];
      const enough = ['line', 'arrow', 'rect', 'rect-round', 'ellipse'].includes(st.tool)
        ? Math.hypot(b[0] - a[0], b[1] - a[1]) > 4
        : st.points.length > 1 || st.tool === 'brush';
      const s = useStore.getState();
      if (enough) commit([{ type: 'add_drawing', start: s.playhead, duration: 3, strokes: [st] }], `Draw ${st.tool}`);
    }
    redraw();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = useStore.getState();
    if (!measureRef.current) measureRef.current = document.createElement('canvas').getContext('2d');
    const p = toProject(e);
    const hits = hitList(s.project, s.playhead, s.pool, measureRef.current!);
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (h.kind !== 'text' || !inRect(h, p.x, p.y)) continue;
      const clip = h.clip;
      const fontSize = layoutCaption(measureRef.current!, clip.text!.text, clip.text!.style, W, H, s.playhead - clip.start, clip.text!.words).fontSize;
      setEditing({
        clipId: clip.id,
        value: clip.text!.text,
        x: h.cx * scale, y: h.cy * scale,
        w: Math.max(120, h.hw * 2 * scale),
        h: Math.max(28, h.hh * 2 * scale),
        fontSize: Math.max(10, fontSize * scale),
      });
      return;
    }
  };

  const finishEditing = (save: boolean) => {
    if (!editing) return;
    const cur = useStore.getState().project.clips.find((c) => c.id === editing.clipId);
    if (save && cur?.text && cur.text.text !== editing.value) {
      commit([{ type: 'set_text', clipId: editing.clipId, text: editing.value }], 'Edit text');
    }
    setEditing(null);
  };

  if (playing && !editing) return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0 }} />;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        style={{ cursor: draw.tool === 'select' ? 'default' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      {editing && (
        <textarea
          autoFocus
          className="absolute z-20 bg-ink-950/75 border border-signal rounded-md text-center text-paper outline-none resize-none p-1"
          style={{ left: editing.x - editing.w / 2, top: editing.y - editing.h / 2, width: editing.w, height: Math.max(30, editing.h), fontSize: editing.fontSize, lineHeight: 1.2, fontFamily: 'inherit' }}
          value={editing.value}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onBlur={() => finishEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); finishEditing(false); }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEditing(true); }
          }}
        />
      )}
    </>
  );
}
