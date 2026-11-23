/** Frame-normalized polygon point editor for clip masks. Points are stored on
 * Clip.mask, so the same geometry drives preview and export through render.ts. */
import { useRef, useState } from 'react';

export interface MaskPoint { x: number; y: number }

export function MaskPolygonEditor({ points, onChange, onCommit }: {
  points: MaskPoint[];
  onChange: (p: MaskPoint[]) => void;
  onCommit: (p: MaskPoint[]) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const local = points.length >= 3 ? points : [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 },
  ];
  const at = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const commit = () => { if (drag !== null) { setDrag(null); onCommit(local); } };
  return (
    <div className="space-y-1">
      <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
        aria-label="Polygon mask point editor"
        className="w-full h-28 rounded-md border border-line bg-ink-950 touch-none select-none"
        onPointerMove={(e) => {
          if (drag === null) return;
          const p = at(e);
          onChange(local.map((pt, i) => i === drag ? p : pt));
        }}
        onPointerUp={commit} onPointerLeave={commit} onPointerCancel={commit}>
        {[25, 50, 75].map((v) => <g key={v}>
          <line x1={v} y1="0" x2={v} y2="100" stroke="#2A2A30" strokeWidth="0.4" />
          <line x1="0" y1={v} x2="100" y2={v} stroke="#2A2A30" strokeWidth="0.4" />
        </g>)}
        <polygon points={local.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
          fill="rgba(76,154,255,0.12)" stroke="#4C9AFF" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        {local.map((p, i) => (
          <circle key={i} cx={p.x * 100} cy={p.y * 100} r="2.6"
            fill={drag === i ? '#EAEAEA' : '#4C9AFF'} stroke="#07090F" strokeWidth="0.6" className="cursor-grab"
            onPointerDown={(e) => { e.preventDefault(); setDrag(i); try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic */ } }} />
        ))}
      </svg>
      <div className="flex gap-1.5">
        <button className="btn-ghost text-[11px] flex-1 justify-center"
          onClick={() => { const p = [...local, { x: 0.5, y: 0.5 }]; onChange(p); onCommit(p); }}>
          Add point
        </button>
        <button className="btn-ghost text-[11px] flex-1 justify-center" disabled={local.length <= 3}
          onClick={() => { const p = local.slice(0, -1); onChange(p); onCommit(p); }}>
          Remove last
        </button>
      </div>
    </div>
  );
}
