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
