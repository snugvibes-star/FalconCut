/** Small shared building blocks for the left-panel tabs. All edits go
 * through commit() so each change is one undo step (coalesced by key). */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import type { Action } from '../../../engine';

export function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
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

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-paper-faint px-3 py-2">{children}</p>;
}

export function commit(actions: Action[], label: string, key?: string) {
  useStore.getState().commit(actions, label, 'human', key);
}

/** Range slider that commits ONCE per drag (on pointer up / key release),
 * keeping history clean. Value display tracks the store prop. */
export function DragSlider({ label, value, min, max, step, fmt, onCommit, commitKey, disabled }: {
  label: string; value: number; min: number; max: number; step: number;
  fmt?: (v: number) => string;
  onCommit: (v: number) => void;
  commitKey?: string; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [value]);
  const shown = draft ?? value;
  const end = () => {
    if (draft != null) { onCommit(draft); setDraft(null); }
  };
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-paper-dim">{label}</span>
        <span className="text-paper font-mono tabular-nums">{fmt ? fmt(shown) : shown.toFixed(2)}</span>
      </div>
      <input
        type="range" className="w-full" min={min} max={max} step={step} value={shown} disabled={disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={end} onKeyUp={end} onBlur={end}
      />
    </div>
  );
}

export function useSelectedClip() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  return selection.length === 1 ? project.clips.find((c) => c.id === selection[0]) : undefined;
}

export const EFFECT_RANGES: Record<string, [number, number, number]> = {
  brightness: [0.4, 1.8, 0.01], contrast: [0.4, 1.8, 0.01], saturation: [0, 2, 0.01],
  temperature: [-1, 1, 0.01], grayscale: [0, 1, 0.01], sepia: [0, 1, 0.01],
  amount: [0, 20, 0.1], tolerance: [0, 1, 0.01], softness: [0, 1, 0.01], thresholdDb: [-70, 0, 1],
  pixelate: [2, 32, 1], noise: [0, 1, 0.01],
};
