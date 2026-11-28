import { useState } from 'react';
import { useStore } from '../../state/store';
import { commit, DragSlider, Section } from './shared';
import { useSelectedClip } from './shared';
import type { Transition, TransitionType } from '../../../engine';
import { FALCONCUT_MIME } from '../MediaTab';

const BASIC: TransitionType[] = ['crossfade', 'dip-black', 'dip-white', 'wipe-left', 'slide-left', 'zoom-in', 'push', 'spin', 'glitch', 'light-leak', 'film', 'cinematic'];
const BLEND: TransitionType[] = [
  'blend-multiply', 'blend-screen', 'blend-overlay', 'blend-soft-light', 'blend-hard-light',
  'blend-difference', 'blend-exclusion', 'blend-lighten', 'blend-darken',
  'blend-color-dodge', 'blend-color-burn', 'blend-hue', 'blend-saturation',
  'blend-color', 'blend-luminosity',
];
const DURATIONS = [0.2, 0.4, 0.6, 1];
const label = (t: TransitionType) => t.replace(/^blend-/, '').replace(/-/g, ' ');

export function TransitionsTab() {
  const clip = useSelectedClip();
  const [edge, setEdge] = useState<'in' | 'out'>('out');
  const [category, setCategory] = useState<'basic' | 'blend'>('basic');

  const current = clip ? (edge === 'in' ? clip.transitionIn : clip.transitionOut) : undefined;
  const disabled = !clip;

  const apply = (transition?: Transition) => {
    if (!clip) return;
    commit([{ type: 'set_transition', clipId: clip.id, edge, transition }], transition ? `Transition ${transition.type}` : 'Remove transition');
  };

  const applyAll = () => {
    if (!clip || !current) return;
    const actions = useStore.getState().project.clips
      .filter((c) => c.kind === 'media')
      .map((c) => ({ type: 'set_transition' as const, clipId: c.id, edge, transition: { ...current } }));
    commit(actions, `Apply ${current.type} to all cuts (${edge})`);
  };

  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <Section title="Edge">
        {!clip && <p className="text-[11px] text-paper-faint">Select a clip on the timeline to set transitions.</p>}
        <div className="grid grid-cols-2 gap-1.5">
          {(['in', 'out'] as const).map((e) => (
            <button key={e} disabled={disabled} onClick={() => setEdge(e)}
              className={`rounded-lg py-1.5 text-xs font-medium capitalize transition-colors border ${edge === e ? 'bg-ink-700 text-paper border-signal/40' : 'text-paper-dim hover:text-paper hover:bg-ink-800 border-line'}`}>
              {e}
            </button>
          ))}
        </div>
        {clip && <p className="text-[11px] text-paper-faint">{current ? `Current ${edge}: ${current.type} (${current.duration.toFixed(2)}s)` : `No ${edge} transition.`}</p>}
      </Section>

      <Section title="Type">
        <div className="flex gap-1.5">
          {(['basic', 'blend'] as const).map((c) => (
            <button key={c} onClick={() => setCategory(c)}
              className={`chip flex-1 justify-center capitalize border ${category === c ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
              {c === 'basic' ? 'Basic & wipes' : 'Blend modes'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(category === 'basic' ? BASIC : BLEND).map((t) => (
            <button key={t} draggable={!disabled} disabled={disabled} onClick={() => apply({ type: t, duration: current?.duration ?? 0.4, intensity: current?.intensity })}
              onDragStart={(e) => {
                e.dataTransfer.setData(FALCONCUT_MIME, JSON.stringify({ kind: 'transition', edge, type: t, duration: current?.duration ?? 0.4 }));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={`${t} — click or drag onto a clip`}
              className={`rounded-lg py-1.5 text-[11px] font-medium capitalize transition-colors border ${current?.type === t ? 'bg-ink-700 text-paper border-signal/40' : 'text-paper-dim hover:text-paper hover:bg-ink-800 border-line'}`}>
              {label(t)}
            </button>
          ))}
        </div>
        {current && (
          <>
            <div className="flex gap-1.5">
              {DURATIONS.map((d) => (
                <button key={d} disabled={disabled} onClick={() => apply({ type: current.type, duration: d, intensity: current.intensity })}
                  className={`chip flex-1 justify-center border ${Math.abs(current.duration - d) < 0.01 ? 'bg-signal/15 border-signal/50 text-signal' : 'border-line text-paper-dim hover:text-paper'}`}>
                  {d.toFixed(1)}s
                </button>
              ))}
            </div>
            <DragSlider label="Duration" value={current.duration} min={0.1} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}s`} commitKey="tr-dur"
              onCommit={(v) => apply({ type: current.type, duration: v, intensity: current.intensity })} />
            <DragSlider label="Intensity" value={current.intensity ?? 1} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} commitKey="tr-int"
              onCommit={(v) => apply({ type: current.type, duration: current.duration, intensity: v })} />
            <button className="btn-solid w-full justify-center text-xs" onClick={() => apply(undefined)}>Remove {edge} transition</button>
          </>
        )}
      </Section>

      <Section title="Batch">
        <button className="btn-signal w-full justify-center text-xs" disabled={disabled || !current} onClick={applyAll}>
          Apply to all cuts ({edge})
        </button>
        {!current && clip && <p className="text-[11px] text-paper-faint">Set a transition type first.</p>}
      </Section>
    </div>
  );
}
