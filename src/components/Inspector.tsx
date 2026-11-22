import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Diamond, Lock, Unlock, Sparkles, RotateCcw, X, Palette } from 'lucide-react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { resolvedTransform, clipVolumeAt, getMedia, COLOR_PRESETS, BLEND_MODES, speedPointsOf, avgSpeed, parseCube, type Clip, type Effect, type EffectType, type Easing, type Transform, type Transition, type Aspect, type Action, type BlendMode, type SpeedPoint, ASPECT_SIZES } from '../../engine';

const EASINGS: Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack', 'easeOutExpo'];

/** 'color-dodge' → 'Color Dodge' for the blend-mode dropdown. */
const titleCase = (m: string) => m.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** Animatable keyframe paths offered in the dropdown (matches engine render). */
const KF_PATHS = ['transform.scale', 'transform.x', 'transform.y', 'transform.rotation', 'transform.skewX', 'transform.skewY', 'transform.opacity', 'volume'] as const;

/** One-click animation presets. Each builds REAL keyframes at clip-local
 * times — fully editable after, exactly like hand-made diamonds. Paths listed
 * are replaced when the preset is applied (one commit = one undo step). */
type PresetKf = { path: string; time: number; value: number; easing: Easing };
interface AnimPreset {
  id: string;
  label: string;
  hint: string;
  build: (dur: number, W: number, H: number, base: Transform) => { paths: string[]; kfs: PresetKf[] };
}
const ANIM_PRESETS: AnimPreset[] = [
  {
    id: 'kb-in', label: 'Ken Burns In', hint: 'Slow zoom in across the whole clip',
    build: (d, _W, _H, b) => ({ paths: ['transform.scale'], kfs: [
      { path: 'transform.scale', time: 0, value: b.scale, easing: 'easeInOut' },
      { path: 'transform.scale', time: d, value: b.scale * 1.25, easing: 'easeInOut' },
    ] }),
  },
  {
    id: 'kb-out', label: 'Ken Burns Out', hint: 'Slow zoom out across the whole clip',
    build: (d, _W, _H, b) => ({ paths: ['transform.scale'], kfs: [
      { path: 'transform.scale', time: 0, value: b.scale * 1.25, easing: 'easeInOut' },
      { path: 'transform.scale', time: d, value: b.scale, easing: 'easeInOut' },
    ] }),
  },
  {
    id: 'pan-right', label: 'Pan Right', hint: 'Drift right across the whole clip',
    build: (d, W, _H, b) => ({ paths: ['transform.x'], kfs: [
      { path: 'transform.x', time: 0, value: b.x - W * 0.08, easing: 'easeInOut' },
      { path: 'transform.x', time: d, value: b.x + W * 0.08, easing: 'easeInOut' },
    ] }),
  },
  {
    id: 'pan-left', label: 'Pan Left', hint: 'Drift left across the whole clip',
    build: (d, W, _H, b) => ({ paths: ['transform.x'], kfs: [
      { path: 'transform.x', time: 0, value: b.x + W * 0.08, easing: 'easeInOut' },
      { path: 'transform.x', time: d, value: b.x - W * 0.08, easing: 'easeInOut' },
    ] }),
  },
  {
    id: 'slide-in', label: 'Slide In', hint: 'Fly in from the left at the start',
    build: (d, W, _H, b) => { const t = Math.min(0.6, d * 0.5); return { paths: ['transform.x'], kfs: [
      { path: 'transform.x', time: 0, value: b.x - W, easing: 'easeOut' },
      { path: 'transform.x', time: t, value: b.x, easing: 'easeOut' },
    ] }; },
  },
  {
    id: 'pop-in', label: 'Pop In', hint: 'Overshoot scale at the start (back easing)',
    build: (d, _W, _H, b) => ({ paths: ['transform.scale'], kfs: [
      { path: 'transform.scale', time: 0, value: 0, easing: 'easeOutBack' },
      { path: 'transform.scale', time: Math.min(0.35, d * 0.4), value: b.scale * 1.12, easing: 'easeOutBack' },
      { path: 'transform.scale', time: Math.min(0.5, d * 0.6), value: b.scale, easing: 'easeOut' },
    ] }),
  },
  {
    id: 'bounce-in', label: 'Bounce In', hint: 'Springy multi-bounce at the start',
    build: (d, _W, _H, b) => ({ paths: ['transform.scale'], kfs: [
      { path: 'transform.scale', time: 0, value: 0, easing: 'easeOut' },
      { path: 'transform.scale', time: Math.min(0.3, d * 0.3), value: b.scale * 1.15, easing: 'easeOut' },
      { path: 'transform.scale', time: Math.min(0.5, d * 0.5), value: b.scale * 0.9, easing: 'easeInOut' },
      { path: 'transform.scale', time: Math.min(0.7, d * 0.7), value: b.scale * 1.05, easing: 'easeOut' },
      { path: 'transform.scale', time: Math.min(0.9, d * 0.9), value: b.scale, easing: 'easeOut' },
    ] }),
  },
  {
    id: 'fly-out', label: 'Fly Out', hint: 'Exit to the right at the end',
    build: (d, W, _H, b) => { const t0 = Math.max(0.1, d - 0.6); return { paths: ['transform.x'], kfs: [
      { path: 'transform.x', time: t0, value: b.x, easing: 'easeIn' },
      { path: 'transform.x', time: d, value: b.x + W, easing: 'easeIn' },
    ] }; },
  },
  {
    id: 'fade-in', label: 'Fade In', hint: 'Visual fade from black at the start',
    build: (d, _W, _H, _b) => { const t = Math.min(0.5, d * 0.4); return { paths: ['transform.opacity'], kfs: [
      { path: 'transform.opacity', time: 0, value: 0, easing: 'easeOut' },
      { path: 'transform.opacity', time: t, value: 1, easing: 'easeOut' },
    ] }; },
  },
  {
    id: 'fade-out', label: 'Fade Out', hint: 'Visual fade to black at the end',
    build: (d, _W, _H, _b) => { const t0 = Math.max(0, d - Math.min(0.5, d * 0.4)); return { paths: ['transform.opacity'], kfs: [
      { path: 'transform.opacity', time: t0, value: 1, easing: 'easeIn' },
      { path: 'transform.opacity', time: d, value: 0, easing: 'easeIn' },
    ] }; },
  },
  {
    id: 'spin', label: 'Spin', hint: 'One full 360° rotation across the clip',
    build: (d, _W, _H, b) => ({ paths: ['transform.rotation'], kfs: [
      { path: 'transform.rotation', time: 0, value: b.rotation, easing: 'linear' },
      { path: 'transform.rotation', time: d, value: b.rotation + 360, easing: 'linear' },
    ] }),
  },
  {
    id: 'pulse', label: 'Pulse', hint: 'Gentle breathing zoom, one cycle per clip',
    build: (d, _W, _H, b) => ({ paths: ['transform.scale'], kfs: [
      { path: 'transform.scale', time: 0, value: b.scale, easing: 'easeInOut' },
      { path: 'transform.scale', time: d / 4, value: b.scale * 1.06, easing: 'easeInOut' },
      { path: 'transform.scale', time: d / 2, value: b.scale, easing: 'easeInOut' },
      { path: 'transform.scale', time: (d * 3) / 4, value: b.scale * 1.06, easing: 'easeInOut' },
      { path: 'transform.scale', time: d, value: b.scale, easing: 'easeInOut' },
    ] }),
  },
  {
    id: 'shake', label: 'Shake', hint: 'Quick horizontal camera shake at the start',
    build: (d, W, _H, b) => { const j = W * 0.012; const t = (f: number) => f * Math.min(0.5, d * 0.6); return { paths: ['transform.x'], kfs: [
      { path: 'transform.x', time: t(0), value: b.x, easing: 'linear' },
      { path: 'transform.x', time: t(0.2), value: b.x + j, easing: 'linear' },
      { path: 'transform.x', time: t(0.4), value: b.x - j, easing: 'linear' },
      { path: 'transform.x', time: t(0.6), value: b.x + j * 0.7, easing: 'linear' },
      { path: 'transform.x', time: t(0.8), value: b.x - j * 0.5, easing: 'linear' },
      { path: 'transform.x', time: t(1), value: b.x, easing: 'linear' },
    ] }; },
  },
  {
    id: 'tilt-settle', label: 'Tilt Settle', hint: 'Skewed entry that straightens (uses Skew X)',
    build: (d, _W, _H, b) => { const t = Math.min(0.7, d * 0.5); return { paths: ['transform.skewX', 'transform.scale'], kfs: [
      { path: 'transform.skewX', time: 0, value: 18, easing: 'easeOut' },
      { path: 'transform.skewX', time: t, value: 0, easing: 'easeOut' },
      { path: 'transform.scale', time: 0, value: b.scale * 1.06, easing: 'easeOut' },
      { path: 'transform.scale', time: t, value: b.scale, easing: 'easeOut' },
    ] }; },
  },
];
const EFFECT_DEFAULTS: Record<string, Record<string, number | string | boolean>> = {
  color: { brightness: 1, contrast: 1, saturation: 1, temperature: 0 },
  blur: { amount: 4 },
  sharpen: { amount: 0.5 },
  vignette: { amount: 0.5 },
  chromaKey: { color: '#00FF00', tolerance: 0.28, softness: 0.12 },
  eq: { highpass: 80, lowpass: 0, gain: 0 },
  gate: { thresholdDb: -45 },
  deess: { reduction: 4 },
  denoise: { thresholdDb: -45 },
  negate: { invert: 1 },
  normalize: { strength: 0.8 },
  compressor: { thresholdDb: -24, ratio: 4 },
  limiter: { ceilingDb: -1 },
  echo: { delayMs: 250, feedback: 0.3, mix: 0.35 },
  pan: { pan: 0 },
};
const RANGES: Record<string, [number, number, number]> = {
  brightness: [0.4, 1.8, 0.01], contrast: [0.4, 1.8, 0.01], saturation: [0, 2, 0.01],
  temperature: [-1, 1, 0.01], grayscale: [0, 1, 0.01], sepia: [0, 1, 0.01], hue: [-180, 180, 1],
  amount: [0, 20, 0.1], tolerance: [0, 1, 0.01], softness: [0, 1, 0.01], thresholdDb: [-70, 0, 1],
  highpass: [0, 400, 1], lowpass: [0, 20000, 10], gain: [-20, 20, 0.5], reduction: [0, 20, 0.5],
  invert: [0, 1, 0.05], strength: [0, 1, 0.05], ratio: [1, 20, 0.5], ceilingDb: [-24, 0, 0.5],
  delayMs: [10, 1000, 10], feedback: [0, 0.9, 0.05], mix: [0, 1, 0.05], pan: [-1, 1, 0.05],
};
const TRANSITIONS: Transition['type'][] = ['crossfade', 'dip-black', 'dip-white', 'wipe-left', 'slide-left', 'zoom-in'];
const ANIMATIONS = ['none', 'pop', 'fade', 'rise', 'typewriter'] as const;
const PRESETS = ['clean', 'karaoke', 'bold-keywords', 'word-pop'] as const;
const VISUAL_EFFECTS: EffectType[] = ['blur', 'sharpen', 'vignette', 'chromaKey', 'negate', 'normalize'];
const AUDIO_EFFECTS: EffectType[] = ['eq', 'gate', 'deess', 'denoise', 'compressor', 'limiter', 'echo', 'pan'];
const COLOR_PARAMS = ['brightness', 'contrast', 'saturation', 'temperature'] as const;

type Tab = 'video' | 'audio' | 'color' | 'text' | 'animation' | 'effects' | 'speed' | 'mask' | 'ai';
const TABS: { id: Tab; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'color', label: 'Color' },
  { id: 'text', label: 'Text' },
  { id: 'animation', label: 'Animation' },
  { id: 'effects', label: 'Effects' },
  { id: 'speed', label: 'Speed' },
  { id: 'mask', label: 'Mask' },
  { id: 'ai', label: 'AI' },
];

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-0.5"><span className="text-paper-dim">{label}</span><span className="text-paper font-mono tabular-nums">{fmt ? fmt(value) : value.toFixed(2)}</span></div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="p-3 border-b border-line">
      <div className="flex items-center justify-between mb-2">
        <span className="label mb-0">{title}</span>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const playhead = useStore((s) => s.playhead);
  const [tab, setTab] = useState<Tab>('video');
  const [newVisualEffect, setNewVisualEffect] = useState<EffectType>('blur');
  const [newAudioEffect, setNewAudioEffect] = useState<EffectType>('eq');
  const [kfPath, setKfPath] = useState('transform.scale');

  const set = (actions: Action[], label: string, key?: string) =>
    useStore.getState().commit(actions, label, 'human', key);

  const clip = selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
  const asset = clip ? getMedia(project, clip.mediaId) : undefined;

  // Context-sensitive tool tabs: only show what applies to this clip kind.
  const relevantTabs: Tab[] = !clip
    ? TABS.map((t) => t.id)
    : clip.kind === 'text'
      ? ['text', 'animation', 'ai']
      : clip.kind === 'motif'
        ? ['animation', 'ai']
        : asset && (asset.type === 'audio' || !asset.hasAudio)
          ? asset.type === 'audio'
            ? ['audio', 'effects', 'speed', 'ai']
            : ['video', 'color', 'animation', 'effects', 'speed', 'mask', 'ai'] // image / silent video
          : ['video', 'audio', 'color', 'animation', 'effects', 'speed', 'mask', 'ai'];

  // Auto-switch to the most relevant tab when the selection changes.
  useEffect(() => {
    if (!clip) return;
    setTab((prev) => (relevantTabs.includes(prev) ? prev : relevantTabs[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, clip?.kind]);

  if (!clip) {
    return <ProjectInspector />;
  }
  const localT = Math.max(0, Math.min(playhead - clip.start, clip.duration));
  const tf = resolvedTransform(clip, localT);
  const vol = clipVolumeAt(clip, localT);
  const id = clip.id;
  const isText = clip.kind === 'text';

  const addKeyframe = (path: string, value: number) => {
    set([{ type: 'add_keyframe', clipId: id, path, time: localT, value, easing: 'easeInOut' }], 'Add keyframe');
  };

  /** Apply an animation preset: replace keyframes on the paths it owns and add
   * the preset's real, editable keyframes — all in ONE commit (one undo step). */
  const applyAnimPreset = (p: AnimPreset) => {
    const d = Math.max(0.1, clip.duration);
    const { paths, kfs } = p.build(d, project.settings.width, project.settings.height, clip.transform);
    const actions: Action[] = clip.keyframes
      .filter((k) => paths.includes(k.path))
      .map((k) => ({ type: 'remove_keyframe' as const, clipId: id, keyframeId: k.id }));
    for (const k of kfs) actions.push({ type: 'add_keyframe', clipId: id, path: k.path, time: k.time, value: k.value, easing: k.easing });
    set(actions, `Preset: ${p.label}`);
  };

  /** Current resolved value per keyframe path (for the add-keyframe button). */
  const KF_VALUES: Record<string, number> = {
    'transform.scale': tf.scale, 'transform.x': tf.x, 'transform.y': tf.y,
    'transform.rotation': tf.rotation, 'transform.skewX': tf.skewX, 'transform.skewY': tf.skewY,
    'transform.opacity': tf.opacity, volume: vol,
  };

  const colorEffect = clip.effects.find((e) => e.type === 'color');
  const cp = (colorEffect?.params ?? EFFECT_DEFAULTS.color) as Record<string, number>;

  // Add-if-missing: one commit adds the color effect with the merged params.
  const setColorParam = (k: string, v: number) => {
    if (colorEffect) set([{ type: 'set_effect', clipId: id, effectId: colorEffect.id, params: { [k]: v } }], 'Color', `${colorEffect.id}:${k}`);
    else set([{ type: 'add_effect', clipId: id, effect: { type: 'color', enabled: true, params: { ...EFFECT_DEFAULTS.color, [k]: v } } }], 'Add color effect');
  };
  const applyColorPreset = (preset: string) => {
    const params = COLOR_PRESETS[preset].params;
    if (colorEffect) set([{ type: 'set_effect', clipId: id, effectId: colorEffect.id, params }], `Color preset: ${preset}`);
    else set([{ type: 'add_effect', clipId: id, effect: { type: 'color', enabled: true, params: { ...params } } }], `Color preset: ${preset}`);
  };

  /** Master lift/gamma/gain: writes the same value to all three channels. */
  const setLgg = (which: 'lift' | 'gamma' | 'gain', v: number) => {
    const params: Record<string, number> = {
      [`${which}_r`]: v, [`${which}_g`]: v, [`${which}_b`]: v,
    };
    if (colorEffect) set([{ type: 'set_effect', clipId: id, effectId: colorEffect.id, params }], `Color ${which}`, `${colorEffect.id}:${which}`);
    else set([{ type: 'add_effect', clipId: id, effect: { type: 'color', enabled: true, params: { ...EFFECT_DEFAULTS.color, ...params } } }], 'Add color effect');
  };

  const addEffectOfType = (t: EffectType) =>
    set([{ type: 'add_effect', clipId: id, effect: { type: t, enabled: true, params: { ...EFFECT_DEFAULTS[t] } } }], 'Add effect');

  const runTool = async (name: string, params: Record<string, unknown> = {}) => {
    try {
      const result = await useStore.getState().applyTool(name, params, 'human');
      return `${name}: ${result.summary}`;
    } catch (e) {
      return `${name} failed: ${(e as Error).message}`;
    }
  };

  return (
    <div>
      <div className="p-3 border-b border-line flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {/* key by clip id: without it, React keeps the stale DOM value when the
              selection changes and blur commits the old name onto the new clip */}
          <input key={clip.id} className="field py-1 text-xs" defaultValue={clip.name ?? ''} placeholder={isText ? 'Text clip' : 'Clip name'}
            onBlur={(e) => set([{ type: 'set_clip_props', clipId: id, patch: { name: e.target.value } }], 'Rename clip')} />
        </div>
        <button className="icon-btn" onClick={() => set([{ type: 'set_clip_props', clipId: id, patch: { locked: !clip.locked } }], 'Lock clip')} title="Lock clip">
          {clip.locked ? <Lock size={14} className="text-heat-amber" /> : <Unlock size={14} />}
        </button>
      </div>

      <div className="border-b border-line px-1.5 py-1 flex gap-0.5 overflow-x-auto">
        {TABS.filter((t) => relevantTabs.includes(t.id)).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.label}
            className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap transition-colors ${tab === t.id ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'video' && (
        <>
          <Section title="Transform" action={<button className="icon-btn p-0.5" title="Keyframe scale at playhead" onClick={() => addKeyframe('transform.scale', tf.scale)}><Diamond size={12} /></button>}>
            <Slider label="Scale" value={tf.scale} min={0.2} max={3} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { scale: v } }], 'Scale', `${id}:scale`)} />
            <Slider label="Position X" value={tf.x} min={-project.settings.width} max={project.settings.width} step={1} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { x: v } }], 'Move X', `${id}:x`)} />
            <Slider label="Position Y" value={tf.y} min={-project.settings.height} max={project.settings.height} step={1} fmt={(v) => `${Math.round(v)}px`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { y: v } }], 'Move Y', `${id}:y`)} />
            <Slider label="Rotation" value={tf.rotation} min={-180} max={180} step={1} fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { rotation: v } }], 'Rotate', `${id}:rot`)} />
            <Slider label="Skew X" value={tf.skewX} min={-60} max={60} step={0.5} fmt={(v) => `${v.toFixed(1)}°`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { skewX: v } }], 'Skew X', `${id}:skx`)} />
            <Slider label="Skew Y" value={tf.skewY} min={-60} max={60} step={0.5} fmt={(v) => `${v.toFixed(1)}°`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { skewY: v } }], 'Skew Y', `${id}:sky`)} />
            <Slider label="Opacity" value={tf.opacity} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set([{ type: 'set_transform', clipId: id, patch: { opacity: v } }], 'Opacity', `${id}:op`)} />
          </Section>

          <Section title="Frame">
            <div><span className="label">Fit</span>
              <select className="field cursor-pointer" value={clip.fit} onChange={(e) => set([{ type: 'set_clip_props', clipId: id, patch: { fit: e.target.value as Clip['fit'] } }], 'Fit mode')}>
                {['cover', 'contain', 'fill'].map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </Section>

          <Section title="Blend">
            <div>
              <span className="label">Blend mode</span>
              <div className="flex items-center gap-1">
                <select className="field cursor-pointer flex-1" value={clip.blendMode ?? 'normal'}
                  onChange={(e) => set([{ type: 'set_clip_props', clipId: id, patch: { blendMode: e.target.value === 'normal' ? undefined : e.target.value as BlendMode } }], 'Blend mode')}>
                  {BLEND_MODES.map((m) => <option key={m} value={m}>{titleCase(m)}</option>)}
                </select>
                {clip.blendMode && clip.blendMode !== 'normal' && (
                  <button className="icon-btn p-1" title="Reset blend mode to Normal"
                    onClick={() => set([{ type: 'set_clip_props', clipId: id, patch: { blendMode: undefined } }], 'Reset blend mode')}>
                    <RotateCcw size={13} />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-paper-faint mt-1">Applies where this clip overlaps the clip(s) below.</p>
            </div>
          </Section>

          <Section title="Transitions">
            {(['in', 'out'] as const).map((edge) => {
              const tr = edge === 'in' ? clip.transitionIn : clip.transitionOut;
              return (
                <div key={edge} className="flex items-center gap-2">
                  <span className="text-[11px] text-paper-dim w-8 capitalize">{edge}</span>
                  <select className="field py-1 text-xs cursor-pointer flex-1" value={tr?.type ?? ''} onChange={(e) => {
                    const type = e.target.value as Transition['type'];
                    set([{ type: 'set_transition', clipId: id, edge, transition: type ? { type, duration: tr?.duration ?? 0.4 } : undefined }], 'Transition');
                  }}>
                    <option value="">None</option>
                    {TRANSITIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {tr && <input type="number" className="field py-1 text-xs w-16" step={0.05} min={0.1} max={2} value={tr.duration} onChange={(e) => set([{ type: 'set_transition', clipId: id, edge, transition: { type: tr.type, duration: Number(e.target.value) } }], 'Transition duration', `${id}:tr${edge}`)} />}
                </div>
              );
            })}
          </Section>
        </>
      )}

      {tab === 'audio' && (
        <>
          <Section title="Audio">
            <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set([{ type: 'set_clip_props', clipId: id, patch: { volume: v } }], 'Volume', `${id}:vol`)} />
            <Slider label="Fade in" value={clip.fades.in} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => set([{ type: 'set_fades', clipId: id, fadeIn: v }], 'Fade in', `${id}:fi`)} />
            <Slider label="Fade out" value={clip.fades.out} min={0} max={3} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} onChange={(v) => set([{ type: 'set_fades', clipId: id, fadeOut: v }], 'Fade out', `${id}:fo`)} />
            {asset && asset.type === 'video' && (
              <div className="pt-1">
                <button className="btn-ghost text-[11px] px-2 py-1 w-full justify-center"
                  title="Detach this video's audio to its own audio clip (original is muted)"
                  onClick={() => {
                    const s = useStore.getState();
                    void s.extractAudio(id).then((status) => {
                      const ui = useUI.getState();
                      if (status === 'ok') ui.toast('Audio extracted to a new audio clip');
                      else if (status === 'undecodable') ui.toast(`Cannot extract: browser cannot decode ${asset.name}'s audio (e.g. AC3)`, 'error');
                      else if (status === 'no-buffer') ui.toast('Audio is still decoding — try again in a moment', 'error');
                      else if (status === 'no-clip') ui.toast('Clip not found', 'error');
                    });
                  }}>
                  Extract audio to new clip
                </button>
              </div>
            )}
          </Section>
          <Section title="Audio effects" action={
            <div className="flex items-center gap-1">
              <select className="field py-0.5 text-[11px] w-auto cursor-pointer" value={newAudioEffect} onChange={(e) => setNewAudioEffect(e.target.value as EffectType)}>
                {AUDIO_EFFECTS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="icon-btn p-0.5" title="Add audio effect" onClick={() => addEffectOfType(newAudioEffect)}><Plus size={13} /></button>
            </div>
          }>
            {clip.effects.filter((e) => AUDIO_EFFECTS.includes(e.type)).length === 0 && <p className="text-[11px] text-paper-faint">No audio effects. Add one above.</p>}
            {clip.effects.filter((e) => AUDIO_EFFECTS.includes(e.type)).map((ef) => (
              <EffectRow key={ef.id} clipId={id} effect={ef} />
            ))}
          </Section>
        </>
      )}

      {tab === 'color' && (
        <Section title="Color">
          <div className="flex flex-wrap gap-1">
            {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
              <button key={key} className="chip bg-ink-850 border border-line text-paper-dim hover:text-paper hover:bg-ink-750 cursor-pointer" title={preset.name}
                onClick={() => applyColorPreset(key)}>{preset.name}</button>
            ))}
          </div>
          {COLOR_PARAMS.map((k) => {
            const [min, max, step] = RANGES[k];
            return <Slider key={k} label={k} value={cp[k] ?? (EFFECT_DEFAULTS.color as Record<string, number>)[k]} min={min} max={max} step={step} onChange={(v) => setColorParam(k, v)} />;
          })}
          {/* Lift/gamma/gain (Kdenlive-style) — master sliders set all channels;
              per-channel control is in the Color workspace grade panel. */}
          <div className="border-t border-line pt-2 mt-1">
            <span className="label">Shadows · Mids · Highlights</span>
            <Slider label="Lift (shadows)" value={(cp.lift_r ?? 0)} min={-0.5} max={0.5} step={0.005} fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`} onChange={(v) => setLgg('lift', v)} />
            <Slider label="Gamma (mids)" value={(cp.gamma_r ?? 1)} min={0.2} max={2.5} step={0.01} onChange={(v) => setLgg('gamma', v)} />
            <Slider label="Gain (highlights)" value={(cp.gain_r ?? 1)} min={0} max={2} step={0.01} onChange={(v) => setLgg('gain', v)} />
          </div>
          <LutSection clipId={id} clipEffects={clip.effects} />
        </Section>
      )}

      {tab === 'text' && isText && clip.text && (
        <Section title="Text">
          {/* key by clip id so a selection change resets the field instead of
              committing the previous clip's text onto the new clip on blur */}
          <textarea key={clip.id} className="field resize-none text-xs" rows={2} defaultValue={clip.text.text}
            onBlur={(e) => set([{ type: 'set_text', clipId: id, text: e.target.value }], 'Edit text')} />
          <div>
            <span className="label">Preset</span>
            <select className="field cursor-pointer" value={clip.text.style.preset} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { preset: e.target.value as any } }], 'Caption preset')}>
              {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <Slider label="Font size" value={clip.text.style.fontSize} min={0.02} max={0.14} step={0.002} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set([{ type: 'set_text_style', clipId: id, patch: { fontSize: v } }], 'Font size', `${id}:fs`)} />
          <div className="grid grid-cols-3 gap-2">
            <div><span className="label">Color</span><input type="color" value={clip.text.style.color} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { color: e.target.value } }], 'Text color', `${id}:color`)} /></div>
            <div><span className="label">Highlight</span><input type="color" value={clip.text.style.highlightColor} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { highlightColor: e.target.value } }], 'Highlight', `${id}:hl`)} /></div>
            <div><span className="label">Outline</span><input type="color" value={clip.text.style.outlineColor} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { outlineColor: e.target.value } }], 'Outline', `${id}:ol`)} /></div>
          </div>
          <Slider label="Position X" value={clip.text.style.x} min={0} max={1} step={0.01} onChange={(v) => set([{ type: 'set_text_style', clipId: id, patch: { x: v } }], 'Text X', `${id}:tx`)} />
          <Slider label="Position Y" value={clip.text.style.y} min={0} max={1} step={0.01} onChange={(v) => set([{ type: 'set_text_style', clipId: id, patch: { y: v } }], 'Text Y', `${id}:ty`)} />
          <div><span className="label">Align</span>
            <select className="field cursor-pointer" value={clip.text.style.align} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { align: e.target.value as any } }], 'Text align')}>
              {['left', 'center', 'right'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-paper-dim cursor-pointer">
            <input type="checkbox" className="accent-signal w-3.5 h-3.5" checked={clip.text.style.uppercase} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { uppercase: e.target.checked } }], 'Uppercase')} /> Uppercase
          </label>
        </Section>
      )}
      {tab === 'text' && !isText && (
        <div className="p-3 text-[11px] text-paper-faint">Text styling is only available for text clips.</div>
      )}

      {tab === 'animation' && (
        <>
          {isText && clip.text && (
            <Section title="Text animation">
              <select className="field cursor-pointer" value={clip.text.style.animation} onChange={(e) => set([{ type: 'set_text_style', clipId: id, patch: { animation: e.target.value as any } }], 'Text animation')}>
                {ANIMATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Section>
          )}
          <Section title="Presets" action={<Sparkles size={13} className="text-signal" />}>
            <div className="grid grid-cols-2 gap-1">
              {ANIM_PRESETS.map((p) => (
                <button key={p.id} className="chip bg-ink-850 border border-line text-paper-dim hover:text-paper hover:bg-ink-750 cursor-pointer truncate" title={p.hint}
                  onClick={() => applyAnimPreset(p)}>{p.label}</button>
              ))}
            </div>
            <p className="text-[11px] text-paper-faint">
              Presets write REAL keyframes — every diamond below stays fully editable afterwards. A preset replaces keyframes only on the properties it animates, in one undo step.
            </p>
          </Section>
          <Section title="Keyframes" action={
            <div className="flex items-center gap-1">
              <select className="field py-0.5 text-[11px] w-auto cursor-pointer" value={kfPath} onChange={(e) => setKfPath(e.target.value)}>
                {KF_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button className="icon-btn p-0.5" title="Add keyframe at playhead" onClick={() => addKeyframe(kfPath, KF_VALUES[kfPath])}><Diamond size={13} /></button>
            </div>
          }>
            {clip.keyframes.length === 0 && <p className="text-[11px] text-paper-faint">No keyframes. Add one at the playhead, then move the playhead and change the value to animate.</p>}
            <div className="space-y-1">
              {[...clip.keyframes].sort((a, b) => a.time - b.time).map((k) => (
                <div key={k.id} className="flex items-center gap-1.5 text-[11px] bg-ink-850 rounded-md px-2 py-1 border border-line">
                  <Diamond size={10} className="text-signal shrink-0" />
                  <span className="text-paper-dim font-mono">{k.time.toFixed(2)}s</span>
                  <span className="text-paper truncate flex-1">{k.path.split('.').pop()} = {k.value.toFixed(2)}</span>
                  <select className="bg-transparent text-[10px] text-paper-faint cursor-pointer" value={k.easing} onChange={(e) => set([{ type: 'remove_keyframe', clipId: id, keyframeId: k.id }, { type: 'add_keyframe', clipId: id, path: k.path, time: k.time, value: k.value, easing: e.target.value as Easing }], 'Keyframe easing')}>
                    {EASINGS.map((ea) => <option key={ea} value={ea}>{ea}</option>)}
                  </select>
                  <button className="icon-btn p-0.5 hover:text-heat" onClick={() => set([{ type: 'remove_keyframe', clipId: id, keyframeId: k.id }], 'Remove keyframe')}><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {tab === 'effects' && (
        <Section title="Effects" action={
          <div className="flex items-center gap-1">
            <select className="field py-0.5 text-[11px] w-auto cursor-pointer" value={newVisualEffect} onChange={(e) => setNewVisualEffect(e.target.value as EffectType)}>
              {VISUAL_EFFECTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="icon-btn p-0.5" title="Add effect" onClick={() => addEffectOfType(newVisualEffect)}><Plus size={13} /></button>
          </div>
        }>
          {clip.effects.filter((e) => VISUAL_EFFECTS.includes(e.type)).length === 0 && <p className="text-[11px] text-paper-faint">No effects. Add one above. Color lives in the Color tab; audio effects in the Audio tab.</p>}
          {clip.effects.filter((e) => VISUAL_EFFECTS.includes(e.type)).map((ef) => (
            <EffectRow key={ef.id} clipId={id} effect={ef} />
          ))}
        </Section>
      )}

      {tab === 'speed' && clip.kind === 'media' && (() => {
        const ramp = speedPointsOf(clip);
        return (
          <>
            <Section title="Speed">
              <div className="flex flex-wrap gap-1">
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => (
                  <button key={s} className={`chip cursor-pointer border ${Math.abs(clip.speed - s) < 0.001 ? 'bg-ink-700 border-line text-paper' : 'bg-ink-850 border-line text-paper-dim hover:text-paper hover:bg-ink-750'}`}
                    onClick={() => set([{ type: 'set_speed', clipId: id, speed: s }], `Speed ${s}×`)}>{s}×</button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <input type="number" min={0.25} max={4} step={0.05} className="field flex-1 min-w-0 py-1 text-xs" placeholder="Custom speed"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const v = Number((e.target as HTMLInputElement).value);
                    if (v >= 0.25 && v <= 4) set([{ type: 'set_speed', clipId: id, speed: v }], `Speed ${v}×`);
                  }} />
                <button className="btn-solid text-[11px] px-2" title="Apply the entered speed"
                  onClick={(e) => {
                    const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                    const v = Number(input.value);
                    if (v >= 0.25 && v <= 4) set([{ type: 'set_speed', clipId: id, speed: v }], `Speed ${v}×`);
                  }}>Set</button>
              </div>
              <button className="btn-ghost text-[11px] px-2 py-1 w-full justify-center"
                title="Apply this clip's speed to every selected media clip"
                onClick={() => {
                  const s = useStore.getState();
                  const selected = s.project.clips.filter((c) => c.kind === 'media' && s.selection.includes(c.id));
                  set(selected.map((c) => ({ type: 'set_speed' as const, clipId: c.id, speed: clip.speed })), `Apply ${clip.speed}× to selected`);
                }}>
                Apply {clip.speed.toFixed(2)}× to selected clips
              </button>
              <button className={`btn-ghost text-[11px] px-2 py-1 w-full justify-center ${clip.preservePitch ? 'text-signal' : ''}`}
                title="Keep the original pitch when speed changes (preview and export)"
                onClick={() => set([{ type: 'set_clip_props', clipId: id, patch: { preservePitch: !clip.preservePitch } }], clip.preservePitch ? 'Pitch follows speed' : 'Preserve pitch')}>
                {clip.preservePitch ? '✓ Preserve pitch on' : 'Preserve pitch off'}
              </button>
              {/* Under a ramp the slider shows the ramp's average speed; moving it
                  writes a constant speed, which the engine turns into (clears the ramp). */}
              <Slider label="Speed" value={ramp ? avgSpeed(clip) : clip.speed} min={0.25} max={4} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => set([{ type: 'set_speed', clipId: id, speed: v }], 'Speed', `${id}:speed`)} />
              {ramp ? (
                <p className="text-[11px] text-paper-faint">A speed ramp is active — moving this slider sets a constant speed and clears the ramp.</p>
              ) : (
                <button className="btn-ghost text-[11px] px-2 py-1 w-full justify-center"
                  title={`Turn the current ${clip.speed.toFixed(2)}× constant speed into a 2-point ramp`}
                  onClick={() => set([{ type: 'set_speed_ramp', clipId: id, points: [{ t: 0, speed: clip.speed }, { t: clip.duration, speed: clip.speed }] }], 'Add speed ramp')}>
                  Add speed ramp
                </button>
              )}
              <button
                className={`btn-ghost text-[11px] px-2 py-1 w-full justify-center ${clip.reversed ? 'text-signal' : ''}`}
                title={clip.reversed
                  ? 'Reversed ON — the clip plays its source backward. Preview scrubs (browsers cannot play video elements backward); audio plays a genuinely reversed buffer.'
                  : 'Play this clip\'s source backward — classic reverse effect. Works with speed ramps too.'}
                onClick={() => set([{ type: 'set_clip_props', clipId: id, patch: { reversed: !clip.reversed } }], clip.reversed ? 'Forward playback' : 'Reverse clip')}>
                {clip.reversed ? '✓ Reversed — click for forward' : 'Reverse clip (play backward)'}
              </button>
              {clip.reversed && (
                <p className="text-[11px] text-heat-amber">Reversed: the preview scrubs frame-by-frame (browsers can't play video elements backward) and audio plays a real reversed buffer. Render/export match.</p>
              )}
            </Section>
            {ramp && (
              <Section title="Speed ramp" action={
                <button className="btn-ghost text-[10px] px-1.5 py-0.5" title="Back to constant speed (ramp average)"
                  onClick={() => set([{ type: 'set_speed', clipId: id, speed: avgSpeed(clip) }], 'Clear speed ramp')}>
                  Clear ramp
                </button>
              }>
                <RampEditor clipId={id} duration={clip.duration} points={ramp} />
                <p className="text-[11px] text-paper-faint">Drag dots to reshape · click empty space to add a point · double-click a dot (or ×) to remove one. Audio under a ramp plays at the ramp's average speed.</p>
              </Section>
            )}
          </>
        );
      })()}
      {tab === 'speed' && clip.kind !== 'media' && (
        <div className="p-3 text-[11px] text-paper-faint">Speed is not adjustable on text clips.</div>
      )}

      {tab === 'mask' && (
        <Section title="Masks">
          <ul className="space-y-1.5 text-[11px] text-paper-dim">
            <li>Shape masks (linear, circle, rectangle) — Not implemented yet.</li>
            <li>Chroma key (green screen) is available in the Effects tab.</li>
            <li>Rotoscope brush — Not possible in a browser (performance).</li>
          </ul>
        </Section>
      )}

      {tab === 'ai' && <AITab runTool={runTool} />}

      {!isText && (
        <div className="p-3 text-[11px] text-paper-faint">
          In point {clip.inPoint.toFixed(2)}s · duration {clip.duration.toFixed(2)}s · {clip.effects.length} effect{clip.effects.length === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function AITab({ runTool }: { runTool: (name: string, params?: Record<string, unknown>) => Promise<string> }) {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, params: Record<string, unknown> = {}) => {
    setBusy(name);
    setResult(null);
    const text = await runTool(name, params);
    setBusy(null);
    setResult(text);
  };

  const tools: { name: string; label: string; params?: Record<string, unknown> }[] = [
    { name: 'zoom_on_emphasis', label: 'Zoom on emphasis' },
    { name: 'add_transitions', label: 'Add transitions' },
    { name: 'apply_color_preset', label: 'Auto color look' },
  ];

  return (
    <Section title="AI tools" action={<Sparkles size={13} className="text-signal" />}>
      {tools.map((t) => (
        <button key={t.name} className="btn-solid w-full px-2 py-1.5 text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
          disabled={busy !== null} onClick={() => void run(t.name, t.params)}>
          {busy === t.name ? 'Running…' : t.label}
        </button>
      ))}
      <p className="text-[11px] text-paper-faint">
        {result ?? 'Run a tool on this clip. The result is applied as one undoable edit.'}
      </p>
    </Section>
  );
}

/** Color-LUT (.cube) panel for the Inspector's Color tab: import files,
 * apply/remove a LUT effect on the selected clip, strength + enable toggles.
 * Import + apply are separate commits — each is its own undo step. */
function LutSection({ clipId, clipEffects }: { clipId: string; clipEffects: Effect[] }) {
  const luts = useStore((s) => s.project.luts ?? []);
  const commit = useStore((s) => s.commit);
  const ui = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const lutEffects = clipEffects.filter((e) => e.type === 'lut');

  const importLut = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!/\.cube$/i.test(file.name)) { ui.toast(`${file.name}: only .cube LUT files are supported.`, 'error'); continue; }
        const parsed = parseCube(await file.text(), file.name);
        if ('error' in parsed) { ui.toast(`${file.name}: ${parsed.error}`, 'error'); continue; }
        commit([{ type: 'add_lut', lut: parsed.lut }], `Import LUT ${parsed.lut.name}`);
        ui.toast(`LUT imported — ${parsed.lut.name} (${parsed.lut.size}³). Select a clip and click Apply.`, 'success');
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="border-t border-line pt-2 mt-1">
      <span className="label flex items-center gap-1.5"><Palette size={12} /> LUT (.cube)</span>
      {luts.length === 0 && (
        <p className="text-[11px] text-paper-faint">No LUTs imported yet. Import an Adobe .cube file — it is stored inside the project and applied through the same render path as export.</p>
      )}
      {luts.length > 0 && (
        <div className="space-y-1 mb-1.5">
          {luts.map((l) => {
            const applied = lutEffects.find((e) => e.params.lut === l.id);
            return (
              <div key={l.id} className="flex items-center gap-1.5 text-[11px] bg-ink-850 rounded-md px-2 py-1 border border-line">
                <Palette size={10} className="text-mind shrink-0" />
                <span className="text-paper truncate flex-1" title={`${l.name} — ${l.size}³ LUT, ${(l.table.length / 3) | 0} colors`}>{l.name}</span>
                {applied ? (
                  <>
                    <span className="text-heat-green shrink-0">✓</span>
                    <button className="btn-ghost text-[10px] px-1 py-0.5" title="Remove this LUT effect from the clip"
                      onClick={() => commit([{ type: 'remove_effect', clipId, effectId: applied.id }], `Remove LUT ${l.name}`)}>Remove</button>
                  </>
                ) : (
                  <button className="btn-ghost text-[10px] px-1 py-0.5" title={`Apply ${l.name} to this clip`}
                    disabled={!clipId}
                    onClick={() => commit([{ type: 'add_effect', clipId, effect: { type: 'lut', enabled: true, params: { lut: l.id, strength: 1 } } }], `Apply LUT ${l.name}`)}>Apply</button>
                )}
                <button className="icon-btn p-0.5 hover:text-heat" title="Delete this LUT from the project (also removes it from all clips)"
                  onClick={() => commit([{ type: 'remove_lut', lutId: l.id }], `Delete LUT ${l.name}`)}><Trash2 size={11} /></button>
              </div>
            );
          })}
          {lutEffects.map((e) => {
            const lutName = luts.find((l) => l.id === e.params.lut)?.name ?? 'LUT';
            return (
              <div key={e.id} className="pl-1">
                <Slider label={`${lutName} strength`} value={typeof e.params.strength === 'number' ? e.params.strength : 1} min={0} max={1} step={0.01}
                  onChange={(v) => commit([{ type: 'set_effect', clipId, effectId: e.id, params: { strength: v } }], 'LUT strength')} />
              </div>
            );
          })}
        </div>
      )}
      <input ref={fileRef} type="file" accept=".cube" multiple className="hidden"
        onChange={(e) => void importLut(e.target.files)} />
      <button className="btn-ghost text-[11px] px-2 py-1 w-full justify-center" disabled={busy}
        title="Import Adobe .cube 3D LUT files (17³, 33³, 65³…)"
        onClick={() => fileRef.current?.click()}>
        {busy ? 'Importing…' : 'Import .cube LUT'}
      </button>
    </div>
  );
}

/** Speed-ramp curve editor. Points are clip-local seconds (t) with speed
 * 0.1..8 on a log scale (so 1× sits mid-chart and slow/fast both get room).
 * Every gesture commits the full sorted point array as ONE coalesced undo
 * step via set_speed_ramp. */
const SPEED_MIN = 0.1;
const SPEED_MAX = 8;
const LOG_SPAN = Math.log(SPEED_MAX) - Math.log(SPEED_MIN);
/** Speed → 0..1 fraction on the log scale (1 = top of the chart). */
const speedToFrac = (s: number) => (Math.log(Math.max(SPEED_MIN, Math.min(SPEED_MAX, s))) - Math.log(SPEED_MIN)) / LOG_SPAN;
/** Inverse of speedToFrac. */
const fracToSpeed = (f: number) => Math.exp(Math.log(SPEED_MIN) + Math.max(0, Math.min(1, f)) * LOG_SPAN);

function RampEditor({ clipId, duration, points }: { clipId: string; duration: number; points: SpeedPoint[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const dur = Math.max(0.05, duration);

  const commit = (next: SpeedPoint[]) => {
    const sorted = [...next].sort((a, b) => a.t - b.t);
    useStore.getState().commit(
      [{ type: 'set_speed_ramp', clipId, points: sorted }],
      'Speed ramp', 'human', `${clipId}:ramp`,
    );
  };

  /** Pointer position → {t, speed}, clamped to the chart area. */
  const pointAt = (clientX: number, clientY: number): { t: number; speed: number } | null => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const fx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const fy = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)); // 1 = top = fast
    return { t: Math.round(fx * dur * 100) / 100, speed: Math.round(fracToSpeed(fy) * 100) / 100 };
  };

  const startDrag = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no active pointer (e.g. synthetic event) */ }
    setDragIdx(i);
  };
  const onDrag = (i: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragIdx !== i) return;
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    const sorted = [...points].sort((a, b) => a.t - b.t);
    // Keep the dragged point between its neighbors so the curve stays sane.
    const lo = i > 0 ? sorted[i - 1].t : 0;
    const hi = i < sorted.length - 1 ? sorted[i + 1].t : dur;
    const t = Math.max(lo, Math.min(hi, p.t));
    commit(sorted.map((pt, j) => (j === i ? { t, speed: p.speed } : pt)));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragIdx(null);
  };

  const addPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = pointAt(e.clientX, e.clientY);
    if (!p) return;
    commit([...points, p]);
  };
  const removePoint = (i: number) => {
    if (i === 0 || i === points.length - 1) return; // first/last anchor the ramp
    commit(points.filter((_, j) => j !== i));
  };

  const sorted = [...points].sort((a, b) => a.t - b.t);
  const linePts = sorted.map((p) => `${(p.t / dur) * 100},${(1 - speedToFrac(p.speed)) * 100}`).join(' ');
  const oneXy = (1 - speedToFrac(1)) * 100; // reference line at 1×

  return (
    <div className="space-y-1.5">
      <div
        ref={boxRef}
        className={`relative h-16 rounded-md bg-ink-850 border border-line overflow-hidden select-none ${dragIdx !== null ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        onClick={addPoint}
        title="Click empty space to add a point"
      >
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <line x1="0" y1={oneXy} x2="100" y2={oneXy} stroke="currentColor" className="text-paper-faint" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={linePts} fill="none" stroke="currentColor" className="text-signal" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        {sorted.map((p, i) => (
          <div
            key={`${p.t}-${i}`}
            role="slider" aria-label={`Ramp point ${i + 1}: ${p.speed.toFixed(2)}× at ${p.t.toFixed(2)}s`}
            aria-valuenow={p.speed} aria-valuemin={SPEED_MIN} aria-valuemax={SPEED_MAX}
            className={`absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border ${dragIdx === i ? 'bg-paper border-signal' : 'bg-signal border-ink-950'} hover:scale-125 transition-transform`}
            style={{ left: `${(p.t / dur) * 100}%`, top: `${(1 - speedToFrac(p.speed)) * 100}%`, touchAction: 'none' }}
            onPointerDown={startDrag(i)}
            onPointerMove={onDrag(i)}
            onPointerUp={endDrag}
            onDoubleClick={(e) => { e.stopPropagation(); removePoint(i); }}
            title={i === 0 || i === sorted.length - 1 ? `${p.speed.toFixed(2)}× at ${p.t.toFixed(2)}s (anchor)` : `${p.speed.toFixed(2)}× at ${p.t.toFixed(2)}s — drag to move, double-click to remove`}
          />
        ))}
      </div>
      <div className="space-y-1">
        {sorted.map((p, i) => (
          <div key={`row-${p.t}-${i}`} className="flex items-center gap-1.5 text-[11px] bg-ink-850 rounded-md px-2 py-1 border border-line">
            <span className="text-paper-dim font-mono w-14">t {p.t.toFixed(2)}s</span>
            <input type="number" className="field py-0.5 w-16 text-[11px]" min={0} max={dur} step={0.05} value={p.t}
              onChange={(e) => {
                const t = Number(e.target.value);
                if (!Number.isFinite(t)) return;
                commit(sorted.map((pt, j) => (j === i ? { ...pt, t: Math.max(0, Math.min(dur, t)) } : pt)));
              }} />
            <input type="number" className="field py-0.5 w-16 text-[11px]" min={SPEED_MIN} max={SPEED_MAX} step={0.1} value={p.speed}
              onChange={(e) => {
                const s = Number(e.target.value);
                if (!Number.isFinite(s)) return;
                commit(sorted.map((pt, j) => (j === i ? { ...pt, speed: Math.max(SPEED_MIN, Math.min(SPEED_MAX, s)) } : pt)));
              }} />
            <span className="text-paper-faint">×speed</span>
            <button className={`icon-btn p-0.5 ml-auto ${i === 0 || i === sorted.length - 1 ? 'opacity-30 cursor-not-allowed' : 'hover:text-heat'}`}
              disabled={i === 0 || i === sorted.length - 1}
              title={i === 0 || i === sorted.length - 1 ? 'First and last points anchor the ramp' : 'Remove point'}
              onClick={() => removePoint(i)}><X size={11} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EffectRow({ clipId, effect }: { clipId: string; effect: Effect }) {
  const set = (actions: Action[], label: string, key?: string) => useStore.getState().commit(actions, label, 'human', key);
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-line bg-ink-850 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <input type="checkbox" className="accent-signal w-3.5 h-3.5" checked={effect.enabled} onChange={(e) => set([{ type: 'set_effect', clipId, effectId: effect.id, enabled: e.target.checked }], 'Toggle effect')} />
        <button className="text-xs text-paper flex-1 text-left capitalize" onClick={() => setOpen((v) => !v)}>{effect.type}</button>
        <button className="icon-btn p-0.5 hover:text-heat" onClick={() => set([{ type: 'remove_effect', clipId, effectId: effect.id }], 'Remove effect')}><Trash2 size={12} /></button>
      </div>
      {open && (
        <div className="px-2 pb-2 space-y-2">
          {Object.entries(effect.params).map(([k, v]) => {
            if (typeof v === 'boolean') {
              return <label key={k} className="flex items-center gap-2 text-[11px] text-paper-dim cursor-pointer"><input type="checkbox" className="accent-signal" checked={v} onChange={(e) => set([{ type: 'set_effect', clipId, effectId: effect.id, params: { [k]: e.target.checked } }], 'Effect param')} />{k}</label>;
            }
            if (typeof v === 'string') {
              return <div key={k} className="flex items-center gap-2"><span className="text-[11px] text-paper-dim flex-1">{k}</span><input type="color" value={v} onChange={(e) => set([{ type: 'set_effect', clipId, effectId: effect.id, params: { [k]: e.target.value } }], 'Effect color', `${effect.id}:${k}`)} /></div>;
            }
            const [min, max, step] = RANGES[k] ?? [0, 1, 0.01];
            return <Slider key={k} label={k} value={v} min={min} max={max} step={step} onChange={(nv) => set([{ type: 'set_effect', clipId, effectId: effect.id, params: { [k]: nv } }], 'Effect param', `${effect.id}:${k}`)} />;
          })}
        </div>
      )}
    </div>
  );
}

function ProjectInspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const set = (actions: Action[], label: string, key?: string) => useStore.getState().commit(actions, label, 'human', key);
  const s = project.settings;
  return (
    <div>
      <div className="p-3 border-b border-line">
        <span className="label">Project</span>
        <p className="text-xs text-paper-dim">{selection.length > 1 ? `${selection.length} clips selected — select one to edit, or use the tools for batch edits.` : 'Nothing selected. Select a clip on the timeline to edit it, or adjust the project below.'}</p>
      </div>
      <Section title="Canvas">
        <div><span className="label">Aspect</span>
          <select className="field cursor-pointer" value={s.aspect} onChange={(e) => { const a = e.target.value as Aspect; const [w, h] = ASPECT_SIZES[a]; set([{ type: 'set_settings', patch: { aspect: a, width: w, height: h } }], 'Aspect'); }}>
            {(Object.keys(ASPECT_SIZES) as Aspect[]).map((a) => <option key={a} value={a}>{a} ({ASPECT_SIZES[a][0]}×{ASPECT_SIZES[a][1]})</option>)}
          </select>
        </div>
        <Slider label="Frame rate" value={s.fps} min={12} max={60} step={1} fmt={(v) => `${v} fps`} onChange={(v) => set([{ type: 'set_settings', patch: { fps: v } }], 'Frame rate', 'fps')} />
        <div className="flex items-center gap-2"><span className="text-[11px] text-paper-dim flex-1">Background</span><input type="color" value={s.background} onChange={(e) => set([{ type: 'set_settings', patch: { background: e.target.value } }], 'Background', 'bg')} /></div>
      </Section>
      <div className="p-3 text-[11px] text-paper-faint">
        {project.media.length} media · {project.clips.length} clips · {project.tracks.length} tracks
      </div>
    </div>
  );
}
