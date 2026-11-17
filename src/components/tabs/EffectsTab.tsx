import { Trash2, MousePointerClick } from 'lucide-react';
import { commit, DragSlider, Section, Hint, useSelectedClip, EFFECT_RANGES } from './shared';
import type { EffectType, Transition } from '../../../engine';

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
];

export function EffectsTab() {
  const clip = useSelectedClip();

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
              <button key={b.label} className="btn-solid justify-start text-xs px-2 py-1.5" title={`Add ${b.label}`}
                onClick={() => commit([{ type: 'add_effect', clipId: clip.id, effect: { type: b.type, enabled: true, params: { ...b.params } } }], `Add ${b.label}`)}>
                {b.label}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Clip effects">
        {!clip && <Hint>No clip selected.</Hint>}
        {clip && clip.effects.length === 0 && <Hint>No effects on this clip yet.</Hint>}
        {clip && clip.effects.map((ef) => {
          const numeric = Object.entries(ef.params).filter(([, v]) => typeof v === 'number') as [string, number][];
          return (
            <div key={ef.id} className="rounded-lg border border-line bg-ink-850 px-2 py-1.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-paper capitalize flex-1">{ef.type}</span>
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
    </div>
  );
}
