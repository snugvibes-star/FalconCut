import { describe, it, expect } from 'vitest';
import { produce } from 'immer';
import {
  createProject, applyActions, projectDuration, History,
  type MediaAsset, type MediaAnalysis, type Project, type TranscriptWord,
} from '../engine';
import { validateActions } from '../engine/actions';
import {
  BUILTIN_TEMPLATES, buildTemplateActions, captureSelection, listTemplates,
  savedTemplateBuilder, toTemplate, type SavedTemplateData,
} from '../tools/templateTools';

const W = (word: string, start: number, end: number): TranscriptWord => ({ word, start, end });

/** Fixture with speech analysis + an analysed music bed so caption, zoom,
 * transition, colour and beat tools all have something real to work with. */
function fixture(): Project {
  let p = createProject('Template fixture', '16:9');
  const video: MediaAsset = { id: 'vid1', name: 'talk.mp4', type: 'video', duration: 30, width: 1920, height: 1080, hasAudio: true, source: 'file' };
  const music: MediaAsset = { id: 'mus1', name: 'bed.mp3', type: 'audio', duration: 60, width: 0, height: 0, hasAudio: true, source: 'file' };
  p = applyActions(p, [{ type: 'add_media', asset: video }, { type: 'add_media', asset: music }]);
  p = applyActions(p, [{ type: 'add_clip', clip: { trackId: p.tracks[0].id, mediaId: 'vid1', start: 0, duration: 30, inPoint: 0 } }]);

  const words: TranscriptWord[] = [
    W('hello', 0.2, 0.6), W('world', 0.7, 1.1),
    W('um', 2.5, 2.8), W('this', 2.9, 3.2), W('is', 3.3, 3.5), W('a', 3.6, 3.7), W('test', 3.8, 4.2),
    W('this', 5.4, 5.7), W('is', 5.8, 6.0), W('a', 6.1, 6.2), W('test', 6.3, 6.8),
    W('and', 7.0, 7.2), W('more', 7.3, 7.6), W('words', 7.7, 8.1), W('here', 8.2, 8.6),
    W('the', 9.0, 9.2), W('secret', 9.3, 9.8), W('is', 9.9, 10.1), W('consistency', 10.2, 11.0),
  ];
  const loudness = [];
  for (let t = 0; t < 30; t += 0.1) {
    const inSpeech = words.some((w) => t >= w.start - 0.05 && t <= w.end + 0.05);
    loudness.push({ t: Math.round(t * 10) / 10, rms: inSpeech ? 0.18 : 0.0008, peak: inSpeech ? 0.5 : 0.002 });
  }
  const faces = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5, x: 0.62, y: 0.4, w: 0.2, h: 0.3, conf: 0.8 }));
  const ma: MediaAnalysis = {
    mediaId: 'vid1', duration: 30,
    transcript: { segments: [{ start: 0.2, end: 11, text: words.map((w) => w.word).join(' '), words, speaker: 'Speaker A' }], words, model: 'test', complete: true },
    silences: [{ start: 1.1, end: 2.5 }, { start: 4.2, end: 5.4 }, { start: 11.0, end: 14.0 }],
    fillers: [{ start: 2.5, end: 2.8, text: 'um', wordIndices: [2, 2] }],
    retakes: [{ attempts: [{ start: 2.9, end: 4.2, text: 'this is a test' }, { start: 5.4, end: 6.8, text: 'this is a test' }], bestIndex: 1, start: 2.9, end: 5.4 }],
    scenes: [10, 20], faces, faceMethod: 'FaceDetector',
    loudness, integratedLoudness: -26, truePeak: 0.5, speechRatio: 0.8, isMusic: false,
    beats: [], bpm: 0, emphasis: [9.3, 5.4], keywords: ['secret', 'consistency', 'test'],
    analyzedAt: Date.now(), flags: [],
  };
  const mus: MediaAnalysis = {
    mediaId: 'mus1', duration: 60, silences: [], fillers: [], retakes: [], scenes: [], faces: [], faceMethod: 'none',
    loudness: Array.from({ length: 600 }, (_, i) => ({ t: i / 10, rms: 0.12, peak: 0.4 })),
    integratedLoudness: -18, truePeak: 0.4, speechRatio: 0.1, isMusic: true,
    beats: Array.from({ length: 120 }, (_, i) => i * 0.5), bpm: 120, emphasis: [], keywords: [], analyzedAt: Date.now(), flags: [],
  };
  return produce(p, (d) => {
    d.analysis = { byMedia: { vid1: ma, mus1: mus }, settings: { silenceThresholdDb: -38, silenceMinMs: 600 }, storyboard: '', updatedAt: Date.now() };
  });
}

describe('template library', () => {
  it('ships 20+ concrete templates across all requested categories', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(BUILTIN_TEMPLATES.map((t) => t.category));
    for (const c of ['Social', 'YouTube', 'Product', 'Slideshow', 'Podcast', 'Travel', 'Music']) {
      expect(categories.has(c as never)).toBe(true);
    }
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(BUILTIN_TEMPLATES.length);
    for (const t of BUILTIN_TEMPLATES) {
      expect(typeof t.build).toBe('function');
      expect(t.steps!.length).toBeGreaterThan(0);
      for (const step of t.steps!) expect(step.tool.length).toBeGreaterThan(0);
    }
  });

  it('produces valid actions from five named templates that apply cleanly', async () => {
    const named = ['tiktok-hook', 'youtube-intro', 'product-ad', 'podcast-clip', 'music-video'];
    for (const id of named) {
      const template = BUILTIN_TEMPLATES.find((t) => t.id === id)!;
      const p = fixture();
      const result = await buildTemplateActions(p, template);
      expect(result.actions.length, `${id} produced no actions`).toBeGreaterThan(0);
      expect(validateActions(p, result.actions), `${id} invalid actions`).toEqual([]);
      const after = applyActions(p, result.actions);
      expect(after.clips.length).toBeGreaterThan(0);
      expect(projectDuration(after)).toBeGreaterThan(0);
      expect(after.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
    }
  });

  it('every built-in template validates and applies against the fixture', async () => {
    for (const template of BUILTIN_TEMPLATES) {
      const p = fixture();
      const result = await buildTemplateActions(p, template);
      expect(validateActions(p, result.actions), `${template.id} invalid actions`).toEqual([]);
      const after = applyActions(p, result.actions);
      expect(after.clips.length, `${template.id} lost all clips`).toBeGreaterThan(0);
    }
  });

  it('commits a whole template as one undo step', async () => {
    const p = fixture();
    const template = BUILTIN_TEMPLATES.find((t) => t.id === 'shorts-fast')!;
    const { actions } = await buildTemplateActions(p, template);
    const history = new History(p);
    const applied = history.apply(actions, `Template: ${template.name}`);
    expect(history.canUndo).toBe(true);
    expect(history.depth).toBe(1);
    expect(applied).not.toBe(p);
    expect(history.undo()!.project).toBe(p);
    expect(history.redo()!.project).toBe(applied);
  });

  it('saves an editing recipe (not media) and replays it with real actions', async () => {
    let p = fixture();
    p = applyActions(p, [
      { type: 'add_effect', clipId: p.clips[0].id, effect: { type: 'vignette', params: { amount: 0.3 } } },
      { type: 'add_keyframe', clipId: p.clips[0].id, path: 'transform.scale', time: 1, value: 1.2 },
      { type: 'set_transform', clipId: p.clips[0].id, patch: { rotation: 3 } },
    ]);
    const data = captureSelection(p, [p.clips[0].id], 'My review look')!;
    expect(data.clipRecipes).toHaveLength(1);
    expect(data.clipRecipes[0].effects[0].type).toBe('vignette');
    expect(data.clipRecipes[0].keyframes[0].path).toBe('transform.scale');
    expect(data.clipRecipes[0].transform.rotation).toBe(3);
    expect(JSON.stringify(data)).not.toContain('blobKey');
    expect(JSON.stringify(data)).not.toContain('vid1');

    const fresh = fixture();
    const result = await savedTemplateBuilder(data)(fresh, [fresh.clips[0].id]);
    expect(result.actions.length).toBeGreaterThan(0);
    const replay = await toTemplate(data).build(fresh, [fresh.clips[0].id]);
    expect(validateActions(fresh, replay.actions)).toEqual([]);
    const after = applyActions(fresh, replay.actions);
    expect(after.clips[0].transform.rotation).toBe(3);
    expect(after.clips[0].effects.some((e) => e.type === 'vignette')).toBe(true);
  });

  it('lists built-ins together with saved templates', () => {
    expect(listTemplates().length).toBeGreaterThanOrEqual(BUILTIN_TEMPLATES.length);
    const data: SavedTemplateData = {
      source: 'saved', id: 'tpl_test', name: 'Local', category: 'Saved',
      aspect: '9:16', description: 'recipe', createdAt: 1,
      clipRecipes: [],
    };
    expect(toTemplate(data).category).toBe('Saved');
  });
});
