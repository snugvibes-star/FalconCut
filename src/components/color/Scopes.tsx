/**
 * Real video scopes (histogram / luma waveform / vectorscope) computed from the
 * live preview canvas pixels — no fake data. Samples the source at ~1/4
 * resolution every 500ms and renders all three scopes side by side.
 */
import { useEffect, useRef, useState } from 'react';

const BG = '#0a0d14';
const BORDER = '#212a3e';
const LABEL = '#5e6b84';
const LABEL_H = 15;

interface Props {
  /** Returns the current (already graded) preview canvas, or null when empty. */
  getSource: () => HTMLCanvasElement | null;
}

export function Scopes({ getSource }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(getSource);
  sourceRef.current = getSource;
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || size.w < 24 || size.h < 24) return;
      drawScopes(canvas, size.w, size.h, sourceRef.current());
    };
    draw();
    const id = window.setInterval(draw, 500);
    return () => window.clearInterval(id);
  }, [size.w, size.h]);

  return (
    <div ref={wrapRef} className="w-full h-full min-h-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

/* ------------------------------------------------------------------ */

let scratch: HTMLCanvasElement | null = null;

/** Downsample the source to 1/4 res and read its pixels. Null when empty/tainted. */
function sampleSource(src: HTMLCanvasElement): ImageData | null {
  try {
    const sw = Math.max(2, Math.round(src.width / 4));
    const sh = Math.max(2, Math.round(src.height / 4));
    if (!scratch) scratch = document.createElement('canvas');
    if (scratch.width !== sw) scratch.width = sw;
    if (scratch.height !== sh) scratch.height = sh;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) return null;
    sctx.clearRect(0, 0, sw, sh);
    sctx.drawImage(src, 0, 0, sw, sh);
    return sctx.getImageData(0, 0, sw, sh);
  } catch {
    return null;
  }
}

function drawScopes(canvas: HTMLCanvasElement, W: number, H: number, source: HTMLCanvasElement | null) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(W * dpr);
  const ph = Math.round(H * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pad = 8;
  const gap = 10;
  const panelW = (W - pad * 2 - gap * 2) / 3;
  const top = 5;
  const panelH = H - LABEL_H - top - 4;
  const panels = [pad, pad + panelW + gap, pad + (panelW + gap) * 2];

  for (const x of panels) {
    ctx.fillStyle = BG;
    ctx.fillRect(x, top, panelW, panelH);
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, top + 0.5, panelW - 1, panelH - 1);
  }

  ctx.fillStyle = LABEL;
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const labels = ['HISTOGRAM', 'WAVEFORM', 'VECTOR'];
  labels.forEach((l, i) => ctx.fillText(l, panels[i] + panelW / 2, H - 4));

  if (panelW < 20 || panelH < 20) return;

  const data = source && source.width > 0 && source.height > 0 ? sampleSource(source) : null;
  if (!data) {
    ctx.fillStyle = LABEL;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('No signal', W / 2, top + panelH / 2);
    ctx.textBaseline = 'alphabetic';
    return;
  }

  drawHistogram(ctx, data, panels[0], top, panelW, panelH);
  drawWaveform(ctx, data, panels[1], top, panelW, panelH);
  drawVectorscope(ctx, data, panels[2], top, panelW, panelH);
}

/* ------------------------------------------------------------------ */

function drawHistogram(ctx: CanvasRenderingContext2D, data: ImageData, x: number, y: number, w: number, h: number) {
  const BINS = 64;
  const hr = new Float64Array(BINS);
  const hg = new Float64Array(BINS);
  const hb = new Float64Array(BINS);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    hr[d[i] >> 2]++;
    hg[d[i + 1] >> 2]++;
    hb[d[i + 2] >> 2]++;
  }
  const hmax = Math.max(1, maxOf(hr), maxOf(hg), maxOf(hb));
  const ix = x + 2;
  const iw = w - 4;
  const base = y + h - 2;
  const maxH = h - 8;
  const chans = [hr, hg, hb];
  const colors = ['rgba(255,82,82,0.45)', 'rgba(110,231,120,0.45)', 'rgba(96,148,255,0.45)'];
  for (let c = 0; c < 3; c++) {
    ctx.beginPath();
    ctx.moveTo(ix, base);
    for (let b = 0; b < BINS; b++) {
      const v = Math.log1p(chans[c][b]) / Math.log1p(hmax);
      const px = ix + (b / (BINS - 1)) * iw;
      ctx.lineTo(px, base - v * maxH);
    }
    ctx.lineTo(ix + iw, base);
    ctx.closePath();
    ctx.fillStyle = colors[c];
    ctx.fill();
  }
}

function drawWaveform(ctx: CanvasRenderingContext2D, data: ImageData, x: number, y: number, w: number, h: number) {
  const COLS = 160;
  const ROWS = 64;
  const grid = new Float64Array(COLS * ROWS);
  const d = data.data;
  const sw = data.width;
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const col = Math.min(COLS - 1, Math.floor((px % sw) * COLS / sw));
    const luma = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const row = Math.max(0, Math.min(ROWS - 1, ROWS - 1 - Math.floor(luma / 255 * ROWS)));
    grid[col * ROWS + row]++;
  }
  const gmax = maxOf(grid);
  if (gmax <= 0) return;
  const ix = x + 2;
  const iw = w - 4;
  const base = y + h - 2;
  const cellW = iw / COLS;
  const cellH = (h - 8) / ROWS;
  const wfTop = base - ROWS * cellH;
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const n = grid[col * ROWS + row];
      if (n <= 0) continue;
      const a = Math.min(0.85, 0.08 + Math.log2(1 + n) / Math.log2(1 + gmax) * 0.8);
      ctx.fillStyle = `rgba(155,194,58,${a.toFixed(3)})`;
      ctx.fillRect(ix + col * cellW, wfTop + (ROWS - 1 - row) * cellH, cellW + 0.6, cellH + 0.6);
    }
  }
}

function drawVectorscope(ctx: CanvasRenderingContext2D, data: ImageData, x: number, y: number, w: number, h: number) {
  const VN = 96;
  const grid = new Float64Array(VN * VN);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const cb = (-0.169 * R - 0.331 * G + 0.5 * B + 128) - 128;
    const cr = (0.5 * R - 0.419 * G - 0.081 * B + 128) - 128;
    const gx = Math.max(0, Math.min(VN - 1, Math.round(((cb / 128) + 1) / 2 * (VN - 1))));
    const gy = Math.max(0, Math.min(VN - 1, Math.round(((cr / 128) + 1) / 2 * (VN - 1))));
    grid[gy * VN + gx]++;
  }
  const gmax = maxOf(grid);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const R = Math.min(w, h) / 2 - 8;

  // boundary circle + center cross
  ctx.strokeStyle = 'rgba(56,189,248,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(56,189,248,0.18)';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();

  if (gmax <= 0) return;
  const cell = (R * 2) / (VN - 1);
  for (let gy = 0; gy < VN; gy++) {
    for (let gx = 0; gx < VN; gx++) {
      const n = grid[gy * VN + gx];
      if (n <= 0) continue;
      const a = Math.min(0.75, 0.1 + Math.log2(1 + n) / Math.log2(1 + gmax) * 0.65);
      ctx.fillStyle = `rgba(56,189,248,${a.toFixed(3)})`;
      ctx.fillRect(cx + (gx / (VN - 1)) * 2 * R - R - cell / 2, cy - (gy / (VN - 1)) * 2 * R + R - cell / 2, cell + 0.6, cell + 0.6);
    }
  }
}

function maxOf(a: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i];
  return m;
}
