/**
 * Resolve-style grading panel. Every control maps to a real engine action:
 * add_effect / set_effect / remove_effect, committed as single undo steps.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { COLOR_PRESETS, IDENTITY_CURVE, parseCurvePoints, serializeCurvePoints, type Clip } from '../../../engine';
import { NodeGraph } from './NodeGraph';

/** Fully-defined neutral color params (also zeroes optional extras like grayscale). */
const DEFAULT_COLOR: Record<string, number> = {
  brightness: 1, contrast: 1, saturation: 1, temperature: 0, grayscale: 0, sepia: 0, hue: 0,
  lift_r: 0, lift_g: 0, lift_b: 0, gamma_r: 1, gamma_g: 1, gamma_b: 1, gain_r: 1, gain_g: 1, gain_b: 1,
};

/** Full neutral grade: presets and Reset must clear curves/HSL too, not just
 * the basic sliders (set_effect merges params rather than replacing them). */
const neutralGrade = (): Record<string, number | string> => {
  const p: Record<string, number | string> = { ...DEFAULT_COLOR };
  for (const key of ['r', 'y', 'g', 'c', 'b', 'm']) {
    p[`hsl_${key}_h`] = 0;
    p[`hsl_${key}_s`] = 1;
    p[`hsl_${key}_l`] = 0;
  }
  for (const key of ['curve', 'curve_r', 'curve_g', 'curve_b']) p[key] = IDENTITY_CURVE;
  return p;
};

const f2 = (v: number) => v.toFixed(2);
const fTemp = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

/** Returns the preset key whose params match the clip's color params, else null. */
export function matchPreset(params: Record<string, unknown> | null | undefined): string | null {
  if (!params) return null;
  for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    const full: Record<string, number> = { ...DEFAULT_COLOR, ...preset.params };
    const keys = new Set([...Object.keys(full), ...Object.keys(params)]);
    let ok = true;
    for (const k of keys) {
      const a = Number(params[k] ?? full[k] ?? 0);
      const b = Number(full[k] ?? 0);
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.011) {
        ok = false;
        break;
      }
    }
    if (ok) return key;
  }
  return null;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  disabled: boolean;
  onCommit: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, fmt, disabled, onCommit }: SliderRowProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const end = () => {
    if (!disabled && Number(draft) !== Number(value)) onCommit(draft);
  };
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[11px] text-paper-dim w-[66px] shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={draft} disabled={disabled}
        onChange={(e) => setDraft(parseFloat(e.target.value))}
        onPointerUp={end} onKeyUp={end} onBlur={end}
        className="flex-1 min-w-0 accent-signal"
      />
      <span className="font-mono text-[11px] text-paper-dim w-11 text-right tabular-nums">{fmt(draft)}</span>
    </div>
  );
}

/** Draggable 5-point tonal curve. Points are stored inside the color effect
 * params as a compact "x,y;..." string, so undo/redo and project JSON work
 * without any schema change. */
function CurveEditor({ value, onChange, disabled, label }: {
  value: string; onChange: (v: string) => void; disabled: boolean; label: string;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [points, setPoints] = useState(() => parseCurvePoints(value) ?? parseCurvePoints(IDENTITY_CURVE)!);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { setPoints(parseCurvePoints(value) ?? parseCurvePoints(IDENTITY_CURVE)!); }, [value]);

  const at = (e: React.PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(255, ((e.clientX - r.left) / r.width) * 255)),
      y: Math.max(0, Math.min(255, (1 - (e.clientY - r.top) / r.height) * 255)),
    };
  };
  const move = (e: React.PointerEvent) => {
    if (drag === null) return;
    const p = at(e);
    setPoints((prev) => prev.map((pt, i) => i === drag ? {
      x: Math.max(i === 0 ? 0 : prev[i - 1].x + 2, Math.min(i === prev.length - 1 ? 255 : prev[i + 1].x - 2, p.x)),
      y: p.y,
    } : pt));
  };
  const end = () => {
    if (drag === null) return;
    setDrag(null);
    onChange(serializeCurvePoints(points));
  };
  const sx = (x: number) => (x / 255) * 100;
  const sy = (y: number) => 100 - (y / 255) * 100;

  return (
    <svg ref={svg} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${label} tonal curve editor`}
      className="w-full h-32 rounded-md border border-line bg-ink-950 touch-none select-none"
      onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}>
      {[25, 50, 75].map((v) => <g key={v}>
        <line x1={v} y1="0" x2={v} y2="100" stroke="#2A2A30" strokeWidth="0.4" />
        <line x1="0" y1={v} x2="100" y2={v} stroke="#2A2A30" strokeWidth="0.4" />
      </g>)}
      <line x1="0" y1="100" x2="100" y2="0" stroke="#5E6B84" strokeWidth="0.5" strokeDasharray="3 3" />
      <polyline points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="none" stroke="#4C9AFF" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2.4" fill={drag === i ? '#EAEAEA' : '#4C9AFF'}
          stroke="#07090F" strokeWidth="0.6" className={disabled ? '' : 'cursor-grab'}
          onPointerDown={(e) => { if (disabled) return; e.preventDefault(); setDrag(i); try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic */ } }} />
      ))}
    </svg>
  );
}

const HSL_BAND_LABELS: { key: string; label: string }[] = [
  { key: 'r', label: 'Reds' }, { key: 'y', label: 'Yellows' }, { key: 'g', label: 'Greens' },
  { key: 'c', label: 'Cyans' }, { key: 'b', label: 'Blues' }, { key: 'm', label: 'Magentas' },
];

export function GradePanel({ clip }: { clip: Clip | null }) {
  const colorFx = clip?.effects.find((e) => e.type === 'color') ?? null;
  const activePreset = matchPreset(colorFx?.params);

  const num = (k: string, d: number) => {
    const v = colorFx?.params[k];
    return typeof v === 'number' ? v : d;
  };

  /** Write color-effect params (merged over existing), adding the effect if absent. One undo step. */
  const commitColor = (params: Record<string, number | string>, label: string) => {
    if (!clip) return;
    const s = useStore.getState();
    const fx = s.project.clips.find((c) => c.id === clip.id)?.effects.find((e) => e.type === 'color');
    if (fx) s.commit([{ type: 'set_effect', clipId: clip.id, effectId: fx.id, params }], label);
    else s.commit([{ type: 'add_effect', clipId: clip.id, effect: { type: 'color', enabled: true, params } }], label);
  };

  const setParam = (key: string, value: number) => {
    if (!clip) return;
    const fx = colorFx;
    commitColor(
      { ...DEFAULT_COLOR, ...(fx?.params as Record<string, number> | undefined), [key]: value },
      `Color: ${key}`,
    );
  };

  const applyPreset = (key: string) => {
    if (!clip) return;
    commitColor({ ...neutralGrade(), ...COLOR_PRESETS[key].params }, `Preset: ${COLOR_PRESETS[key].name}`);
  };

  const resetGrade = () => {
    if (!clip || !colorFx) return;
    commitColor(neutralGrade(), 'Reset grade');
  };

  const removeFilter = () => {
    if (!clip) return;
    const s = useStore.getState();
    const c = s.project.clips.find((x) => x.id === clip.id);
    if (!c || c.effects.length === 0) return;
    s.commit(
      c.effects.map((e) => ({ type: 'remove_effect' as const, clipId: clip.id, effectId: e.id })),
      'Remove filter',
    );
  };

  /* vignette */
  const vigFx = clip?.effects.find((e) => e.type === 'vignette') ?? null;
  const vigAmount = typeof vigFx?.params.amount === 'number' ? vigFx.params.amount : 0.5;

  const toggleVignette = () => {
    if (!clip) return;
    const s = useStore.getState();
    const fx = s.project.clips.find((c) => c.id === clip.id)?.effects.find((e) => e.type === 'vignette');
    if (fx) s.commit([{ type: 'set_effect', clipId: clip.id, effectId: fx.id, enabled: !fx.enabled }], fx.enabled ? 'Disable vignette' : 'Enable vignette');
    else s.commit([{ type: 'add_effect', clipId: clip.id, effect: { type: 'vignette', enabled: true, params: { amount: 0.5 } } }], 'Add vignette');
  };

  const commitVignette = (amount: number) => {
    if (!clip || !vigFx) return;
    useStore.getState().commit(
      [{ type: 'set_effect', clipId: clip.id, effectId: vigFx.id, params: { amount } }],
      'Vignette amount',
    );
  };

  const disabled = !clip;
  const [curveChannel, setCurveChannel] = useState<'master' | 'r' | 'g' | 'b'>('master');
  const [hslBand, setHslBand] = useState('r');
  const curveParam = curveChannel === 'master' ? 'curve' : `curve_${curveChannel}`;
  const curveValue = typeof colorFx?.params[curveParam] === 'string'
    ? String(colorFx!.params[curveParam]) : IDENTITY_CURVE;
  const bandNum = (suffix: string, def: number) => num(`hsl_${hslBand}_${suffix}`, def);

  return (
    <div className="p-3 space-y-4">
      {/* target selector */}
      <div>
        <span className="label">Target</span>
        <div className={`text-xs truncate ${clip ? 'text-paper' : 'text-paper-faint'}`}>
          {clip ? `Grading: ${clip.name}` : 'No visual clip at playhead'}
        </div>
      </div>

      {/* primary sliders */}
      <div className="panel p-2.5">
        <span className="label">Primary</span>
        <SliderRow label="Exposure" min={0.25} max={2} step={0.01} fmt={f2} disabled={disabled}
          value={num('brightness', 1)} onCommit={(v) => setParam('brightness', v)} />
        <SliderRow label="Contrast" min={0.25} max={2} step={0.01} fmt={f2} disabled={disabled}
          value={num('contrast', 1)} onCommit={(v) => setParam('contrast', v)} />
        <SliderRow label="Saturation" min={0} max={2} step={0.01} fmt={f2} disabled={disabled}
          value={num('saturation', 1)} onCommit={(v) => setParam('saturation', v)} />
        <SliderRow label="Temperature" min={-1} max={1} step={0.01} fmt={fTemp} disabled={disabled}
          value={num('temperature', 0)} onCommit={(v) => setParam('temperature', v)} />
      </div>

      {/* presets */}
      <div>
        <span className="label">Presets</span>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(COLOR_PRESETS).map(([key, p]) => (
            <button
              key={key}
              disabled={disabled}
              onClick={() => applyPreset(key)}
              title={`Apply ${p.name} look`}
              className={`chip border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                activePreset === key
                  ? 'border-signal/60 bg-signal/15 text-signal'
                  : 'border-line text-paper-dim hover:text-paper hover:border-line-bright bg-ink-850'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2.5">
          <button className="btn-ghost text-xs px-2 py-1 flex-1 justify-center disabled:opacity-40"
            disabled={disabled || !colorFx} onClick={resetGrade}>
            Reset grade
          </button>
          <button className="btn-ghost text-xs px-2 py-1 flex-1 justify-center disabled:opacity-40"
            disabled={disabled} onClick={removeFilter} title="Remove all effects from this clip">
            Remove filter
          </button>
        </div>
      </div>

      {/* RGB tonal curves — master + per channel, real LUT in the shared renderer */}
      <div className="panel p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="label !mb-0">RGB curves</span>
          <button className="text-[10px] text-paper-faint hover:text-paper disabled:opacity-40" disabled={disabled}
            onClick={() => commitColor({ [curveParam]: IDENTITY_CURVE }, 'Reset curve')}>Reset</button>
        </div>
        <div className="cf-chip-rail">
          {(['master', 'r', 'g', 'b'] as const).map((ch) => (
            <button key={ch} disabled={disabled}
              className={`chip border ${curveChannel === ch ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-paper-dim'}`}
              onClick={() => setCurveChannel(ch)}>{ch.toUpperCase()}</button>
          ))}
        </div>
        <CurveEditor label={`${curveChannel} curve`} value={curveValue} disabled={disabled}
          onChange={(v) => commitColor({ [curveParam]: v }, `${curveChannel.toUpperCase()} curve`)} />
      </div>

      {/* HSL secondary — per hue band, like Resolve's hue curves / Qualifier */}
      <div className="panel p-2.5 space-y-1.5">
        <span className="label !mb-0">HSL adjustments</span>
        <div className="cf-chip-rail">
          {HSL_BAND_LABELS.map((b) => (
            <button key={b.key} disabled={disabled}
              className={`chip border ${hslBand === b.key ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-paper-dim'}`}
              onClick={() => setHslBand(b.key)}>{b.label}</button>
          ))}
        </div>
        <SliderRow label="Hue" min={-180} max={180} step={1} fmt={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}°`}
          disabled={disabled} value={bandNum('h', 0)} onCommit={(v) => setParam(`hsl_${hslBand}_h`, v)} />
        <SliderRow label="Saturation" min={0} max={2} step={0.01} fmt={f2}
          disabled={disabled} value={bandNum('s', 1)} onCommit={(v) => setParam(`hsl_${hslBand}_s`, v)} />
        <SliderRow label="Lightness" min={-0.5} max={0.5} step={0.01} fmt={fTemp}
          disabled={disabled} value={bandNum('l', 0)} onCommit={(v) => setParam(`hsl_${hslBand}_l`, v)} />
      </div>

      {/* lift / gamma / gain — Kdenlive-style per-channel grading */}
      <div className="panel p-2.5">
        <details>
          <summary className="label cursor-pointer select-none flex items-center justify-between !mb-0">
            <span>Lift · Gamma · Gain</span>
            <span className="text-[10px] text-paper-faint font-normal">shadows / mids / highlights</span>
          </summary>
          <div className="mt-2 space-y-1">
            <div className="text-[10px] text-paper-faint uppercase tracking-wide">Lift — shadows (−0.5 … +0.5)</div>
            {(['r', 'g', 'b'] as const).map((c) => (
              <SliderRow key={`lift_${c}`} label={`Lift ${c.toUpperCase()}`} min={-0.5} max={0.5} step={0.005} fmt={fTemp}
                disabled={disabled} value={num(`lift_${c}`, 0)} onCommit={(v) => setParam(`lift_${c}`, v)} />
            ))}
            <div className="text-[10px] text-paper-faint uppercase tracking-wide pt-1">Gamma — midtones (0.2 … 2.5)</div>
            {(['r', 'g', 'b'] as const).map((c) => (
              <SliderRow key={`gamma_${c}`} label={`Gamma ${c.toUpperCase()}`} min={0.2} max={2.5} step={0.01} fmt={f2}
                disabled={disabled} value={num(`gamma_${c}`, 1)} onCommit={(v) => setParam(`gamma_${c}`, v)} />
            ))}
            <div className="text-[10px] text-paper-faint uppercase tracking-wide pt-1">Gain — highlights (0 … 2)</div>
            {(['r', 'g', 'b'] as const).map((c) => (
              <SliderRow key={`gain_${c}`} label={`Gain ${c.toUpperCase()}`} min={0} max={2} step={0.01} fmt={f2}
                disabled={disabled} value={num(`gain_${c}`, 1)} onCommit={(v) => setParam(`gain_${c}`, v)} />
            ))}
          </div>
        </details>
      </div>

      {/* vignette */}
      <div className="panel p-2.5">
        <div className="flex items-center justify-between mb-0.5">
          <span className="label !mb-0">Vignette</span>
          <button
            disabled={disabled}
            onClick={toggleVignette}
            className={`chip border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
              vigFx?.enabled
                ? 'border-signal/60 bg-signal/15 text-signal'
                : 'border-line text-paper-faint hover:text-paper bg-ink-850'
            }`}
          >
            {vigFx ? (vigFx.enabled ? 'Enabled' : 'Disabled') : 'Off'}
          </button>
        </div>
        <SliderRow label="Amount" min={0} max={1} step={0.01} fmt={f2}
          disabled={disabled || !vigFx?.enabled}
          value={vigAmount} onCommit={commitVignette} />
      </div>

      {/* serial node chain — real effects evaluated by the shared renderer */}
      <div className="panel">
        <NodeGraph clip={clip} />
      </div>
    </div>
  );
}
