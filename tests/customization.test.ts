import { describe, it, expect } from 'vitest';
import { createProject, applyActions } from '../engine';
import { validateActions } from '../engine/actions';

describe('editor customization actions', () => {
  it('renames, solos and adds audio tracks in one project edit', () => {
    let p = createProject('Custom');
    const audio = p.tracks.find((t) => t.kind === 'audio')!;
    const actions = [
      { type: 'set_track' as const, trackId: audio.id, patch: { name: 'Narration', solo: true } },
      { type: 'add_track' as const, track: { kind: 'audio' as const, name: 'A2' } },
    ];
    expect(validateActions(p, actions)).toEqual([]);
    p = applyActions(p, actions);
    expect(p.tracks.find((t) => t.id === audio.id)).toMatchObject({ name: 'Narration', solo: true });
    expect(p.tracks.filter((t) => t.kind === 'audio')).toHaveLength(2);
  });

  it('enables and disables an effect without deleting it', () => {
    let p = createProject('Custom');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'video', id: 'v1' } },
      { type: 'add_clip', clip: { trackId: 'v1', start: 0, duration: 2, mediaId: '' } },
    ]);
    const clip = p.clips[0];
    p = applyActions(p, [{ type: 'add_effect', clipId: clip.id, effect: { type: 'blur', enabled: true, params: { amount: 4 } } }]);
    const fx = p.clips[0].effects[0];
    expect(fx.enabled).toBe(true);
    p = applyActions(p, [{ type: 'set_effect', clipId: clip.id, effectId: fx.id, enabled: false }]);
    expect(p.clips[0].effects).toHaveLength(1);
    expect(p.clips[0].effects[0].enabled).toBe(false);
  });

  it('reorders stacked effects', () => {
    let p = createProject('Custom');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'video', id: 'v1' } },
      { type: 'add_clip', clip: { trackId: 'v1', start: 0, duration: 2, mediaId: '' } },
    ]);
    const id = p.clips[0].id;
    p = applyActions(p, [
      { type: 'add_effect', clipId: id, effect: { type: 'color', enabled: true, params: {} } },
      { type: 'add_effect', clipId: id, effect: { type: 'blur', enabled: true, params: { amount: 2 } } },
    ]);
    const [first, second] = p.clips[0].effects;
    p = applyActions(p, [{ type: 'move_effect', clipId: id, effectId: second.id, direction: -1 }]);
    expect(p.clips[0].effects[0].id).toBe(second.id);
    expect(p.clips[0].effects[1].id).toBe(first.id);
  });

  it('stores a shape mask on a clip', () => {
    let p = createProject('Mask');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'video', id: 'v1' } },
      { type: 'add_clip', clip: { trackId: 'v1', start: 0, duration: 2, mediaId: '' } },
    ]);
    const id = p.clips[0].id;
    p = applyActions(p, [{ type: 'set_clip_props', clipId: id, patch: { mask: { shape: 'ellipse', x: 0.1, y: 0.2, w: 0.8, h: 0.6, feather: 0 } } }]);
    expect(p.clips[0].mask?.shape).toBe('ellipse');
    expect(p.clips[0].mask?.w).toBe(0.8);
  });

  it('accepts an adjustment layer clip with effects', () => {
    let p = createProject('Custom');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'video', id: 'v1' } },
      { type: 'add_clip', clip: { trackId: 'v1', start: 0, duration: 5, kind: 'adjustment', name: 'Adjustment', effects: [{ id: 'fx1', type: 'color', enabled: true, params: { brightness: 1.2, contrast: 1, saturation: 1, temperature: 0 } }] } },
    ]);
    expect(p.clips[0].kind).toBe('adjustment');
    expect(p.clips[0].effects[0].enabled).toBe(true);
  });

  it('stores audio pitch preservation on the clip', () => {
    let p = createProject('Custom');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'audio', id: 'a1' } },
      { type: 'add_clip', clip: { trackId: 'a1', start: 0, duration: 2, mediaId: 'm1' } },
    ]);
    const id = p.clips[0].id;
    p = applyActions(p, [{ type: 'set_clip_props', clipId: id, patch: { preservePitch: true } }]);
    expect(p.clips[0].preservePitch).toBe(true);
  });

  it('changes frame rate and custom export dimensions as undoable settings', () => {
    let p = createProject('Custom', '9:16');
    p = applyActions(p, [{ type: 'set_settings', patch: { fps: 60, width: 720, height: 1280 } }]);
    expect(p.settings).toMatchObject({ fps: 60, width: 720, height: 1280 });
  });

  it('accepts every blend transition type exposed in the transition library', () => {
    const types = [
      'blend-multiply', 'blend-screen', 'blend-overlay', 'blend-soft-light', 'blend-hard-light',
      'blend-difference', 'blend-exclusion', 'blend-lighten', 'blend-darken',
      'blend-color-dodge', 'blend-color-burn', 'blend-hue', 'blend-saturation',
      'blend-color', 'blend-luminosity',
    ] as const;
    let p = createProject('Custom');
    p = applyActions(p, [
      { type: 'add_track', track: { kind: 'text', id: 'txt' } },
      { type: 'add_text', trackId: 'txt', start: 0, duration: 2, text: 'hello', role: 'caption', preset: 'clean' },
    ]);
    const clipId = p.clips[0].id;
    const actions = types.map((t) => ({
      type: 'set_transition' as const, clipId, edge: 'in' as const, transition: { type: t, duration: 0.4 },
    }));
    expect(validateActions(p, actions)).toEqual([]);
  });
});
