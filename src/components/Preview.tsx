import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, Grid3x3, Maximize2, Minimize2, Theater, Repeat, PenLine, Camera } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { renderFrame, drawSafeZones, projectDuration, activeClips, getMedia, type Action } from '../../engine';
import { toggleMarkerLoop } from '../features/zoneLoop';
import { projectPNG } from '../../exporter/artifacts';
import { getBlob } from '../state/persistence';
import { OverlayEditor } from './preview/OverlayEditor';
import { DrawBar } from './preview/DrawBar';

function timecode(t: number, fps: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * fps);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

const ZOOM_STEPS: { label: string; value: 'fit' | number }[] = [
  { label: 'Fit', value: 'fit' },
  { label: '25%', value: 0.25 },
  { label: '50%', value: 0.5 },
  { label: '100%', value: 1 },
  { label: '200%', value: 2 },
];

export function Preview() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const frameTick = useStore((s) => s.frameTick);
  const pool = useStore((s) => s.pool);
  const focusMode = useUI((s) => s.focusMode);
  const railVisible = useUI((s) => s.railVisible);
  const setRailVisible = useUI((s) => s.setRailVisible);
  const zoneLoop = useStore((s) => !!s.zone?.loop);
  const zoom = useUI((s) => s.previewZoom);
  const toggleFocusMode = useUI((s) => s.toggleFocusMode);
  const setZoom = useUI((s) => s.setPreviewZoom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [safe, setSafe] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [full, setFull] = useState(false);
  const [capturing, setCapturing] = useState(false);

  /** Freeze frame: render the EXACT frame at the playhead (full resolution,
   * same renderFrame as export), import it as an image and drop a 2s clip at
   * the playhead. Two real commits: import + insert (both undoable). */
  const freezeFrame = async () => {
    const s = useStore.getState();
    s.pause();
    setCapturing(true);
    try {
      const blob = await projectPNG(s.project, s.playhead, getBlob);
      const name = `freeze-${s.playhead.toFixed(2)}s.png`;
      const { ids } = await s.importFiles([new File([blob], name, { type: 'image/png' })], { addToTimeline: false });
      const st = useStore.getState();
      const mediaId = ids[0];
      if (!mediaId) throw new Error('Could not import the captured frame.');
      const trackId = st.project.tracks.find((t) => t.kind === 'video')?.id;
      if (!trackId) throw new Error('No video track to place the freeze frame on.');
      // Insert at the playhead like a real NLE: if a clip spans the playhead,
      // split it there first, then ripple-insert the still so following clips
      // shift right instead of the still being clamped to a far-away gap.
      const spanning = st.project.clips.find((c) => c.trackId === trackId && c.kind === 'media' && c.start < s.playhead - 1e-6 && c.start + c.duration > s.playhead + 1e-6);
      const actions: Action[] = spanning ? [{ type: 'split_clip', clipId: spanning.id, time: s.playhead }] : [];
      actions.push({ type: 'add_clip', clip: { trackId, mediaId, start: s.playhead, duration: 2, inPoint: 0, name: 'Freeze frame' }, ripple: true });
      st.commit(actions, 'Freeze frame');
      useUI.getState().toast('Freeze frame added — 2s at the playhead (trim as needed)', 'success');
    } catch (e) {
      useUI.getState().toast((e as Error).message, 'error');
    } finally {
      setCapturing(false);
    }
  };

  const { width, height, fps } = project.settings;
  const dur = projectDuration(project);
  const hasContent = project.clips.length > 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fullscreen API — real browser fullscreen on the preview pane.
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  // Escape exits theater mode too (fullscreen has its own Esc handling).
  // Esc priority is layered: dialogs > context menu > selection clear are
  // handled elsewhere; theater mode only toggles when nothing else consumed Esc.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = useUI.getState();
      if (Object.values(ui.dialogs).some(Boolean)) return;
      if (document.querySelector('[data-cutflow-menu]')) return;
      if (useStore.getState().selection.length) return; // global handler clears selection first
      useUI.getState().toggleFocusMode();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const p = rootRef.current?.requestFullscreen?.();
    if (!p) { useUI.getState().toast('Fullscreen is not available in this browser', 'error'); return; }
    p.catch(() => useUI.getState().toast('Fullscreen was blocked by the browser', 'error'));
    // Some embedded browsers never settle the promise — verify shortly after.
    setTimeout(() => {
      if (!document.fullscreenElement) useUI.getState().toast('Fullscreen was blocked by the browser', 'error');
    }, 450);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderFrame(project, playhead, ctx, pool);
    if (safe) drawSafeZones(ctx, project);
  }, [project, playhead, frameTick, pool, width, height, safe]);

  // keep video elements aligned to the paused playhead
  useEffect(() => {
    if (playing) return;
    const active = activeClips(project, playhead).map((c) => ({ clip: c, asset: getMedia(project, c.mediaId)! })).filter((x) => x.asset);
    pool.syncPlayback(active, playhead, false);
  }, [playhead, project, playing, pool]);

  // Sizing: 'fit' scales the frame inside the pane; a numeric zoom is a fixed
  // multiplier of the project resolution (pane scrolls when it overflows).
  const fitScale = box.w && box.h ? Math.min((box.w - 24) / width, (box.h - 24) / height) : 0;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const dispW = Math.max(0, Math.floor(width * scale));
  const dispH = Math.max(0, Math.floor(height * scale));
  const scrollable = zoom !== 'fit' && (dispW > box.w || dispH > box.h);

  const step = (dir: number) => {
    const s = useStore.getState();
    s.pause();
    s.setPlayhead(s.playhead + dir / (fps || 30));
  };
  const jump = (dir: number) => {
    const s = useStore.getState();
    s.pause();
    s.setPlayhead(dir < 0 ? 0 : projectDuration(s.project));
  };

  /** Loop the section between the nearest markers around the playhead (or the
   * whole timeline when there are none). Shift+M toggles it too. Real loop:
   * backed by the store playback zone (stops/loops at the edges). */
  const toggleLoop = toggleMarkerLoop;

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col bg-ink-950">
      <div
        ref={wrapRef}
        className={`flex-1 min-h-0 flex items-center justify-center relative overflow-hidden p-3 cf-aurora ${scrollable ? 'overflow-auto' : ''}`}
      >
        {hasContent ? (
          <div className={`relative ${scrollable ? 'm-auto' : ''}`}>
            {/* Hidden rail: tiny dock icon OUTSIDE the video box, in the side gutter. */}
            {!railVisible && (
              <button
                className="absolute z-10 flex items-center justify-center w-6 h-6 rounded-md bg-ink-900/90 border border-line text-paper-dim hover:text-paper hover:border-signal/50 shadow-panel"
                style={{ right: -32, top: '50%', transform: 'translateY(-50%)' }}
                onClick={() => setRailVisible(true)}
                title="Show draw tools (hidden — nothing overlays the video)"
              >
                <PenLine size={13} />
              </button>
            )}
            <div
              className="relative shadow-panel rounded-md overflow-hidden ring-1 ring-line shrink-0"
              style={{ width: dispW, height: dispH }}
            >
              <canvas ref={canvasRef} className="block w-full h-full" style={{ imageRendering: 'auto' }} />
              <OverlayEditor scale={scale} />
              <DrawBar />
            </div>
          </div>
        ) : (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ink-800 border border-line flex items-center justify-center">
              <Grid3x3 size={26} className="text-paper-faint" />
            </div>
            <h2 className="font-display text-lg font-semibold mb-1">Your canvas is empty</h2>
            <p className="text-sm text-paper-dim">Import a video, audio or image from the left panel to begin. Everything stays on this device.</p>
            <div className="mt-5 flex flex-col items-center gap-2">
              <button className="btn-solid text-xs" onClick={() => { void useStore.getState().loadShowcaseDemo(); }}>
                Load demo — real footage, cut · reverse · speed · titles
              </button>
              <button className="btn-ghost text-[11px]" onClick={() => { void useStore.getState().loadDemoTimeline(); }}>
                or the minimal demo (sample video, music, title)
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-12 shrink-0 flex items-center gap-2 px-3 border-t border-line bg-ink-900 cf-hscroll">
        <div className="flex items-center gap-0.5">
          <button className="icon-btn" onClick={() => jump(-1)} title="Jump to start (Home)"><ChevronsLeft size={16} /></button>
          <button className="icon-btn" onClick={() => step(-1)} title="Previous frame (Shift+←)"><SkipBack size={16} /></button>
          <button className="w-9 h-9 rounded-full bg-signal text-ink-950 flex items-center justify-center hover:bg-signal-dim transition-colors" onClick={() => useStore.getState().togglePlay()} title="Play / Pause (Space)">
            {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
          </button>
          <button className="icon-btn" onClick={() => step(1)} title="Next frame (Shift+→)"><SkipForward size={16} /></button>
          <button className="icon-btn" onClick={() => jump(1)} title="Jump to end (End)"><ChevronsRight size={16} /></button>
        </div>
        <div className="font-mono text-xs text-paper-dim ml-2 tabular-nums">
          <span className="text-paper">{timecode(playhead, fps || 30)}</span>
          <span className="text-paper-faint"> / {timecode(dur, fps || 30)}</span>
        </div>
        <div className="flex-1" />
        <select
          className="field py-0.5 text-[11px] w-auto cursor-pointer"
          value={zoom === 'fit' ? 'fit' : String(zoom)}
          onChange={(e) => setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}
          title="Preview zoom — Fit scales to the pane; fixed zooms scroll"
        >
          {ZOOM_STEPS.map((z) => <option key={z.label} value={String(z.value)}>{z.label}</option>)}
        </select>
        <button
          className={`icon-btn ${zoneLoop ? 'text-signal' : ''}`}
          onClick={toggleLoop}
          title="Loop between markers (Shift+M) — playback loops the section"
        >
          <Repeat size={16} />
        </button>
        <button className={`icon-btn ${safe ? 'text-signal' : ''}`} onClick={() => setSafe((v) => !v)} title="Toggle caption safe zones"><Grid3x3 size={16} /></button>
        <button
          className="icon-btn"
          onClick={() => void freezeFrame()}
          disabled={capturing || !hasContent}
          title={capturing ? 'Capturing frame…' : 'Freeze frame — insert the current frame as a 2s still at the playhead'}
        >
          <Camera size={16} />
        </button>
        <button
          className={`icon-btn ${focusMode ? 'text-signal' : ''}`}
          onClick={toggleFocusMode}
          title="Theater mode — large preview, hide side panels (Esc exits)"
        >
          <Theater size={16} />
        </button>
        <button className="icon-btn" onClick={toggleFullscreen} title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen preview (F)'}>
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>
    </div>
  );
}
