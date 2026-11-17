/**
 * Drawing layer rendering. A drawing clip holds vector strokes in PROJECT
 * pixel coordinates; the renderer rasterizes them onto a transparent layer
 * (bbox-sized) once per stroke-data change and composites that layer with the
 * clip's transform — so drawings are independent, editable overlay layers,
 * NOT burned into the video. Preview and export both go through renderFrame.
 *
 * The eraser tool erases pixels WITHIN the same drawing clip only (it is a
 * layer-local eraser, like a design-canvas eraser), implemented with
 * destination-out on the rasterized layer.
 */
import type { DrawingStroke } from './types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Padding around stroke bounds so thick strokes / arrow heads / sticker
 * glyphs are not clipped by the rasterized layer. */
const PAD = 24;

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function strokeBounds(strokes: DrawingStroke[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number, r: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x - r); minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r);
  };
  for (const s of strokes) {
    const r = s.tool === 'sticker' ? s.size * 0.75 : s.size / 2 + 2;
    for (const [x, y] of s.points) add(x, y, r);
    if (s.tool === 'sticker' && s.points.length) add(s.points[0][0], s.points[0][1], s.size * 0.85);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

export function boundsSize(b: Bounds): { w: number; h: number } {
  return { w: Math.max(2, Math.ceil(b.maxX - b.minX)), h: Math.max(2, Math.ceil(b.maxY - b.minY)) };
}

/** Draw strokes onto ctx. `dx/dy` shifts project coords into the layer's
 * local space (pass the layer origin negated). */
export function drawStrokes(ctx: Ctx2D, strokes: DrawingStroke[], dx = 0, dy = 0) {
  for (const s of strokes) {
    const pts = s.points.map(([x, y]) => [x + dx, y + dy] as [number, number]);
    if (!pts.length) continue;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
    if (s.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(4, s.size * 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      pathFreehand(ctx, pts, true);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    switch (s.tool) {
      case 'sticker': {
        ctx.fillStyle = s.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.max(8, s.size)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
        ctx.fillText(s.char || s.color, pts[0][0], pts[0][1]);
        break;
      }
      case 'line':
      case 'arrow': {
        if (pts.length < 2) break;
        const [a, b] = [pts[0], pts[pts.length - 1]];
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        if (s.tool === 'arrow') drawArrowHead(ctx, a, b, Math.max(1, s.size) * 4, s.color, s.fill);
        break;
      }
      case 'rect':
      case 'rect-round':
      case 'ellipse': {
        if (pts.length < 2) break;
        const x = Math.min(pts[0][0], pts[pts.length - 1][0]);
        const y = Math.min(pts[0][1], pts[pts.length - 1][1]);
        const w = Math.abs(pts[pts.length - 1][0] - pts[0][0]);
        const h = Math.abs(pts[pts.length - 1][1] - pts[0][1]);
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size);
        ctx.fillStyle = s.fill && s.fill !== 'none' ? s.fill : 'transparent';
        ctx.beginPath();
        if (s.tool === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        else roundRectPath(ctx, x, y, w, h, s.tool === 'rect-round' ? Math.min(s.radius ?? 16, Math.min(w, h) / 2) : 0);
        if (s.fill && s.fill !== 'none') ctx.fill();
        ctx.stroke();
        break;
      }
      case 'polygon': {
        if (pts.length < 2) break;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size);
        ctx.fillStyle = s.fill && s.fill !== 'none' ? s.fill : 'transparent';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        if (s.fill && s.fill !== 'none') ctx.fill();
        ctx.stroke();
        break;
      }
      case 'highlighter': {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(6, s.size * 3);
        ctx.lineCap = 'square';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity)) * 0.45;
        pathFreehand(ctx, pts, false);
        ctx.stroke();
        break;
      }
      case 'pen': {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'miter';
        pathFreehand(ctx, pts, false);
        ctx.stroke();
        break;
      }
      case 'brush':
      default: {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = Math.max(1, s.size);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        pathFreehand(ctx, pts, true);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }
}

function pathFreehand(ctx: Ctx2D, pts: [number, number][], smooth: boolean) {
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0][0], pts[0][1], Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (!smooth || pts.length === 2) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    return;
  }
  // Quadratic smoothing through segment midpoints (classic freehand curve).
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function drawArrowHead(ctx: Ctx2D, from: [number, number], to: [number, number], headLen: number, color: string, fill?: string) {
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wing = Math.PI / 7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - headLen * Math.cos(ang - wing), to[1] - headLen * Math.sin(ang - wing));
  ctx.lineTo(to[0] - headLen * Math.cos(ang + wing), to[1] - headLen * Math.sin(ang + wing));
  ctx.closePath();
  ctx.fill();
  void fill;
  ctx.restore();
}

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  if (r > 0 && typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return; }
  const rr = Math.min(r, Math.min(w, h) / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
