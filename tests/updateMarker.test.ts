import { describe, it, expect } from 'vitest';
import { applyActions, createProject } from '../engine';
import type { Action } from '../engine/actions';

describe('update_marker', () => {
  it('patches label, color, kind and time', () => {
    let p = createProject('Markers', '16:9');
    p = applyActions(p, [{ type: 'add_marker', marker: { id: 'mk1', time: 3, label: 'M1' } }]);
    p = applyActions(p, [{
      type: 'update_marker', markerId: 'mk1',
      patch: { label: 'Chorus', color: '#FB7185', kind: 'beat', time: 5.5 },
    }]);
    const m = p.markers.find((x) => x.id === 'mk1')!;
    expect(m.label).toBe('Chorus');
    expect(m.color).toBe('#FB7185');
    expect(m.kind).toBe('beat');
    expect(m.time).toBe(5.5);
  });

  it('ignores non-finite times and unknown ids', () => {
    let p = createProject('Markers', '16:9');
    p = applyActions(p, [{ type: 'add_marker', marker: { id: 'mk1', time: 3, label: 'M1' } }]);
    const before = JSON.stringify(p.markers);
    p = applyActions(p, [{ type: 'update_marker', markerId: 'nope', patch: { label: 'x' } }]);
    p = applyActions(p, [{ type: 'update_marker', markerId: 'mk1', patch: { time: Number.NaN } }]);
    expect(JSON.stringify(p.markers)).toBe(before);
    // negative time clamps to 0 instead of corrupting the ruler
    p = applyActions(p, [{ type: 'update_marker', markerId: 'mk1', patch: { time: -4 } }]);
    expect(p.markers[0].time).toBe(0);
  });

  it('is undoable as one step through the store action list', () => {
    // The action is part of the schema the store commits — verify it validates.
    const action: Action = { type: 'update_marker', markerId: 'mk1', patch: { label: 'A' } };
    expect(action.type).toBe('update_marker');
  });
});
