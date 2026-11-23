/**
 * COLOR workspace — DaVinci-Resolve-style grading surface.
 * Layout: top strip / [filmstrip | live preview + transport | grading panel] / scopes strip.
 * Every control maps to real engine actions (add_effect / set_effect / remove_effect
 * or the apply_color_preset tool). Scopes are computed from the live canvas pixels.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Loader2 } from 'lucide-react';
import { useStore } from '../../state/store';
import { renderFrame, projectDuration, activeClips, getMedia, type Clip } from '../../../engine';
import { GradePanel, matchPreset } from './GradePanel';
import { Scopes } from './Scopes';

function timecode(t: number, fps: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * fps);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function ColorPage() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const frameTick = useStore((s) => s.frameTick);
  const pool = useStore((s) => s.pool);
  const selection = useStore((s) => s.selection);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const thumbsRef = useRef<Record<string, string>>({});

  const { width, height, fps } = project.settings;
  const dur = projectDuration(project);

  const mediaClips = useMemo(
    () => project.clips.filter((c) => c.kind === 'media').sort((a, b) => a.start - b.start),
    [project],
  );

  /** Grading target: selected clip → clip under playhead → null. */
  const target: Clip | null = useMemo(() => {
    const sel = selection
      .map((id) => project.clips.find((c) => c.id === id))
      .find((c) => c && c.kind === 'media');
    if (sel) return sel;
    const under = activeClips(project, playhead).filter((c) => c.kind === 'media');
    return under[0] ?? null;
  }, [project, selection, playhead]);

  /* big preview — same render path as Preview.tsx */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderFrame(project, playhead, ctx, pool);
  }, [project, playhead, frameTick, pool, width, height]);

  /* filmstrip thumbnails (skip while playing — thumbnail() seeks shared video elements) */
  useEffect(() => {
    if (playing) return;
    let cancelled = false;
    void (async () => {
      for (const c of mediaClips) {
        if (cancelled) return;
        const key = `${c.id}|${Math.round(c.inPoint)}|${Math.round(c.duration)}`;
        if (thumbsRef.current[key]) continue;
        const asset = getMedia(project, c.mediaId);
        if (!asset) continue;
        const url = await pool.thumbnail(asset.id, c.inPoint + (c.duration * c.speed) / 2, 100);
        if (cancelled) return;
        if (url) {
          thumbsRef.current[key] = url;
          setThumbs({ ...thumbsRef.current });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mediaClips, playing, pool, project]);

  const scale = box.w && box.h ? Math.min((box.w - 24) / width, (box.h - 24) / height) : 0;
  const dispW = Math.max(0, Math.floor(width * scale));
  const dispH = Math.max(0, Math.floor(height * scale));

  const step = (dir: number) => {
    const s = useStore.getState();
    s.pause();
    s.setPlayhead(s.playhead + dir / (fps || 30));
  };

  const seekClip = (c: Clip) => {
    const s = useStore.getState();
    s.pause();
    s.select([c.id]);
    s.setPlayhead(c.start + c.duration / 2);
  };

  const applyAll = async () => {
    const fx = target?.effects.find((e) => e.type === 'color');
    const name = matchPreset(fx?.params) ?? 'natural';
    setBusy(true);
    try {
      await useStore.getState().applyTool('apply_color_preset', { name });
    } finally {
      setBusy(false);
    }
  };

  const autoEnhance = async () => {
    setBusy(true);
    try {
      await useStore.getState().applyTool('apply_color_preset', { name: 'natural' });
    } finally {
      setBusy(false);
    }
  };

  const tc = timecode(playhead, fps || 30);

  return (
    <div className="h-full flex flex-col bg-ink-950">
      {/* top strip: wraps on phones so both grade actions stay reachable */}
      <div className="min-h-9 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 sm:px-3 border-b border-line bg-ink-900">
        <span className="font-display text-xs tracking-widest text-paper-dim font-semibold">COLOR</span>
        <div className="hidden sm:block h-4 w-px bg-line" />
        {target ? (
          <span className="text-xs truncate min-w-0">
            <span className="text-paper">{target.name}</span>
            <span className="text-paper-faint"> · {tc}</span>
          </span>
        ) : (
          <span className="text-xs text-paper-faint truncate">No visual clip at playhead</span>
        )}
        <div className="flex-1" />
        <button
          className="btn-ghost text-xs px-2.5 py-1 disabled:opacity-40"
          disabled={busy || mediaClips.length === 0}
          onClick={() => void applyAll()}
          title="Apply the current look to every media clip"
        >
          Apply preset to all clips
        </button>
        <button
          className="btn-signal text-xs px-2.5 py-1 disabled:opacity-40"
          disabled={busy || mediaClips.length === 0}
          onClick={() => void autoEnhance()}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Auto enhance'}
        </button>
      </div>

      {/* main row — stacks vertically on narrow screens so the preview never
          collapses to 0px (filmstrip + w-80 panel exceed a 360px viewport) */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* left filmstrip: horizontal strip on mobile, vertical column on desktop */}
        <div className="cf-color-filmstrip h-16 w-full shrink-0 md:h-auto md:w-14 border-b md:border-b-0 md:border-r border-line md:overflow-y-auto overflow-x-auto bg-ink-900 py-1.5 px-1 flex md:flex-col md:space-y-1.5 space-x-1.5 md:space-x-0 items-start">
          {mediaClips.map((c) => {
            const key = `${c.id}|${Math.round(c.inPoint)}|${Math.round(c.duration)}`;
            const thumb = thumbs[key];
            const active = target?.id === c.id;
            const graded = c.effects.some((e) => e.type === 'color');
            return (
              <button
                key={c.id}
                onClick={() => seekClip(c)}
                title={`${c.name} · ${timecode(c.start, fps || 30)}`}
                className={`relative block w-10 md:w-full shrink-0 rounded-md overflow-hidden border transition-colors ${
                  active ? 'border-signal ring-1 ring-signal/50' : 'border-line hover:border-line-bright'
                }`}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="block w-full" draggable={false} />
                ) : (
                  <div className="h-12 bg-ink-800 animate-pulse-dot" />
                )}
                {graded && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-signal" title="Has color grade" />
                )}
              </button>
            );
          })}
          {mediaClips.length === 0 && (
            <div className="text-[10px] text-paper-faint text-center px-1 pt-3 leading-relaxed">No clips</div>
          )}
        </div>

        {/* center: preview + transport */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-ink-950">
          <div ref={wrapRef} className="flex-1 min-h-0 flex items-center justify-center relative overflow-hidden p-3">
            {mediaClips.length > 0 ? (
              <div className="relative shadow-panel rounded-md overflow-hidden ring-1 ring-line" style={{ width: dispW, height: dispH }}>
                <canvas ref={canvasRef} className="block w-full h-full" />
              </div>
            ) : (
              <p className="text-sm text-paper-faint">No visual clips to grade</p>
            )}
          </div>

          <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-t border-line bg-ink-900 cf-hscroll">
            <button className="icon-btn" onClick={() => step(-1)} title="Previous frame"><SkipBack size={16} /></button>
            <button
              className="w-8 h-8 rounded-full bg-signal text-ink-950 flex items-center justify-center hover:bg-signal-dim transition-colors"
              onClick={() => useStore.getState().togglePlay()}
              title="Play / Pause"
            >
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            <button className="icon-btn" onClick={() => step(1)} title="Next frame"><SkipForward size={16} /></button>
            <div className="font-mono text-xs text-paper-dim ml-2 tabular-nums">
              <span className="text-paper">{tc}</span>
              <span className="text-paper-faint"> / {timecode(dur, fps || 30)}</span>
            </div>
            <div className="flex-1" />
            <span className="chip bg-ink-800 text-paper-faint">{mediaClips.length} clip{mediaClips.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {/* right: grading panel — full-width below the preview on mobile,
            fixed side column on desktop */}
        <div className="cf-color-panel w-full shrink-0 md:w-80 max-h-[45%] md:max-h-none border-t md:border-t-0 md:border-l border-line overflow-y-auto bg-ink-900">
          <GradePanel clip={target} />
        </div>
      </div>

      {/* bottom: scopes — taller strip on mobile so it stays readable */}
      <div className="cf-color-scopes h-28 sm:h-40 shrink-0 border-t border-line bg-ink-950">
        <Scopes getSource={() => canvasRef.current} />
      </div>
    </div>
  );
}
