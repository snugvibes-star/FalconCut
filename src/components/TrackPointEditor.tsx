/** Frame-normalized single-point seed editor. The box + center are stored as a
 * TrackSeed (source-time keyed), so the same geometry drives NCC tracking in
 * engine/tracking.ts. Design tokens match MaskPolygonEditor. */
import { useRef, useState } from 'react';
import type { TrackSeed } from '../../engine';

type Handle = 'center' | 'tl' | 'tr' | 'br' | 'bl';

export function TrackPointEditor({ thumbnail, seed, onChange, onCommit }: {
  thumbnail: string | null;
  seed: TrackSeed;
  onChange: (s: TrackSeed) => void;
  onCommit: (s: TrackSeed) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Handle | null>(null);
  const clamped = (v: number) => Math.max(0, Math.min(1, v));
  const at = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0.5, y: 0.5 };
    return { x: clamped((e.clientX - r.left) / r.width), y: clamped((e.clientY - r.top) / r.height) };
  };
  const x0 = clamped(seed.x - seed.w / 2), x1 = clamped(seed.x + seed.w / 2);
  const y0 = clamped(seed.y - seed.h / 2), y1 = clamped(seed.y + seed.h / 2);

  const move = (handle: Handle, p: { x: number; y: number }): TrackSeed => {
    if (handle === 'center') return { ...seed, x: p.x, y: p.y };
    // Corner handles resize the box; the opposite corner stays put.
    const ax = handle === 'tl' || handle === 'bl' ? x1 : x0;
    const ay = handle === 'tl' || handle === 'tr' ? y1 : y0;
    const nx0 = Math.min(ax, p.x), nx1 = Math.max(ax, p.x);
    const ny0 = Math.min(ay, p.y), ny1 = Math.max(ay, p.y);
    return {
      ...seed,
      x: (nx0 + nx1) / 2, y: (ny0 + ny1) / 2,
      w: Math.max(0.02, nx1 - nx0), h: Math.max(0.02, ny1 - ny0),
    };
  };
  const commit = () => { if (drag !== null) { setDrag(null); onCommit(seed); } };

  return (
    <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
      aria-label="Point tracking seed: drag the center point or a box corner"
      className="w-full h-28 rounded-md border border-line bg-ink-950 touch-none select-none"
      onPointerMove={(e) => { if (drag !== null) onChange(move(drag, at(e))); }}
      onPointerUp={commit} onPointerLeave={commit} onPointerCancel={commit}>
      {thumbnail && <image href={thumbnail} x="0" y="0" width="100" height="100" preserveAspectRatio="none" opacity="0.55" />}
      {[25, 50, 75].map((v) => <g key={v}>
        <line x1={v} y1="0" x2={v} y2="100" stroke="#2A2A30" strokeWidth="0.4" />
        <line x1="0" y1={v} x2="100" y2={v} stroke="#2A2A30" strokeWidth="0.4" />
      </g>)}
      <rect x={x0 * 100} y={y0 * 100} width={(x1 - x0) * 100} height={(y1 - y0) * 100}
        fill="rgba(76,154,255,0.12)" stroke="#4C9AFF" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <line x1={(seed.x - 0.025) * 100} y1={seed.y * 100} x2={(seed.x + 0.025) * 100} y2={seed.y * 100}
        stroke="#C6F24E" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <line x1={seed.x * 100} y1={(seed.y - 0.025) * 100} x2={seed.x * 100} y2={(seed.y + 0.025) * 100}
        stroke="#C6F24E" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <circle cx={seed.x * 100} cy={seed.y * 100} r="2.2"
        fill={drag === 'center' ? '#EAEAEA' : '#C6F24E'} stroke="#07090F" strokeWidth="0.6"
        className="cursor-grab"
        onPointerDown={(e) => { e.preventDefault(); setDrag('center'); try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic */ } }} />
      {([['tl', x0, y0], ['tr', x1, y0], ['br', x1, y1], ['bl', x0, y1]] as const).map(([h, x, y]) => (
        <rect key={h} x={x * 100 - 1.4} y={y * 100 - 1.4} width="2.8" height="2.8"
          fill={drag === h ? '#EAEAEA' : '#4C9AFF'} stroke="#07090F" strokeWidth="0.5"
          className="cursor-nwse-resize"
          onPointerDown={(e) => { e.preventDefault(); setDrag(h); try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic */ } }} />
      ))}
    </svg>
  );
}
