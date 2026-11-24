import { describe, it, expect } from 'vitest';
import { createProject, applyActions } from '../engine';
import type { Project } from '../engine/types';
import { makeContext } from '../tools/helpers';
import {
  addEffect, configureEffect, removeEffect, animateProperty, speedRamp,
  applyMask, setClipTransition, groupClipsAI, timeRangeEdit, addMarkerAI,
  addNote, labelClips, setBlendMode, setClipFades,
} from '../tools/powerTools';

function fixture(): { project: Project; clipId: string } {
  let p = createProject('Power tools', '16:9');
  p = applyActions(p, [{
    type: 'add_clip',
    clip: { id: 'c1', trackId: p.tracks[1].id, start: 0, duration: 10, inPoint: 0, kind: 'media', effects: [] },
  }]);
  return { project: p, clipId: 'c1' };
}

describe('power tools emit real engine actions', () => {
  it('adds, configures and removes effects', () => {
    const { project, clipId } = fixture();
    const ctx = makeContext(project);
    const add = addEffect(ctx, { clipId, type: 'glow', enabled: true });
    expect(add.actions.length).toBe(1);
    expect(add.actions[0]).toMatchObject({ type: 'add_effect', clipId });

    const withEffect = applyActions(project, add.actions);
    const effectId = withEffect.clips[0].effects![0].id;
    const conf = configureEffect(makeContext(withEffect), { clipId, effectId, enabled: false });
    expect(conf.actions[0]).toMatchObject({ type: 'set_effect', clipId, effectId, enabled: false });

    const rem = removeEffect(makeContext(withEffect), { clipId, effectId });
    expect(rem.actions[0]).toMatchObject({ type: 'remove_effect', clipId, effectId });
  });

  it('animates a property with two keyframes', () => {
    const { project, clipId } = fixture();
    const r = animateProperty(makeContext(project), { clipId, property: 'scale', from: 1, to: 1.2, easing: 'ease-in-out' });
    expect(r.actions.length).toBe(2);
    expect(r.actions[0]).toMatchObject({ type: 'add_keyframe', path: 'transform.scale', value: 1 });
    expect(r.actions[1]).toMatchObject({ type: 'add_keyframe', path: 'transform.scale', value: 1.2 });
    // camelCase easing accepted
    expect((r.actions[0] as any).easing).toBe('easeInOut');
  });

  it('creates a speed ramp with engine-compatible points', () => {
    const { project, clipId } = fixture();
    const r = speedRamp(makeContext(project), { clipId, points: [{ time: 0, speed: 1 }, { time: 2, speed: 0.5 }] as any });
    expect(r.actions[0]).toMatchObject({ type: 'set_speed_ramp', clipId });
    // apply to ensure engine accepts it
    expect(() => applyActions(project, r.actions)).not.toThrow();
  });

  it('applies a mask with the right shape', () => {
    const { project, clipId } = fixture();
    const r = applyMask(makeContext(project), { clipId, shape: 'ellipse', feather: 0.1, x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(r.actions[0]).toMatchObject({ type: 'set_clip_props', clipId });
    const patch = (r.actions[0] as any).patch.mask;
    expect(patch.shape).toBe('ellipse');
    expect(patch.w).toBe(0.5);
    expect(() => applyActions(project, r.actions)).not.toThrow();
  });

  it('sets transitions, fades, blend and labels', () => {
    const { project, clipId } = fixture();
    const ctx = makeContext(project);
    expect(setClipTransition(ctx, { clipId, edge: 'in', type: 'fade' }).actions[0]).toMatchObject({ type: 'set_transition', clipId, edge: 'in' });
    expect(setClipFades(ctx, { clipId, fadeIn: 0.5, fadeOut: 1 }).actions[0]).toMatchObject({ type: 'set_fades', clipId });
    expect(setBlendMode(ctx, { clipId, mode: 'screen' }).actions[0]).toMatchObject({ type: 'set_clip_props', clipId });
    expect(labelClips(ctx, { clipIds: [clipId], label: 'broll' }).actions[0]).toMatchObject({ type: 'set_clip_props', clipId });
  });

  it('inserts gaps and ripple-deletes ranges', () => {
    const { project } = fixture();
    const ctx = makeContext(project);
    expect(timeRangeEdit(ctx, { operation: 'gap', start: 5, duration: 2 }).actions[0]).toMatchObject({ type: 'insert_gap', time: 5, duration: 2 });
    expect(timeRangeEdit(ctx, { operation: 'delete', start: 3, end: 6 }).actions[0]).toMatchObject({ type: 'ripple_delete_range', start: 3, end: 6 });
    expect(timeRangeEdit(ctx, { operation: 'delete', start: 3 }).actions).toEqual([]);
  });

  it('adds markers and notes', () => {
    const { project } = fixture();
    const ctx = makeContext(project);
    expect(addMarkerAI(ctx, { time: 4, label: 'Hook', kind: 'chapter' }).actions[0]).toMatchObject({ type: 'add_marker' });
    expect(addNote(ctx, { time: 4, text: 'Add b-roll' }).actions[0]).toMatchObject({ type: 'add_tack' });
  });

  it('groups clips', () => {
    let p = createProject('Groups', '16:9');
    p = applyActions(p, [
      { type: 'add_clip', clip: { id: 'a', trackId: p.tracks[1].id, start: 0, duration: 5 } },
      { type: 'add_clip', clip: { id: 'b', trackId: p.tracks[1].id, start: 5, duration: 5 } },
    ]);
    const r = groupClipsAI(makeContext(p), { clipIds: ['a', 'b'] });
    expect(r.actions[0]).toMatchObject({ type: 'group_clips' });
    expect(() => applyActions(p, r.actions)).not.toThrow();
  });

  it('rejects unknown effect types and speeds safely', () => {
    const { project, clipId } = fixture();
    const ctx = makeContext(project);
    expect(addEffect(ctx, { clipId, type: 'nope' }).actions).toEqual([]);
    expect(speedRamp(ctx, { clipId, points: [{ time: 0, speed: 1 }] as any }).actions).toEqual([]);
  });
});
