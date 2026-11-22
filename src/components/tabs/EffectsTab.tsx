import { useState } from 'react';
import { Trash2, MousePointerClick, ChevronUp, ChevronDown, Save, Layers } from 'lucide-react';
import { commit, DragSlider, Section, Hint, useSelectedClip, EFFECT_RANGES } from './shared';
import { FALCONCUT_MIME } from '../MediaTab';
import type { EffectType, Effect, Transition } from '../../../engine';

const TRANSITIONS: Transition['type'][] = ['crossfade', 'dip-black', 'dip-white', 'wipe-left', 'slide-left', 'zoom-in'];

const COLOR: Record<string, number> = { brightness: 1, contrast: 1, saturation: 1, temperature: 0 };

const EFFECT_BUTTONS: { label: string; type: EffectType; params: Record<string, number | string | boolean> }[] = [
  { label: 'Blur', type: 'blur', params: { amount: 4 } },
  { label: 'Sharpen', type: 'sharpen', params: { amount: 0.5 } },
  { label: 'Vignette', type: 'vignette', params: { amount: 0.5 } },
  { label: 'Chroma key', type: 'chromaKey', params: { color: '#00FF00', tolerance: 0.28, softness: 0.12 } },
  { label: 'Negate (invert)', type: 'negate', params: { invert: 1 } },
  { label: 'Normalize (auto levels)', type: 'normalize', params: { strength: 0.8 } },
  { label: 'Brightness', type: 'color', params: { ...COLOR, brightness: 1.25 } },
  { label: 'Contrast', type: 'color', params: { ...COLOR, contrast: 1.25 } },
  { label: 'Saturation', type: 'color', params: { ...COLOR, saturation: 1.3 } },
  { label: 'Temperature', type: 'color', params: { ...COLOR, temperature: 0.3 } },
  { label: 'Black & white', type: 'color', params: { ...COLOR, grayscale: 1 } },
  { label: 'Sepia tone', type: 'color', params: { ...COLOR, sepia: 0.8, saturation: 0.7 } },
  { label: 'Strong blur', type: 'blur', params: { amount: 12 } },
  { label: 'Soft blur', type: 'blur', params: { amount: 2 } },
  { label: 'Deep vignette', type: 'vignette', params: { amount: 0.9 } },
  { label: 'Pixelate', type: 'pixelate', params: { amount: 8 } },
  { label: 'Film grain', type: 'noise', params: { amount: 0.12 } },
  { label: 'RGB split', type: 'rgbSplit', params: { amount: 4 } },
  { label: 'Soft glow', type: 'glow', params: { amount: 0.4 } },
];

const EFFECT_PRESETS_KEY = 'falconcut.effectPresets';
function loadPresets(): Record<string, Effect[]> {
  try { return JSON.parse(localStorage.getItem(EFFECT_PRESETS_KEY) || '{}') as Record<string, Effect[]>; }
  catch { return {}; }
}

export function EffectsTab() {
  const clip = useSelectedClip();
  const [name, setName] = useState('');
  const [presets, setPresets] = useState<Record<string, Effect[]>>(loadPresets);
  const persist = (next: Record<string, Effect[]>) => {
    setPresets(next);
    try { localStorage.setItem(EFFECT_PRESETS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const savePreset = () => {
    if (!clip || !clip.effects.length) return;
    const key = name.trim() || `Preset ${Object.keys(presets).length + 1}`;
    persist({ ...presets, [key]: JSON.parse(JSON.stringify(clip.effects)) as Effect[] });
    setName('');
  };

  return (
    <div>
      <Section title="Add effect">
        {!clip && (
          <div className="flex items-center gap-2 text-[11px] text-paper-faint">
            <MousePointerClick size={13} className="shrink-0" /> Select a clip to add effects
          </div>
        )}
        {clip && (
          <div className="grid grid-cols-2 gap-1.5">
            {EFFECT_BUTTONS.map((b) => (
              <button key={b.label} draggable className="btn-solid justify-start text-xs px-2 py-1.5" title={`Add ${b.label} — click or drag onto a clip`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(FALCONCUT_MIME, JSON.stringify({ kind: 'effect', effectType: b.type, params: b.params }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => commit([{ type: 'add_effect', clipId: clip.id, effect: { type: b.type, enabled: true, params: { ...b.params } } }], `Add ${b.label}`)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Clip effects" action={
        clip && clip.effects.length > 0 ? (
          <button className="icon-btn" title="Save current stack as preset" onClick={savePreset}><Save size={14} /></button>
        ) : undefined
      }>
        {!clip && <Hint>No clip selected.</Hint>}
        {clip && clip.effects.length === 0 && <Hint>No effects on this clip yet.</Hint>}
        {clip && clip.effects.map((ef, i) => {
          const numeric = Object.entries(ef.params).filter(([, v]) => typeof v === 'number') as [string, number][];
          return (
            <div key={ef.id} className="rounded-lg border border-line bg-ink-850 px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <button className={`chip border px-1.5 ${ef.enabled ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-faint'}`}
                  title={ef.enabled ? 'Disable effect' : 'Enable effect'}
                  onClick={() => commit([{ type: 'set_effect', clipId: clip.id, effectId: ef.id, enabled: !ef.enabled }], ef.enabled ? 'Disable effect' : 'Enable effect')}>
                  {ef.enabled ? 'On' : 'Off'}
                </button>
                <span className={`text-xs flex-1 capitalize ${ef.enabled ? 'text-paper' : 'text-paper-faint line-through'}`}>{ef.type}</span>
                <button className="icon-btn p-0.5" disabled={i === 0} title="Move effect up"
                  onClick={() => commit([{ type: 'move_effect', clipId: clip.id, effectId: ef.id, direction: -1 }], 'Move effect up')}><ChevronUp size={12} /></button>
                <button className="icon-btn p-0.5" disabled={i === clip.effects.length - 1} title="Move effect down"
                  onClick={() => commit([{ type: 'move_effect', clipId: clip.id, effectId: ef.id, direction: 1 }], 'Move effect down')}><ChevronDown size={12} /></button>
                <button className="icon-btn p-0.5 hover:text-heat" title="Remove effect"
                  onClick={() => commit([{ type: 'remove_effect', clipId: clip.id, effectId: ef.id }], 'Remove effect')}>
                  <Trash2 size={12} />
                </button>
              </div>
              {numeric.map(([k, v]) => {
                const [min, max, step] = EFFECT_RANGES[k] ?? [0, 2, 0.01];
                return (
                  <DragSlider key={k} label={k} value={v} min={min} max={max} step={step} commitKey={`${ef.id}:${k}`}
                    onCommit={(nv) => commit([{ type: 'set_effect', clipId: clip.id, effectId: ef.id, params: { [k]: nv } }], 'Effect param', `${ef.id}:${k}`)} />
                );
              })}
            </div>
          );
        })}
      </Section>

      <Section title="Saved effect stacks" action={<Layers size={14} className="text-paper-faint" />}>
        <div className="flex gap-1.5">
          <input className="field flex-1 min-w-0 py-1 text-xs" placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-solid text-[11px] px-2" disabled={!clip || !clip.effects.length} onClick={savePreset}>Save</button>
        </div>
        {Object.keys(presets).length === 0 && <Hint>Save the current effect stack to reuse it on any clip.</Hint>}
        {Object.entries(presets).map(([key, effects]) => (
          <button key={key} className="w-full text-left rounded-lg border border-line px-2 py-1.5 text-xs text-paper hover:border-signal/40"
            disabled={!clip} onClick={() => clip && commit([
              ...clip.effects.map((e) => ({ type: 'remove_effect' as const, clipId: clip.id, effectId: e.id })),
              ...effects.map((e) => ({ type: 'add_effect' as const, clipId: clip.id, effect: { ...e, id: undefined } })),
            ], `Apply effect preset ${key}`)}>
            {key} <span className="text-paper-faint">· {effects.length} effect{effects.length === 1 ? '' : 's'}</span>
          </button>
        ))}
      </Section>
    </div>
  );
}
