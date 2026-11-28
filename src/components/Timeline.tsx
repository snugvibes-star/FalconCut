import { useEffect, useMemo, useRef, useState } from 'react';
import { Scissors, Trash2, ZoomIn, ZoomOut, Magnet, Lock, Unlock, Volume2, VolumeX, Eye, EyeOff, Plus, Flag, Maximize, ChevronsRightLeft, Headphones, Focus, ChevronUp, ChevronDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { useDeviceClass } from '../hooks/useDeviceClass';
import { ClipContextMenu, type CtxMenuState } from './ClipContextMenu';
import { resolveFreeStart } from '../features/timelinePlacement';
import { runEditorAction } from '../features/editorActions';
import { buildStyledText, type TextEffect, type TextRole, type TextTransition } from './tabs/textPresets';
import { projectDuration, clipsOnTrack, getMedia, uid, COLOR_PRESETS, TRANSITION_TYPES, type Action, type Clip, type Track, type MediaAsset, type TextData, type EffectType, type Transition } from '../../engine';

const ROW_H = 56; // default track height (per-track overrides live on Track.height)
const RULER_H = 26;
const TRACK_H_MIN = 36;
const TRACK_H_MAX = 160;
/** Sentinel track id for "dropped past the edge — create a new track here". */
const NEW_TRACK_ID = '__falconcut_new_track__';
interface NewTrackDrop { kind: Track['kind']; index: number }

/** Standard color-label palette (matches common NLE label sets). */
const LABEL_COLORS: Record<string, string> = {
  red: '#FB7185',
  amber: '#FBBF24',
  green: '#34D399',
  blue: '#38BDF8',
  purple: '#C084FC',
  pink: '#FB7185',
};

const KIND_BADGE: Record<Track['kind'], { text: string; cls: string }> = {
  video: { text: 'VID', cls: 'bg-pulse/20 text-pulse' },
  audio: { text: 'AUD', cls: 'bg-signal/15 text-signal-dim' },
  text: { text: 'TXT', cls: 'bg-mind/20 text-mind' },
};

const stripCache = new Map<string, { i: number; url: string }[]>();
const STRIP_CACHE_MAX = 200;
const stripCacheGet = (key: string) => {
  const v = stripCache.get(key);
  if (v) { stripCache.delete(key); stripCache.set(key, v); } // LRU touch
  return v;
};
const stripCacheSet = (key: string, v: { i: number; url: string }[]) => {
  stripCache.delete(key);
  stripCache.set(key, v);
  while (stripCache.size > STRIP_CACHE_MAX) {
    const oldest = stripCache.keys().next().value;
    if (oldest === undefined) break;
    stripCache.delete(oldest);
  }
};

function Filmstrip({ clip, asset, width }: { clip: Clip; asset: MediaAsset; width: number }) {
  const pool = useStore((s) => s.pool);
  const count = Math.max(2, Math.min(10, Math.round(width / 72)));
  const key = `${asset.id}:${clip.inPoint.toFixed(2)}:${clip.duration.toFixed(2)}:${clip.speed}:${count}`;
  const [thumbs, setThumbs] = useState<{ i: number; url: string }[]>(stripCacheGet(key) ?? []);
  useEffect(() => {
    const cached = stripCacheGet(key);
    if (cached) { setThumbs(cached); return; }
    if (asset.type !== 'video' && asset.type !== 'image') return;
    let alive = true;
    (async () => {
      const out: { i: number; url: string }[] = [];
      for (let i = 0; i < count; i++) {
        const srcT = clip.inPoint + ((i + 0.5) / count) * clip.duration * clip.speed;
        try {
          const url = await pool.thumbnail(asset.id, srcT, 80);
          if (url) out.push({ i, url });
        } catch { /* ignore */ }
      }
      if (alive && out.length) { stripCacheSet(key, out); setThumbs(out); }
    })();
    return () => { alive = false; };
  }, [key, asset.id, asset.type, clip.inPoint, clip.duration, clip.speed, count, pool]);
  if (!thumbs.length) return null;
  return (
    <div className="absolute inset-0 flex opacity-70 pointer-events-none">
      {thumbs.map((t) => <img key={t.i} src={t.url} alt="" className="h-full object-cover flex-1 min-w-0" draggable={false} />)}
    </div>
  );
}

function Waveform({ clip, asset, width, height }: { clip: Clip; asset: MediaAsset; width: number; height: number }) {
  const project = useStore((s) => s.project);
  const ref = useRef<HTMLCanvasElement>(null);
  const ma = project.analysis?.byMedia[asset.id];
  useEffect(() => {
    const c = ref.current;
    if (!c || !ma || !ma.loudness.length) return;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height - 18));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(56,189,248,0.55)';
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const srcT = clip.inPoint + (x / w) * clip.duration * clip.speed;
      const idx = Math.max(0, Math.min(ma.loudness.length - 1, Math.round(srcT * 10)));
      const rms = ma.loudness[idx]?.rms ?? 0;
      const amp = Math.min(1, rms * 3) * (mid - 1);
      ctx.fillRect(x, mid - amp, 1, amp * 2);
    }
  }, [ma, clip.inPoint, clip.duration, clip.speed, width, height]);
  if (!ma?.loudness.length) return null;
  return <canvas ref={ref} className="absolute inset-x-0 bottom-0 pointer-events-none" style={{ height: height - 18 }} />;
}

interface DragState {
  mode: 'move' | 'trim-l' | 'trim-r';
  clipId: string;
  startX: number;
  origStart: number;
  origDuration: number;
  origInPoint: number;
  speed: number;
  trackId: string;
  /** All clips moved together when a multi-selection is dragged. */
  group: string[];
}

/** Payload shapes sent by MediaTab / TextTab / StickersTab / FiltersTab / EffectsTab / TransitionsTab drag sources. */
interface TextPresetDrop {
  text: string;
  role?: TextRole;
  duration?: number;
  preset?: import('../../engine').CaptionStyleId;
  effect?: TextEffect;
  transition?: TextTransition;
}
type DropPayload =
  | { kind: 'media'; mediaId: string }
  | { kind: 'text'; preset: TextPresetDrop }
  | { kind: 'sticker'; value: string }
  | { kind: 'filter'; preset: string; intensity?: number }
  | { kind: 'effect'; effectType: string; params?: Record<string, number | string | boolean> }
  | { kind: 'transition'; edge: 'in' | 'out'; type: string; duration: number };

/** Neutral color base — filter params are deltas from this (same math as FiltersTab). */
const FILTER_BASE: Record<string, number> = { brightness: 1, contrast: 1, saturation: 1, temperature: 0 };

/** Replicates FiltersTab.scaledParams: deltas from 1.0 scale by intensity, extras (temperature etc.) scale directly. */
function scaledFilterParams(preset: string, intensity: number): Record<string, number> {
  const src = COLOR_PRESETS[preset]?.params ?? {};
  const out: Record<string, number> = { ...FILTER_BASE };
  for (const [k, v] of Object.entries(src)) {
    if (k in FILTER_BASE) out[k] = 1 + (v - 1) * intensity;
    else out[k] = v * intensity;
  }
  return out;
}

/** Default params per effect type when dropped from the Effects tab. */
const EFFECT_DEFAULTS: Record<EffectType, Record<string, number | string | boolean>> = {
  color: { ...FILTER_BASE },
  blur: { amount: 4 },
  sharpen: { amount: 2 },
  vignette: { amount: 1 },
  chromaKey: { color: '#00FF00', tolerance: 0.2, softness: 0.12 },
  eq: { highpass: 80, lowpass: 0, gain: 0 },
  gate: { thresholdDb: -45 },
  deess: { reduction: 4 },
  denoise: { thresholdDb: -45 },
  negate: { invert: 1 },
  normalize: { strength: 0.8 },
  pixelate: { amount: 8 },
  noise: { amount: 0.15 },
  rgbSplit: { amount: 4 },
  glow: { amount: 0.4 },
  lut: { strength: 1 }, // requires a lut id; generic drops are ignored by the renderer
  compressor: { thresholdDb: -24, ratio: 4 },
  limiter: { ceilingDb: -1 },
  echo: { delayMs: 250, feedback: 0.3, mix: 0.35 },
  pan: { pan: 0 },
};

const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const FALCONCUT_MIME = 'application/x-falconcut';

export function Timeline() {
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const zoom = useStore((s) => s.zoom);
  const selection = useStore((s) => s.selection);
  const zone = useStore((s) => s.zone);
  const ui = useUI();
  const device = useDeviceClass();
  /* Narrower track headers on phones/tablets give the waveforms and filmstrips
     the space they need; all pointer math uses this same value. */
  const HEADER_W = device === 'phone' ? 104 : device === 'tablet' ? 132 : 150;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<(DragState & { curStart: number; curDuration: number; curInPoint: number; curTrack: string }) | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; clientX: number; clientY: number; dragged: boolean } | null>(null);
  const [dropHint, setDropHint] = useState<{ trackIdx: number; time: number; clipId?: string } | null>(null);
  const [resizing, setResizing] = useState<{ trackId: string; height: number } | null>(null);
  const [newTrackDrop, setNewTrackDrop] = useState<NewTrackDrop | null>(null);
  const dropDepth = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  /** Commit source of truth: React state can be one frame behind a fast
   * pointerup, so the drop is resolved from this ref instead. */
  const dragCurRef = useRef<{
    curStart: number; curDuration: number; curInPoint: number; curTrack: string;
    drop: NewTrackDrop | null;
  } | null>(null);
  /** Playback auto-follow is suspended briefly while the user scrolls manually. */
  const followSuspendRef = useRef(0);
  /* pane height resize (drag handle above the toolbar) */
  const paneDrag = useRef<{ startY: number; startH: number } | null>(null);
  const [paneResizing, setPaneResizing] = useState(false);
  /* Touch long-press → context menu. Mouse users already have right-click;
     touch users had no way to reach duplicate / ripple-delete / labels. */
  const longPress = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  /* Dragging a keyframe diamond on the timeline (time only; the graph editor
     in the Inspector handles time + value). */
  const [kfDrag, setKfDrag] = useState<{ clipId: string; kfId: string; time: number } | null>(null);

  const clearLongPress = () => {
    if (longPress.current) {
      window.clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };
  const startLongPress = (e: React.PointerEvent, menu: CtxMenuState) => {
    if (e.pointerType === 'mouse') return;
    clearLongPress();
    const timer = window.setTimeout(() => {
      if (!longPress.current) return;
      longPress.current.fired = true;
      /* The pointerdown already armed a clip drag. Long-press means "menu",
         not "move", so drop the pending drag before the menu appears. */
      dragRef.current = null;
      dragCurRef.current = null;
      setDrag(null);
      setCtxMenu(menu);
    }, 480);
    longPress.current = { timer, x: e.clientX, y: e.clientY, fired: false };
  };
  const longPressMoved = (e: React.PointerEvent) => {
    const lp = longPress.current;
    if (!lp) return;
    if (Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 8) clearLongPress();
  };

  const dur = projectDuration(project);
  const fps = project.settings.fps > 0 ? project.settings.fps : 30;
  const snap = ui.snap;
  const contentW = Math.max(600, (dur + 6) * zoom);
  const tracks = [...project.tracks].sort((a, b) => Number(b.kind === 'text') - Number(a.kind === 'text'));

  /* Follow the playhead during playback, but never fight a manual scroll:
     wheel / scrollbar input suspends following for a few seconds. */
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el || Date.now() < followSuspendRef.current) return;
    const x = HEADER_W + playhead * zoom;
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    const rightPad = 72;
    const leftPad = HEADER_W + 24;
    if (x > right - rightPad) {
      el.scrollLeft = Math.max(0, x - el.clientWidth + rightPad);
    } else if (x < left + leftPad) {
      el.scrollLeft = Math.max(0, x - leftPad);
    }
  }, [playing, playhead, zoom, HEADER_W]);

  /* Two-finger pinch zooms the timeline (mobile editors expect this). The
     listener is non-passive only while two fingers are down so normal pane
     scrolling still behaves. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startDist = 0;
    let startZoom = 0;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      startDist = distance(e.touches);
      startZoom = useStore.getState().zoom;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist < 8) return;
      e.preventDefault();
      const next = Math.max(8, Math.min(600, startZoom * (distance(e.touches) / startDist)));
      useStore.getState().setZoom(next);
    };
    const onEnd = (e: TouchEvent) => { if (e.touches.length < 2) startDist = 0; };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ui.timelineCollapsed]);

  /** Effective height of one track (resize-in-progress override, then persisted Track.height, then ROW_H default). */
  const effHeight = (track: Track) =>
    resizing?.trackId === track.id ? resizing.height : (track.height ?? ROW_H);

  /** Cumulative y layout — variable track heights, so no more fixed ROW_H math. */
  const layout: { track: Track; top: number; height: number }[] = [];
  {
    let y = 0;
    for (const t of tracks) { layout.push({ track: t, top: y, height: effHeight(t) }); y += effHeight(t); }
  }

  /** Track entry containing a content-relative y (clamped to the last row). */
  const trackAtY = (y: number) => {
    if (!layout.length) return undefined;
    for (const e of layout) { if (y < e.top + e.height) return e; }
    return layout[layout.length - 1];
  };

  /** Ghost lane shown while a clip is dragged past the first/last track. */
  const renderNewTrackGhost = (pos: 'above' | 'below') => {
    if (!newTrackDrop || drag?.curTrack !== NEW_TRACK_ID) return null;
    if (pos === 'above' && newTrackDrop.index !== 0) return null;
    if (pos === 'below' && newTrackDrop.index !== tracks.length) return null;
    const kind = newTrackDrop.kind;
    return (
      <div className="flex border-b border-signal/40 bg-signal/10" style={{ height: ROW_H }} title={`Release to create a new ${kind} track`}>
        <div className="sticky left-0 z-20 shrink-0 bg-ink-800 border-r border-signal/50 flex items-center px-2 text-[10px] text-signal" style={{ width: HEADER_W }}>
          <Plus size={12} className="mr-1" /> New {kind}
        </div>
        <div className="flex-1 flex items-center px-3 m-1 rounded border-2 border-dashed border-signal/60 text-[10px] text-signal font-medium" style={{ width: contentW }}>
          + Release to create a new {kind} track and drop here
        </div>
      </div>
    );
  };

  const timeAt = (clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, (clientX - rect.left - HEADER_W) / zoom);
  };

  const snapTime = (t: number, ignoreId?: string, bypass = false) => {
    if (bypass || !snap) return Math.max(0, t);
    const tol = 8 / zoom;
    const candidates = [0, playhead];
    for (const c of project.clips) { if (c.id === ignoreId) continue; candidates.push(c.start, c.start + c.duration); }
    for (const m of project.markers) candidates.push(m.time);
    let best = t, bestD = tol;
    for (const c of candidates) { const d = Math.abs(c - t); if (d < bestD) { bestD = d; best = c; } }
    return Math.max(0, best);
  };

  const scrub = (clientX: number) => {
    const s = useStore.getState();
    s.pause();
    s.setPlayhead(timeAt(clientX));
  };

  const onRulerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrub(e.clientX);
    const move = (ev: PointerEvent) => scrub(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ---- marquee selection: drag on empty timeline space -------------------- */
  /* A plain click still scrubs (and clears the selection); once the pointer
   * travels 5 px it becomes a rubber-band that selects every clip it touches. */

  const onLanePointerDown = (e: React.PointerEvent, trackId: string) => {
    if (e.target !== e.currentTarget) return;
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return;
    startLongPress(e, { x: e.clientX, y: e.clientY, clipId: null, trackId });
    marqueeStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, clientX: e.clientX, clientY: e.clientY, dragged: false };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  };

  const onLanePointerMove = (e: React.PointerEvent) => {
    longPressMoved(e);
    const st = marqueeStart.current;
    const rect = contentRef.current?.getBoundingClientRect();
    if (!st || !rect) return;
    if (!st.dragged && Math.abs(e.clientX - st.clientX) + Math.abs(e.clientY - st.clientY) < 5) return;
    st.dragged = true;
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    setMarquee({ x1: st.x, y1: st.y, x2, y2 });
    const left = Math.min(st.x, x2), right = Math.max(st.x, x2);
    const top = Math.min(st.y, y2), bottom = Math.max(st.y, y2);
    const hit: string[] = [];
    for (const row of layout) {
      for (const c of project.clips) {
        if (c.trackId !== row.track.id) continue;
        const x1 = HEADER_W + c.start * zoom;
        const cx2 = x1 + c.duration * zoom;
        const y1 = RULER_H + row.top + 4;
        const cy2 = y1 + row.height - 8;
        if (cx2 > left && x1 < right && cy2 > top && y1 < bottom) hit.push(c.id);
      }
    }
    useStore.getState().select(hit);
  };

  const onLanePointerUp = (e: React.PointerEvent) => {
    const fired = longPress.current?.fired === true;
    clearLongPress();
    const st = marqueeStart.current;
    marqueeStart.current = null;
    setMarquee(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    /* A long-press opened the track menu — do not also scrub/clear selection. */
    if (fired) return;
    if (st && !st.dragged) { useStore.getState().select([]); scrub(e.clientX); }
  };

  const beginDrag = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    e.stopPropagation();
    const s = useStore.getState();
    /* Grouped clips always travel + select as one, like an NLE's clip links. */
    const groupIds = (id: string) => {
      const c = project.clips.find((x) => x.id === id);
      return c?.groupId ? project.clips.filter((x) => x.groupId === c.groupId).map((x) => x.id) : [];
    };
    if (e.shiftKey) s.select([clip.id, ...groupIds(clip.id)], true);
    else if (!s.selection.includes(clip.id)) s.select([clip.id, ...groupIds(clip.id)]);
    startLongPress(e, { x: e.clientX, y: e.clientY, clipId: clip.id, trackId: clip.trackId });
    if (clip.locked) { ui.toast('Clip is locked — long-press or right-click → Unlock to edit it', 'info'); return; }
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) { ui.toast('Track is locked', 'info'); return; }
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events / touch edge cases have no active pointer — the
      // move/up listeners on the element still receive the drag.
    }
    // Multi-select drag: remember every selected AND linked clip so groups move as one.
    const picked = useStore.getState().selection.slice();
    const expanded = new Set(picked);
    picked.forEach((id) => groupIds(id).forEach((gid) => expanded.add(gid)));
    const group = [...expanded];
    const d: DragState = { mode, clipId: clip.id, startX: e.clientX, origStart: clip.start, origDuration: clip.duration, origInPoint: clip.inPoint, speed: clip.speed, trackId: clip.trackId, group: group.includes(clip.id) ? group : [clip.id] };
    dragRef.current = d;
    dragCurRef.current = { curStart: clip.start, curDuration: clip.duration, curInPoint: clip.inPoint, curTrack: clip.trackId, drop: null };
    setDrag({ ...d, curStart: clip.start, curDuration: clip.duration, curInPoint: clip.inPoint, curTrack: clip.trackId });
  };

  const onDragMove = (e: React.PointerEvent) => {
    longPressMoved(e);
    const d = dragRef.current;
    if (!d) return;
    const dt = (e.clientX - d.startX) / zoom;
    if (d.mode === 'move') {
      const raw = d.origStart + dt;
      const newStart = snapTime(raw, d.clipId, e.altKey);
      setSnapLine(Math.abs(newStart - raw) > 1e-6 ? newStart : null);
      // Pick target track by vertical position (variable heights).
      const rect = contentRef.current!.getBoundingClientRect();
      const y = e.clientY - rect.top - RULER_H;
      // Compat matches the engine's move_clip guard: audio on audio tracks,
      // video/image on video tracks, text/motif on text tracks.
      const dragged = project.clips.find((c) => c.id === d.clipId);
      const wantKind: Track['kind'] = dragged?.kind === 'media'
        ? (getMedia(project, dragged.mediaId)?.type === 'audio' ? 'audio' : 'video')
        : 'text';
      const firstTop = layout.length ? layout[0].top : 0;
      const last = layout[layout.length - 1];
      const totalH = last ? last.top + last.height : 0;
      const EDGE = ROW_H * 0.45; // how far past the edge before a new track appears

      let nt: NewTrackDrop | null = null;
      let targetId: string | null = null;
      if (y < firstTop - EDGE) {
        nt = { kind: wantKind, index: 0 };
      } else if (y > totalH + EDGE) {
        nt = { kind: wantKind, index: tracks.length };
      } else {
        const targetTrack = trackAtY(Math.max(0, y))?.track;
        if (targetTrack && targetTrack.kind === wantKind && !targetTrack.locked) targetId = targetTrack.id;
      }
      setNewTrackDrop(nt);
      const curTrack = nt ? NEW_TRACK_ID : targetId ?? d.trackId;
      setDrag((p) => {
        if (!p) return p;
        return { ...p, curStart: newStart, curTrack };
      });
      if (dragCurRef.current) {
        dragCurRef.current.curStart = newStart;
        dragCurRef.current.curTrack = curTrack;
        dragCurRef.current.drop = nt;
      }
    } else if (d.mode === 'trim-l') {
      const raw = d.origStart + dt;
      let newStart = snapTime(raw, d.clipId, e.altKey);
      newStart = Math.max(0, Math.min(newStart, d.origStart + d.origDuration - 0.1));
      setSnapLine(Math.abs(newStart - raw) > 1e-6 ? newStart : null);
      const delta = newStart - d.origStart;
      setDrag((p) => p ? { ...p, curStart: newStart, curDuration: d.origDuration - delta, curInPoint: Math.max(0, d.origInPoint + delta * d.speed) } : p);
      if (dragCurRef.current) {
        dragCurRef.current.curStart = newStart;
        dragCurRef.current.curDuration = d.origDuration - delta;
        dragCurRef.current.curInPoint = Math.max(0, d.origInPoint + delta * d.speed);
      }
    } else {
      const rawEnd = d.origStart + d.origDuration + dt;
      const snEnd = snapTime(rawEnd, d.clipId, e.altKey);
      setSnapLine(Math.abs(snEnd - rawEnd) > 1e-6 ? snEnd : null);
      const newDur = Math.max(0.1, snEnd - d.origStart);
      setDrag((p) => p ? { ...p, curDuration: newDur } : p);
      if (dragCurRef.current) dragCurRef.current.curDuration = newDur;
    }
  };

  const endDrag = () => {
    clearLongPress();
    const d = dragRef.current;
    const cur = dragCurRef.current;
    dragRef.current = null;
    dragCurRef.current = null;
    setDrag(null);
    setSnapLine(null);
    const drop = cur?.drop ?? null;
    setNewTrackDrop(null);
    if (!d || !cur) return;
    const s = useStore.getState();
    if (d.mode === 'move') {
      const actions: Action[] = [];
      let targetTrackId = cur.curTrack;
      // Dropped past the first/last track: create a matching track in the same
      // undo step, then move the clip onto it. Both actions share one id.
      if (targetTrackId === NEW_TRACK_ID && drop) {
        const newId = uid('trk');
        const name = drop.kind === 'video'
          ? `V${tracks.filter((t) => t.kind === 'video').length + 1}`
          : drop.kind === 'audio'
            ? `A${tracks.filter((t) => t.kind === 'audio').length + 1}`
            : 'Text';
        actions.push({ type: 'add_track', track: { id: newId, kind: drop.kind, name }, index: drop.index });
        targetTrackId = newId;
      }
      // A cancelled/rapid drop can leave the sentinel without a descriptor —
      // never emit move_clip with an invalid track id.
      if (targetTrackId === NEW_TRACK_ID) return;
      // Never allow same-track overlap — clamp the drop into the nearest gap.
      const start = resolveFreeStart(project.clips, targetTrackId, cur.curStart, d.origDuration, d.clipId);
      actions.push({ type: 'move_clip', clipId: d.clipId, start, trackId: targetTrackId });
      // Multi-select drag: shift the rest of the group by the same delta on
      // their own tracks (only the grabbed clip changes tracks).
      const dt = start - d.origStart;
      for (const id of d.group) {
        if (id === d.clipId) continue;
        const c = s.project.clips.find((x) => x.id === id);
        if (c && Math.abs(dt) > 0.001) actions.push({ type: 'move_clip', clipId: id, start: Math.max(0, c.start + dt) });
      }
      const moved = Math.abs(start - d.origStart) > 0.001 || cur.curTrack !== d.trackId;
      if (moved || actions.length > 1) s.commit(actions, actions.length > 1 ? 'Move clips' : 'Move clip');
    } else {
      // Trim cannot cross neighbours on the same track either.
      const others = s.project.clips.filter((c) => c.trackId === d.trackId && c.id !== d.clipId);
      let start = cur.curStart;
      let duration = cur.curDuration;
      let inPoint = cur.curInPoint;
      if (d.mode === 'trim-l') {
        const prevEnd = Math.max(0, ...others.filter((c) => c.start <= d.origStart + 1e-6).map((c) => c.start + c.duration));
        if (start < prevEnd - 1e-6) {
          const shift = prevEnd - start;
          start = prevEnd;
          duration = Math.max(0.1, duration - shift);
          inPoint = Math.max(0, inPoint + shift * d.speed);
        }
      } else {
        const nextStart = Math.min(...others.filter((c) => c.start >= d.origStart + d.origDuration - 1e-6).map((c) => c.start), Infinity);
        if (start + duration > nextStart) duration = Math.max(0.1, nextStart - start);
      }
      if (Math.abs(start - d.origStart) > 0.001 || Math.abs(duration - d.origDuration) > 0.001) {
        // Let the engine derive the new inPoint: it handles speed ramps and
        // reversed clips correctly, while this gesture's inPoint guess does not.
        void inPoint;
        s.commit([{ type: 'trim_clip', clipId: d.clipId, start, duration }], 'Trim clip');
      }
    }
  };

  /* ---- keyframe diamonds: drag along the clip to retime (time only) ----
   * The Inspector's graph editor handles time + value on a curve; the timeline
   * diamond is the fast "nudge it to the beat" gesture mobile editors expect. */
  const beginKfDrag = (e: React.PointerEvent, clip: Clip, kfId: string, time: number) => {
    e.stopPropagation();
    e.preventDefault();
    useStore.getState().select([clip.id]);
    setKfDrag({ clipId: clip.id, kfId, time });
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
  };
  const moveKfDrag = (e: React.PointerEvent) => {
    if (!kfDrag) return;
    e.stopPropagation();
    const rect = contentRef.current?.getBoundingClientRect();
    const clip = useStore.getState().project.clips.find((c) => c.id === kfDrag.clipId);
    if (!rect || !clip) return;
    const t = (e.clientX - rect.left - HEADER_W) / zoom - clip.start;
    const next = Math.max(0, Math.min(clip.duration, t));
    setKfDrag((p) => (p ? { ...p, time: next } : p));
  };
  const endKfDrag = (e: React.PointerEvent) => {
    if (!kfDrag) return;
    e.stopPropagation();
    const clip = useStore.getState().project.clips.find((c) => c.id === kfDrag.clipId);
    const kf = clip?.keyframes.find((k) => k.id === kfDrag.kfId);
    if (clip && kf && Math.abs(kf.time - kfDrag.time) > 0.005) {
      useStore.getState().commit([{ type: 'update_keyframe', clipId: clip.id, keyframeId: kf.id, time: kfDrag.time }], 'Move keyframe');
    }
    setKfDrag(null);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* released */ }
  };

  /* ---- external drop zone (media / text / sticker drags from the media panel) ---- */

  const isFalconCutDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(FALCONCUT_MIME);

  /** Hovered visible track row + snapped drop time + clip under cursor, using the same hit-test math as clip dragging. */
  const dropHitTest = (clientX: number, clientY: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || tracks.length === 0) return null;
    const rawTime = Math.max(0, (clientX - rect.left - HEADER_W) / zoom);
    const time = snapTime(rawTime);
    const y = Math.max(0, clientY - rect.top - RULER_H);
    const entry = trackAtY(y);
    if (!entry) return null;
    const trackIdx = tracks.indexOf(entry.track);
    const clip = clipsOnTrack(project, entry.track.id)
      .find((c) => rawTime >= c.start && rawTime <= c.start + c.duration);
    return { trackIdx, time, clipId: clip?.id };
  };

  const onDragOverZone = (e: React.DragEvent) => {
    if (!isFalconCutDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const hit = dropHitTest(e.clientX, e.clientY);
    if (hit) setDropHint((prev) => (prev && prev.trackIdx === hit.trackIdx && Math.abs(prev.time - hit.time) < 1e-6 && prev.clipId === hit.clipId ? prev : hit));
  };

  const onDragEnterZone = (e: React.DragEvent) => {
    if (!isFalconCutDrag(e)) return;
    e.preventDefault();
    dropDepth.current += 1;
  };

  const onDragLeaveZone = (e: React.DragEvent) => {
    if (!isFalconCutDrag(e)) return;
    dropDepth.current = Math.max(0, dropDepth.current - 1);
    if (dropDepth.current === 0) setDropHint(null);
  };

  const onDropZone = (e: React.DragEvent) => {
    if (!isFalconCutDrag(e)) return;
    e.preventDefault();
    dropDepth.current = 0;
    setDropHint(null);
    const hit = dropHitTest(e.clientX, e.clientY);
    const raw = e.dataTransfer.getData(FALCONCUT_MIME);
    if (!hit || !raw) return;
    let payload: DropPayload;
    try { payload = JSON.parse(raw) as DropPayload; } catch { return; }

    const s = useStore.getState();
    const before = new Set(project.clips.map((c) => c.id));
    const commitAndSelect = (actions: Action[], label: string) => {
      s.commit(actions, label);
      const created = useStore.getState().project.clips.find((c) => !before.has(c.id));
      if (created) useStore.getState().select([created.id]);
    };
    /** Clip under the drop point, else the single selected clip. */
    const dropTarget = () => {
      if (hit.clipId) return project.clips.find((c) => c.id === hit.clipId);
      return selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
    };
    const selectTarget = (id: string) => { useStore.getState().select([id]); };

    if (payload.kind === 'media' && payload.mediaId) {
      const asset = getMedia(project, payload.mediaId);
      if (!asset) return;
      const isAudio = asset.type === 'audio';
      let track: Track | undefined = tracks[hit.trackIdx];
      const compatible = track && track.kind !== 'text' && (track.kind === 'audio') === isAudio;
      if (!compatible) track = project.tracks.find((t) => t.kind === (isAudio ? 'audio' : 'video'));
      const actions: Action[] = [];
      if (!track) {
        // Same behaviour as dragging an existing clip past the last track:
        // create the missing compatible track in the SAME undo step.
        const kind = isAudio ? 'audio' : 'video';
        const id = uid('trk');
        actions.push({ type: 'add_track', track: { id, kind, name: kind === 'audio' ? `A${project.tracks.filter((t) => t.kind === 'audio').length + 1}` : `V${project.tracks.filter((t) => t.kind === 'video').length + 1}` } });
        track = { id, kind, name: '', locked: false, muted: false, hidden: false };
      }
      if (track.locked) { ui.toast('Track is locked', 'info'); return; }
      const duration = Math.max(0.5, asset.duration || 5);
      const start = resolveFreeStart(project.clips, track.id, hit.time, duration);
      actions.push({ type: 'add_clip', clip: { trackId: track.id, mediaId: asset.id, start, duration, inPoint: 0 } });
      commitAndSelect(actions, 'Drop media');
      ui.toast(`Added ${asset.name} to timeline`);
    } else if (payload.kind === 'text' && payload.preset) {
      const preset = payload.preset;
      const textTrackId = project.tracks.find((t) => t.kind === 'text')?.id;
      const duration = preset.duration ?? 3;
      const start = textTrackId ? resolveFreeStart(project.clips, textTrackId, hit.time, duration) : hit.time;
      const { actions } = buildStyledText(project, {
        start, duration, text: preset.text,
        role: preset.role ?? 'caption',
        preset: preset.preset ?? 'clean',
        effect: preset.effect ?? 'none',
        transition: preset.transition ?? 'none',
        trackId: textTrackId,
      });
      commitAndSelect(actions, 'Drop text');
      ui.toast(`${preset.preset ?? 'Clean'} ${preset.role ?? 'text'} added to the video`, 'success');
    } else if (payload.kind === 'sticker' && payload.value) {
      const textTrackId = project.tracks.find((t) => t.kind === 'text')?.id;
      const start = textTrackId ? resolveFreeStart(project.clips, textTrackId, hit.time, 2) : hit.time;
      const actions: Action[] = [];
      if (!textTrackId) actions.push({ type: 'add_track', track: { kind: 'text' } });
      actions.push({ type: 'add_text', start, duration: 2, text: payload.value, role: 'title', preset: 'word-pop', style: { fontSize: 0.12 } });
      commitAndSelect(actions, 'Drop sticker');
      ui.toast('Sticker added to timeline', 'success');
    } else if (payload.kind === 'filter' && payload.preset) {
      const target = dropTarget();
      if (!target) { ui.toast('No clip there', 'error'); return; }
      if (!COLOR_PRESETS[payload.preset]) { ui.toast('Unknown filter', 'error'); return; }
      const params = scaledFilterParams(payload.preset, payload.intensity ?? 1);
      const colorFx = target.effects.find((e) => e.type === 'color');
      const actions: Action[] = colorFx
        ? [{ type: 'set_effect', clipId: target.id, effectId: colorFx.id, params }]
        : [{ type: 'add_effect', clipId: target.id, effect: { type: 'color', enabled: true, params } }];
      s.commit(actions, 'Drop filter');
      selectTarget(target.id);
      ui.toast(`Filter ${COLOR_PRESETS[payload.preset].name} dropped on ${target.name ?? 'clip'}`, 'success');
    } else if (payload.kind === 'effect' && payload.effectType) {
      const type = payload.effectType as EffectType;
      const defaults = EFFECT_DEFAULTS[type];
      if (!defaults) { ui.toast('Unknown effect', 'error'); return; }
      const target = dropTarget();
      if (!target) { ui.toast('No clip there', 'error'); return; }
      s.commit([{ type: 'add_effect', clipId: target.id, effect: { type, enabled: true, params: { ...defaults, ...(payload.params ?? {}) } } }], 'Drop effect');
      selectTarget(target.id);
      ui.toast(`${payload.effectType} dropped on ${target.name ?? 'clip'}`, 'success');
    } else if (payload.kind === 'transition' && payload.type) {
      const type = TRANSITION_TYPES.includes(payload.type as Transition['type']) ? (payload.type as Transition['type']) : undefined;
      if (!type) { ui.toast('Unknown transition', 'error'); return; }
      const target = dropTarget();
      if (!target) { ui.toast('No clip there', 'error'); return; }
      const edge = payload.edge === 'out' ? 'out' : 'in';
      const transition: Transition = { type, duration: clampNum(payload.duration ?? 0.4, 0.1, 2) };
      s.commit([{ type: 'set_transition', clipId: target.id, edge, transition }], 'Drop transition');
      selectTarget(target.id);
      ui.toast(`${type} (${edge}) dropped on ${target.name ?? 'clip'}`, 'success');
    }
  };

  const splitAtPlayhead = () => {
    const s = useStore.getState();
    const t = s.playhead;
    const target = s.project.clips.find((c) => c.id === s.selection[0] && t > c.start + 0.05 && t < c.start + c.duration - 0.05)
      ?? s.project.clips.find((c) => c.kind === 'media' && t > c.start + 0.05 && t < c.start + c.duration - 0.05);
    if (target) s.commit([{ type: 'split_clip', clipId: target.id, time: t }], 'Split clip');
    else ui.toast('Place the playhead inside a clip to split', 'info');
  };

  const deleteSel = () => {
    const s = useStore.getState();
    if (!s.selection.length) return;
    const applied = s.commit(s.selection.map((id) => ({ type: 'remove_clip', clipId: id, ripple: true })), 'Delete clips');
    if (applied) s.select([]);
  };

  const addTrack = (kind: Track['kind']) => {
    useStore.getState().commit([{ type: 'add_track', track: { kind, name: kind === 'video' ? `V${tracks.filter((t) => t.kind === 'video').length + 1}` : kind === 'audio' ? `A${tracks.filter((t) => t.kind === 'audio').length + 1}` : 'Text' } }], 'Add track');
  };

  /** Shift later clips on every video/audio track left to remove inter-clip gaps. */
  const closeGaps = () => {
    const s = useStore.getState();
    const acts: Action[] = [];
    for (const track of project.tracks) {
      if (track.kind === 'text') continue;
      let cursor = 0;
      for (const c of clipsOnTrack(project, track.id)) {
        if (c.start > cursor + 0.04) acts.push({ type: 'move_clip', clipId: c.id, start: cursor });
        cursor = Math.max(cursor, c.start + c.duration);
      }
    }
    if (!acts.length) { ui.toast('No gaps to close', 'info'); return; }
    s.commit(acts, 'Close gaps');
  };

  const hasGaps = useMemo(() => project.tracks.some((track) => {
    if (track.kind === 'text') return false;
    let cursor = 0;
    for (const c of clipsOnTrack(project, track.id)) {
      if (c.start > cursor + 0.04) return true;
      cursor = Math.max(cursor, c.start + c.duration);
    }
    return false;
  }), [project]);

  const addMarker = () => {
    const s = useStore.getState();
    s.commit([{ type: 'add_marker', marker: { time: s.playhead, label: `M${s.project.markers.length + 1}`, color: '#4C9AFF' } }], 'Add marker');
  };

  const zoomToFit = () => {
    const w = scrollRef.current?.clientWidth ?? 0;
    useStore.getState().setZoom((w - HEADER_W - 24) / Math.max(1, dur));
  };

  /** Frame the selected clips: zoom so the selection fills the pane and
   * scroll its start into view. */
  const zoomToSelection = () => {
    const s = useStore.getState();
    const clips = s.project.clips.filter((c) => s.selection.includes(c.id));
    if (!clips.length) { useUI.getState().toast('Select a clip first, then zoom to it', 'info'); return; }
    const start = Math.min(...clips.map((c) => c.start));
    const end = Math.max(...clips.map((c) => c.start + c.duration));
    const w = scrollRef.current?.clientWidth ?? 0;
    const z = Math.max(8, Math.min(600, (w - HEADER_W - 24) / Math.max(0.5, end - start)));
    s.setZoom(z);
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, start * z - 12);
    });
  };

  /* ---- right-click context menu ---- */

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

  // The empty-space menu's "Zoom to fit" reuses this component's scroll-aware math.
  useEffect(() => {
    const onZoomToFit = () => zoomToFit();
    const onZoomToSelection = () => zoomToSelection();
    window.addEventListener('falconcut:zoom-to-fit', onZoomToFit);
    window.addEventListener('falconcut:zoom-to-selection', onZoomToSelection);
    return () => {
      window.removeEventListener('falconcut:zoom-to-fit', onZoomToFit);
      window.removeEventListener('falconcut:zoom-to-selection', onZoomToSelection);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dur]);

  const onClipContextMenu = (e: React.MouseEvent, clip: Clip) => {
    if (clip.locked) return;
    e.preventDefault();
    e.stopPropagation();
    useStore.getState().select([clip.id]);
    setCtxMenu({ x: e.clientX, y: e.clientY, clipId: clip.id });
  };
  const onTracksContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, clipId: null });
  };

  /* ---- track height resize: drag the bottom edge of a track header ---- */

  const beginResize = (e: React.PointerEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = effHeight(track);
    setResizing({ trackId: track.id, height: startH });
    const move = (ev: PointerEvent) => {
      setResizing({ trackId: track.id, height: clampNum(startH + (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const h = clampNum(startH + (ev.clientY - startY), TRACK_H_MIN, TRACK_H_MAX);
      setResizing(null);
      if (Math.round(h) !== Math.round(startH))
        useStore.getState().commit([{ type: 'set_track', trackId: track.id, patch: { height: h } }], 'Resize track');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /* ---- ruler ticks: fps timecode, labels never overlap, minor unlabeled ticks ---- */
  const { majorStep, minorStep } = useMemo(() => {
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const minStep = Math.max(1, Math.ceil(46 / zoom)); // ~46px label width
    const step = steps.find((s) => s >= minStep) ?? steps[steps.length - 1];
    return { majorStep: step, minorStep: step / 5 };
  }, [zoom]);

  const majorTicks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= dur + 6; t += majorStep) out.push(t);
    return out;
  }, [majorStep, dur]);

  const minorTicks = useMemo(() => {
    const end = dur + 6;
    if (minorStep <= 0 || end / minorStep > 2000) return [];
    const out: number[] = [];
    for (let t = minorStep; t <= end; t += minorStep) {
      if (Math.abs(t / majorStep - Math.round(t / majorStep)) < 1e-6) continue; // skip majors
      out.push(t);
    }
    return out;
  }, [minorStep, majorStep, dur]);

  /** MM:SS.FF timecode at project fps. */
  const fmt = (t: number) => {
    const total = Math.max(0, t);
    const m = Math.floor(total / 60);
    const s = Math.floor(total % 60);
    const f = Math.floor((total % 1) * fps);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
  };

  /* ---- timeline pane resize: drag the handle bar above the toolbar ----
   * Pointer events (not mouse) so touch works too; setPointerCapture keeps
   * move/up on the handle even when the cursor leaves it. */
  const onPaneResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    paneDrag.current = { startY: e.clientY, startH: ui.timelineHeight };
    setPaneResizing(true);
  };
  const onPaneResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = paneDrag.current;
    if (!d) return;
    ui.setTimelineHeight(d.startH + (d.startY - e.clientY)); // dragging up makes the pane taller
  };
  const onPaneResizeUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!paneDrag.current) return;
    paneDrag.current = null;
    setPaneResizing(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };

  if (ui.timelineCollapsed) {
    return (
      <div className="shrink-0 flex bg-ink-900 border-t border-line" style={{ minHeight: 40 }}>
        <div className="h-full w-full flex items-center gap-2 px-2 py-0.5">
          <button className="icon-btn" title="Expand timeline" onClick={() => ui.setTimelineCollapsed(false)}><ChevronUp size={15} /></button>
          <span className="text-[11px] text-paper-faint">Timeline collapsed — expand to edit clips</span>
          <div className="flex-1" />
          <span className="text-[11px] text-paper-faint font-mono">{project.clips.length} clips</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`shrink-0 flex flex-col bg-ink-900 border-t border-line ${paneResizing ? 'no-select' : ''}`} style={{ height: ui.timelineHeight }}>
      {/* pane resize handle */}
      <div
        className="cf-pane-handle group h-1.5 shrink-0 cursor-row-resize flex items-center no-select"
        title="Drag to resize timeline height"
        onPointerDown={onPaneResizeDown}
        onPointerMove={onPaneResizeMove}
        onPointerUp={onPaneResizeUp}
      >
        <div className={`h-px w-full transition-colors ${paneResizing ? 'bg-signal/70' : 'bg-line group-hover:bg-signal/60'}`} />
      </div>
      <div className="cf-toolbar shrink-0 flex items-center gap-1 px-2 border-b border-line">
        <button className="icon-btn" title="Collapse timeline" onClick={() => ui.setTimelineCollapsed(true)}><ChevronDown size={15} /></button>
        <button className="icon-btn" onClick={splitAtPlayhead} title="Split at playhead (S)"><Scissors size={15} /></button>
        <button className="icon-btn" onClick={deleteSel} disabled={!selection.length} title="Ripple delete selected (Del)"><Trash2 size={15} /></button>
        <button className="icon-btn" onClick={() => runEditorAction('nudgeBack')} disabled={!selection.length} title="Nudge selection left one frame (Alt+←)"><ArrowLeft size={15} /></button>
        <button className="icon-btn" onClick={() => runEditorAction('nudgeFwd')} disabled={!selection.length} title="Nudge selection right one frame (Alt+→)"><ArrowRight size={15} /></button>
        <button className={`icon-btn ${snap ? 'text-signal' : ''}`} onClick={() => ui.setSnap(!ui.snap)} title={`Snapping ${snap ? 'on' : 'off'} (N) — hold Alt while dragging to bypass`}><Magnet size={15} /></button>
        <button className="icon-btn" onClick={closeGaps} disabled={!hasGaps} title="Close gaps on video/audio tracks"><ChevronsRightLeft size={15} /></button>
        <div className="h-5 w-px bg-line mx-1" />
        <button className="icon-btn" onClick={addMarker} title="Add marker at playhead"><Flag size={15} /></button>
        <div className="h-5 w-px bg-line mx-1" />
        <button className="icon-btn" onClick={() => useStore.getState().setZoom(zoom / 1.3)} title="Zoom out (-)"><ZoomOut size={15} /></button>
        <button className="icon-btn" onClick={() => useStore.getState().setZoom(zoom * 1.3)} title="Zoom in (+)"><ZoomIn size={15} /></button>
        <button className="icon-btn" onClick={zoomToFit} title="Zoom to fit"><Maximize size={15} /></button>
        <button className="icon-btn" onClick={zoomToSelection} disabled={!selection.length} title="Zoom to selection (Shift+Z)"><Focus size={15} /></button>
        <input type="range" min={8} max={600} step={1} value={Math.round(zoom)} onChange={(e) => useStore.getState().setZoom(Number(e.target.value))} className="w-24 mx-1" title="Zoom (px per second)" />
        <span className="text-[11px] text-paper-faint font-mono ml-1">{Math.round(zoom)}px/s</span>
        <div className="flex-1" />
        <button className="btn-ghost text-xs py-1" onClick={() => addTrack('video')}><Plus size={13} /> Video</button>
        <button className="btn-ghost text-xs py-1" onClick={() => addTrack('audio')}><Plus size={13} /> Audio</button>
        <button className="btn-ghost text-xs py-1" onClick={() => addTrack('text')}><Plus size={13} /> Text</button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto relative"
        onWheelCapture={() => { followSuspendRef.current = Date.now() + 4000; }}
        onPointerDownCapture={(e) => { if (e.target === e.currentTarget) followSuspendRef.current = Date.now() + 4000; }}
        onDragEnter={onDragEnterZone} onDragOver={onDragOverZone} onDragLeave={onDragLeaveZone} onDrop={onDropZone}
        onContextMenu={onTracksContextMenu}
      >
        <div ref={contentRef} className="relative" style={{ width: contentW + HEADER_W, minHeight: '100%' }}>
          {/* ruler */}
          <div className="flex sticky top-0 z-30" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-40 shrink-0 bg-ink-850 border-r border-b border-line-bright flex items-center px-2 text-[10px] text-paper-faint" style={{ width: HEADER_W }}>Tracks</div>
            <div className="cf-ruler relative flex-1 bg-ink-850 border-b border-line-bright cursor-pointer" style={{ width: contentW }} onPointerDown={onRulerDown}>
              {minorTicks.map((t) => (
                <div key={`mi${t}`} className="absolute top-1/2 bottom-0 border-l border-line/40" style={{ left: t * zoom }} />
              ))}
              {majorTicks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 border-l border-line/60" style={{ left: t * zoom }}>
                  <span className="absolute top-0.5 left-1 text-[9px] text-paper-faint font-mono">{fmt(t)}</span>
                </div>
              ))}
              {project.markers.map((m) => (
                <div key={m.id} className="absolute top-0 bottom-0 w-0.5" style={{ left: m.time * zoom, background: m.color }} title={`${m.label} (${m.kind})`} />
              ))}
              {zone && (
                <div
                  className="absolute top-0 bottom-0 bg-signal/12 border-x border-signal/70 pointer-events-none"
                  style={{ left: zone.in * zoom, width: Math.max(2, (zone.out - zone.in) * zoom) }}
                  title={`Zone ${zone.in.toFixed(2)}s – ${zone.out.toFixed(2)}s (Ctrl+Space plays, Alt+Space loops, Esc clears)`}
                >
                  {zone.loop && <span className="absolute top-0.5 right-1 text-[9px] font-mono text-signal">⟳ loop</span>}
                </div>
              )}
            </div>
          </div>

          {/* tracks */}
          {renderNewTrackGhost('above')}
          {tracks.map((track, ti) => {
            const clips = clipsOnTrack(project, track.id);
            /* tiny dim loudness meter for audio track headers, static at playhead */
            let meterLevel: number | null = null;
            if (track.kind === 'audio') {
              const active = clips.find((c) => playhead >= c.start && playhead < c.start + c.duration);
              const asset = active ? getMedia(project, active.mediaId) : undefined;
              const ma = asset ? project.analysis?.byMedia[asset.id] : undefined;
              if (active && ma?.loudness.length) {
                const srcT = active.inPoint + (playhead - active.start) * active.speed;
                const idx = Math.max(0, Math.min(ma.loudness.length - 1, Math.round(srcT * 10)));
                meterLevel = Math.min(1, (ma.loudness[idx]?.rms ?? 0) * 3);
              }
            }
            const badge = KIND_BADGE[track.kind];
            const trackH = effHeight(track);
            return (
              <div key={track.id} className={`flex border-b border-line/50 ${resizing?.trackId === track.id ? 'select-none' : ''}`} style={{ height: trackH }}>
                <div className={`sticky left-0 z-20 shrink-0 bg-ink-850 border-r border-line-bright flex flex-col justify-center px-2 gap-0.5 relative ${track.locked ? 'border-l-2 border-l-heat-amber/60' : ''}`} style={{ width: HEADER_W }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, clipId: null, trackId: track.id }); }}
                  onPointerDown={(e) => startLongPress(e, { x: e.clientX, y: e.clientY, clipId: null, trackId: track.id })}
                  onPointerMove={longPressMoved}
                  onPointerUp={clearLongPress}
                  onPointerCancel={clearLongPress}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <span className={`text-[8px] font-bold tracking-wider rounded px-1 shrink-0 ${badge.cls}`}>{badge.text}</span>
                    <span className="text-[11px] font-medium text-paper truncate">{track.name}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button className="cf-track-btn icon-btn p-0.5" onClick={() => useStore.getState().commit([{ type: 'set_track', trackId: track.id, patch: { locked: !track.locked } }], 'Toggle lock')} title="Lock track">
                      {track.locked ? <Lock size={11} className="text-heat-amber" /> : <Unlock size={11} />}
                    </button>
                    {track.kind !== 'text' && (
                      <button className="cf-track-btn icon-btn p-0.5" onClick={() => useStore.getState().commit([{ type: 'set_track', trackId: track.id, patch: { muted: !track.muted } }], 'Toggle mute')} title="Mute track">
                        {track.muted ? <VolumeX size={11} className="text-heat" /> : <Volume2 size={11} />}
                      </button>
                    )}
                    {track.kind !== 'text' && (
                      <button className={`cf-track-btn icon-btn p-0.5 ${track.solo ? 'text-heat-amber' : ''}`}
                        onClick={() => useStore.getState().commit([{ type: 'set_track', trackId: track.id, patch: { solo: !track.solo } }], track.solo ? 'Solo off' : 'Solo track')}
                        title={track.solo ? 'Solo on — other tracks of this kind are silent' : 'Solo: play only this track (other tracks of this kind go silent)'}>
                        <Headphones size={11} />
                      </button>
                    )}
                    {track.kind === 'video' && (
                      <button className="cf-track-btn icon-btn p-0.5" onClick={() => useStore.getState().commit([{ type: 'set_track', trackId: track.id, patch: { hidden: !track.hidden } }], 'Toggle visibility')} title="Hide track">
                        {track.hidden ? <EyeOff size={11} className="text-heat" /> : <Eye size={11} />}
                      </button>
                    )}
                  </div>
                  {meterLevel != null && (
                    <div className="absolute bottom-2 left-2 right-2 flex gap-[2px] h-[3px] items-stretch pointer-events-none">
                      {Array.from({ length: 16 }, (_, i) => (
                        <div key={i} className={`flex-1 rounded-[1px] ${i / 16 < meterLevel ? 'bg-signal-dim/50' : 'bg-ink-600/60'}`} />
                      ))}
                    </div>
                  )}
                  {/* track height resize handle (bottom edge of header) */}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-signal/40 z-30"
                    title="Drag to resize track height"
                    onPointerDown={(e) => beginResize(e, track)}
                  />
                </div>
                <div className={`relative flex-1 ${dropHint && tracks[dropHint.trackIdx]?.id === track.id ? 'bg-signal/15 ring-1 ring-inset ring-signal/50' : ti % 2 === 0 ? 'bg-ink-900/50' : ''}`} style={{ width: contentW }}
                  onPointerDown={(e) => onLanePointerDown(e, track.id)}
                  onPointerMove={onLanePointerMove}
                  onPointerUp={onLanePointerUp}
                  onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, clipId: null, trackId: track.id }); }}
                >
                  {/* silence / scene overlays for this track's media */}
                  {clips.map((clip) => {
                    const asset = getMedia(project, clip.mediaId);
                    const ma = asset ? project.analysis?.byMedia[asset.id] : undefined;
                    if (!ma) return null;
                    const toTl = (srcT: number) => clip.start + (srcT - clip.inPoint) / clip.speed;
                    return (
                      <div key={`ov-${clip.id}`} className="absolute inset-0 pointer-events-none">
                        {track.kind !== 'text' && ma.silences.map((s, i) => {
                          const a = toTl(s.start), b = toTl(s.end);
                          if (b < clip.start || a > clip.start + clip.duration) return null;
                          return <div key={i} className="absolute top-0 bottom-0 bg-heat/10 border-x border-heat/20" style={{ left: Math.max(0, (a - clip.start) * zoom) + (clip.start * zoom), width: Math.max(1, (b - a) * zoom) }} />;
                        })}
                      </div>
                    );
                  })}
                  {clips.map((clip) => {
                    const isDrag = drag?.clipId === clip.id;
                    const start = isDrag ? drag!.curStart : clip.start;
                    const duration = isDrag ? drag!.curDuration : clip.duration;
                    const trackId = isDrag ? drag!.curTrack : clip.trackId;
                    if (trackId !== track.id) return null;
                    const asset = getMedia(project, clip.mediaId);
                    const selected = selection.includes(clip.id);
                    const width = Math.max(6, duration * zoom);
                    const label = clip.name ?? asset?.name ?? clip.text?.text ?? clip.motif?.type ?? 'Clip';
                    const baseColor = clip.kind === 'text' ? 'bg-mind/25 border-mind/50' : clip.kind === 'motif' ? 'bg-pulse/25 border-pulse/50' : track.kind === 'audio' ? 'bg-pulse/20 border-pulse/40' : 'bg-ink-600 border-line-bright';
                    const labelColor = clip.label ? LABEL_COLORS[clip.label.toLowerCase()] : undefined;
                    return (
                      <div
                        key={clip.id}
                        className={`cf-clip absolute top-1 rounded border overflow-hidden no-select ${baseColor} ${clip.locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'} ${selected ? 'ring-2 ring-signal brightness-110' : ''} ${isDrag ? 'opacity-80 z-10' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80`}
                        style={{ left: start * zoom, width, height: trackH - 8 }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${label}, ${fmt(start)} to ${fmt(start + duration)} on ${track.name}${selected ? ', selected' : ''}${clip.locked ? ', locked' : ''}`}
                        onKeyDown={(e) => {
                          // Enter selects the focused clip. Space must keep
                          // propagating: a clip stays focused after ordinary
                          // mouse selection, and swallowing Space there would
                          // silently kill the global play/pause shortcut.
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!selection.includes(clip.id)) useStore.getState().select([clip.id]);
                          }
                        }}
                        onPointerDown={(e) => beginDrag(e, clip, 'move')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onContextMenu={(e) => onClipContextMenu(e, clip)}
                        title={label}
                      >
                        {(asset?.type === 'video' || asset?.type === 'image') && width > 50 && <Filmstrip clip={clip} asset={asset} width={width} />}
                        {asset && (asset.type === 'audio' || asset.hasAudio) && track.kind !== 'text' && <Waveform clip={clip} asset={asset} width={width} height={trackH - 8} />}
                        <div className="absolute top-0.5 left-1 right-1 text-[10px] text-paper truncate pointer-events-none drop-shadow">{label}</div>
                        {clip.speed !== 1 && <span className="absolute bottom-0.5 right-1 text-[9px] text-signal font-mono pointer-events-none">{clip.speed}×</span>}
                        {/* color label chip */}
                        {labelColor && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-[1px] pointer-events-none" style={{ background: labelColor }} title={`Label: ${clip.label}`} />}
                        {/* transition badges */}
                        {clip.transitionIn && clip.transitionIn.duration > 0 && (
                          <div
                            className="absolute top-0 left-0 w-0 h-0 pointer-events-none"
                            style={{ borderTop: `8px solid #4C9AFF`, borderRight: '8px solid transparent' }}
                            title={`Transition: ${clip.transitionIn.type} (${clip.transitionIn.duration}s)`}
                          />
                        )}
                        {clip.transitionOut && clip.transitionOut.duration > 0 && (
                          <div
                            className="absolute top-0 right-0 w-0 h-0 pointer-events-none"
                            style={{ borderTop: `8px solid #4C9AFF`, borderLeft: '8px solid transparent' }}
                            title={`Transition: ${clip.transitionOut.type} (${clip.transitionOut.duration}s)`}
                          />
                        )}
                        {/* keyframe diamonds at real clip-local times — draggable to retime */}
                        {clip.keyframes.length > 0 && clip.keyframes.map((kf) => {
                          const shownT = kfDrag?.clipId === clip.id && kfDrag.kfId === kf.id ? kfDrag.time : kf.time;
                          return (
                            <div
                              key={kf.id}
                              className="cf-kf"
                              style={{ left: Math.max(0, Math.min(width - 16, shownT * zoom - 8)) }}
                              onPointerDown={(e) => beginKfDrag(e, clip, kf.id, kf.time)}
                              onPointerMove={moveKfDrag}
                              onPointerUp={endKfDrag}
                              onPointerCancel={endKfDrag}
                              title={`Keyframe @ ${shownT.toFixed(2)}s (${kf.path}) — drag to retime`}
                            >
                              <span />
                            </div>
                          );
                        })}
                        {/* locked overlay */}
                        {clip.locked && (
                          <div
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: 'repeating-linear-gradient(45deg, rgba(232,237,247,0.07) 0 4px, transparent 4px 9px)' }}
                          />
                        )}
                        {/* trim handles */}
                        <div className="cf-trim" onPointerDown={(e) => beginDrag(e, clip, 'trim-l')} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
                        <div className="cf-trim" style={{ left: 'auto', right: 0 }} onPointerDown={(e) => beginDrag(e, clip, 'trim-r')} onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {renderNewTrackGhost('below')}

          {/* First-run hint: the empty timeline is a drop target, not a dead end. */}
          {project.clips.length === 0 && !drag && !dropHint && (
            <div className="absolute z-20 pointer-events-none" style={{ left: HEADER_W + 16, right: 16, top: RULER_H + 16 }}>
              <div className="mx-auto max-w-md rounded-xl border border-dashed border-line-bright bg-ink-900/85 backdrop-blur-sm px-4 py-3 text-center shadow-panel">
                <div className="text-xs font-medium text-paper">Drop media on a track to start</div>
                <div className="text-[11px] text-paper-faint mt-0.5">or double-click a clip in the Media panel · Ctrl+/ finds every tool</div>
              </div>
            </div>
          )}

          {/* snapping feedback line */}
          {snapLine != null && (
            <div
              className="absolute top-0 bottom-0 z-[35] pointer-events-none border-l border-dashed border-signal"
              style={{ left: HEADER_W + snapLine * zoom, boxShadow: '0 0 6px rgba(76,154,255,0.35)' }}
            />
          )}

          {/* drop-time indicator line while dragging from the media panel */}
          {dropHint != null && (
            <div
              className="absolute top-0 bottom-0 z-[35] pointer-events-none w-px bg-signal"
              style={{ left: HEADER_W + dropHint.time * zoom, boxShadow: '0 0 6px rgba(76,154,255,0.35)' }}
            />
          )}

          {/* marquee selection rectangle */}
          {marquee != null && (
            <div
              className="absolute z-[38] pointer-events-none border border-signal bg-signal/10 rounded-sm"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
              }}
            />
          )}

          {/* playhead */}
          <div className="absolute top-0 bottom-0 z-40 pointer-events-none" style={{ left: HEADER_W + playhead * zoom }}>
            <div className="w-px h-full bg-paper" style={{ boxShadow: '0 0 6px rgba(255,255,255,0.25)' }} />
            <div className="absolute top-0 -translate-x-1/2 w-0 h-0" style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #FB7185' }} />
          </div>
        </div>
      </div>

      {ctxMenu && <ClipContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />}
    </div>
  );
}
