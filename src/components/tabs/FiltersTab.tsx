/** Filter gallery: real param-driven CSS swatch previews of COLOR_PRESETS,
 * draggable preset cards (drop payload handled by Timeline), intensity
 * scaling, batch apply-to-all, and per-clip param editing. */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { useUI } from '../../state/ui';
import { commit, DragSlider, Section, Hint, useSelectedClip } from './shared';
import { COLOR_PRESETS, type Action, type Effect } from '../../../engine';

const FALCONCUT_MIME = 'application/x-falconcut'; // same MIME the Timeline drop handler reads
const SWATCH_GRADIENT = 'linear-gradient(135deg, #e0a86a 0%, #7c5cbf 50%, #4a90d9 100%)';

const BASE: Record<string, number> = { brightness: 1, contrast: 1, saturation: 1, temperature: 0 };

/** Scale preset params by intensity: deltas from 1.0 shrink/grow, absolute extras (temperature) scale too. */
function scaledParams(preset: string, intensity: number): Record<string, number> {
  const src = COLOR_PRESETS[preset]?.params ?? {};
  const out: Record<string, number> = { ...BASE };
  for (const [k, v] of Object.entries(src)) {
    if (k in BASE) out[k] = 1 + (v - 1) * intensity;
    else out[k] = v * intensity;
  }
  return out;
}

/** CSS approximation of the engine's color math, computed from the actual
 * params — brightness/contrast/saturation map directly, temperature maps to
 * sepia (warm) or hue-rotate (cool). */
export function cssFilterFromParams(params: Record<string, number | string | boolean>): string {
  const num = (k: string) => (typeof params[k] === 'number' ? (params[k] as number) : undefined);
  const f: string[] = [];
  const b = num('brightness'), c = num('contrast'), s = num('saturation');
  if (b != null) f.push(`brightness(${b})`);
  if (c != null) f.push(`contrast(${c})`);
  if (s != null) f.push(`saturate(${s})`);
  if ((num('sepia') ?? 0) > 0.001) f.push(`sepia(${num('sepia')})`);
  if ((num('grayscale') ?? 0) > 0.001) f.push(`grayscale(${num('grayscale')})`);
  const t = num('temperature') ?? 0;
  if (t > 0.001) f.push(`sepia(${(t * 0.3).toFixed(3)})`);
  else if (t < -0.001) f.push(`hue-rotate(${(t * 12).toFixed(1)}deg) saturate(${(1 - t * 0.1).toFixed(3)})`);
  return f.length ? f.join(' ') : 'none';
}

/** Detect which preset (and at which intensity) an effect's params came from. */
function matchPreset(rawParams: Record<string, number | string | boolean>): { key: string; intensity: number } | undefined {
  const params: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawParams)) if (typeof v === 'number') params[k] = v;
  let best: { key: string; intensity: number; err: number } | undefined;
  for (const [key, p] of Object.entries(COLOR_PRESETS)) {
    const bDelta = (p.params.brightness ?? 1) - 1;
    const i = Math.abs(bDelta) > 0.005 ? (params.brightness - 1) / bDelta : 1;
    if (i < 0 || i > 2.2) continue;
    let err = 0;
    for (const [k, v] of Object.entries(p.params)) {
      const scaled = k in BASE ? 1 + (v - 1) * i : v * i;
      err += Math.abs(scaled - (params[k] ?? scaled));
    }
    if (!best || err < best.err) best = { key, intensity: Math.round(i * 100) / 100, err };
  }
  return best && best.err < 0.05 ? { key: best.key, intensity: best.intensity } : undefined;
}

export function FiltersTab() {
  const project = useStore((s) => s.project);
  const clip = useSelectedClip();
  const [intensity, setIntensity] = useState(1);
  const [current, setCurrent] = useState<string | null>(null);

  const id = clip?.id;
  const colorFx = clip?.effects.find((e) => e.type === 'color') as Effect | undefined;
  const fxJson = JSON.stringify(colorFx?.params ?? null);

  // When a clip's filter matches a known preset, sync the intensity slider to it.
  useEffect(() => {
    if (!colorFx) return;
    const m = matchPreset(colorFx.params);
    if (m) { setIntensity(m.intensity); setCurrent(m.key); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fxJson]);

  const resolvePreset = (): string => current ?? Object.keys(COLOR_PRESETS)[0];
  const applyPreset = (preset: string, clipId: string, existing: Effect | undefined) => {
    const params = scaledParams(preset, intensity);
    const actions: Action[] = [];
    if (existing) actions.push({ type: 'set_effect', clipId, effectId: existing.id, params });
    else actions.push({ type: 'add_effect', clipId, effect: { type: 'color', enabled: true, params } });
    commit(actions, `Filter ${COLOR_PRESETS[preset]?.name ?? preset}`);
  };

  const onIntensityCommit = (v: number) => {
    setIntensity(v);
    if (!colorFx || !id) return;
    // Always derive params from the neutral preset + intensity. Re-scaling the
    // already-scaled params compounds deltas on every drag (1→1.5→2 became ~3×).
    const key = matchPreset(colorFx.params)?.key ?? current ?? Object.keys(COLOR_PRESETS)[0];
    commit([{ type: 'set_effect', clipId: id, effectId: colorFx.id, params: scaledParams(key, v) }], 'Filter intensity', `${colorFx.id}:int`);
  };

  const applyAll = () => {
    const preset = resolvePreset();
    const visuals = project.clips.filter((c) => c.kind === 'media');
    if (!visuals.length) { useUI.getState().toast('No visual clips on the timeline', 'error'); return; }
    const params = scaledParams(preset, intensity);
    const actions: Action[] = visuals.map((c) => {
      const fx = c.effects.find((e) => e.type === 'color') as Effect | undefined;
      return fx
        ? { type: 'set_effect' as const, clipId: c.id, effectId: fx.id, params }
        : { type: 'add_effect' as const, clipId: c.id, effect: { type: 'color' as const, enabled: true, params } };
    });
    commit(actions, `Apply filter to all (${visuals.length})`);
  };

  const activeMatch = colorFx ? matchPreset(colorFx.params) : undefined;

  return (
    <div>
      <Section title="Filter presets" action={
        <button className="btn-ghost text-[11px]" title={`Apply ${COLOR_PRESETS[resolvePreset()]?.name} to every media clip`} onClick={applyAll}>
          Apply to all
        </button>
      }>
        <div className="grid grid-cols-3 gap-1.5">
          {Object.entries(COLOR_PRESETS).map(([key, p]) => {
            const active = (activeMatch?.key ?? current) === key;
            return (
              <button key={key}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FALCONCUT_MIME, JSON.stringify({ kind: 'filter', preset: key, intensity }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => { setCurrent(key); if (clip && id) applyPreset(key, id, colorFx); }}
                title={`${p.name} — click to apply, drag onto a timeline clip`}
                className={`rounded-lg border overflow-hidden text-left transition-all ${active ? 'ring-2 ring-signal border-transparent' : 'border-line hover:border-line-bright'}`}>
                <div className="h-14" style={{ background: SWATCH_GRADIENT, filter: cssFilterFromParams(scaledParams(key, intensity)) }} />
                <div className={`px-1.5 py-1 text-[11px] font-medium truncate ${active ? 'text-signal' : 'text-paper-dim'}`}>{p.name}</div>
              </button>
            );
          })}
        </div>
        <DragSlider label="Intensity" value={intensity} min={0} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
          onCommit={onIntensityCommit} />
        <p className="text-[11px] text-paper-faint">
          Swatches are live previews of the preset math. Intensity scales brightness/contrast/saturation deltas and temperature; clicking a preset applies at the current intensity (or re-tunes the existing filter). Drag a card onto any timeline clip.
        </p>
      </Section>

      <Section title="Clip filter">
        {!clip && <Hint>Select a clip to edit its color filter.</Hint>}
        {clip && !colorFx && <Hint>No color filter on this clip. Click a preset above to add one.</Hint>}
        {clip && colorFx && (
          <>
            <div className="flex items-center gap-2">
              <div className="h-10 w-16 rounded-md border border-line shrink-0"
                style={{ background: SWATCH_GRADIENT, filter: cssFilterFromParams(colorFx.params) }} />
              <span className="text-[11px] text-paper-faint">
                Current look{activeMatch ? ` · ${COLOR_PRESETS[activeMatch.key]?.name} @ ${Math.round(activeMatch.intensity * 100)}%` : ' · custom'}
              </span>
            </div>
            {(Object.entries(colorFx.params) as [string, number][]).map(([k, v]) => {
              const [min, max, step] = k === 'temperature' || k === 'grayscale' || k === 'sepia' ? [-1, 1, 0.01] : [0.4, 2, 0.01];
              return (
                <DragSlider key={k} label={k} value={v} min={min} max={max} step={step}
                  fmt={(nv) => nv.toFixed(2)}
                  onCommit={(nv) => commit([{ type: 'set_effect', clipId: id!, effectId: colorFx.id, params: { [k]: nv } }], 'Filter param', `${colorFx.id}:${k}`)} />
              );
            })}
            <button className="btn-solid w-full justify-center text-xs hover:text-heat"
              onClick={() => commit(clip.effects.filter((e) => e.type === 'color').map((e) => ({ type: 'remove_effect' as const, clipId: id!, effectId: e.id })), 'Remove filter')}>
              Remove filter
            </button>
          </>
        )}
      </Section>
    </div>
  );
}


