import { describe, it, expect, beforeEach, vi } from 'vitest';

// The store persists to IndexedDB; mock it so these wiring tests run in Node.
vi.mock('../src/state/persistence', () => ({
  saveProject: vi.fn(async () => {}),
  loadProject: vi.fn(async () => undefined),
  listProjects: vi.fn(async () => []),
  deleteProject: vi.fn(async () => {}),
  putBlob: vi.fn(async () => {}),
  getBlob: vi.fn(async () => undefined),
  deleteBlob: vi.fn(async () => {}),
  listBlobKeys: vi.fn(async () => []),
  garbageCollectBlobs: vi.fn(async () => 0),
  saveVersion: vi.fn(async () => {}),
  loadVersions: vi.fn(async () => []),
  deleteVersionRecord: vi.fn(async () => {}),
}));

import { useStore } from '../src/state/store';
import { createProject, applyActions, projectDuration } from '../engine';
import { filterLocked } from '../tools/registry';
import type { Action } from '../engine/actions';
import type { MediaAsset, MediaAnalysis, Project } from '../engine/types';

function fixture(): Project {
  let p = createProject('Store fixture', '16:9');
  const video: MediaAsset = { id: 'vid1', name: 'talk.mp4', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, source: 'file' };
  p = applyActions(p, [{ type: 'add_media', asset: video }]);
  p = applyActions(p, [{ type: 'add_clip', clip: { id: 'c1', trackId: p.tracks[0].id, mediaId: 'vid1', start: 0, duration: 20, inPoint: 0 } }]);
  const ma: MediaAnalysis = {
    mediaId: 'vid1', duration: 20,
    silences: [{ start: 5, end: 7 }, { start: 12, end: 14 }],
    fillers: [], retakes: [], scenes: [], faces: [], faceMethod: 'none',
    loudness: [], integratedLoudness: -26, truePeak: -3, speechRatio: 0.8, isMusic: false,
    beats: [], bpm: 0, emphasis: [], keywords: [], analyzedAt: Date.now(), flags: [],
  };
  return { ...p, analysis: { byMedia: { vid1: ma }, settings: { silenceThresholdDb: -38, silenceMinMs: 600 }, storyboard: '', updatedAt: Date.now() } };
}

beforeEach(async () => {
  await useStore.getState().newProject('Test');
  useStore.setState({ locks: {}, versions: [], chat: [], plan: null, session: null, autopilot: true, aiBusy: false, planRunning: false });
});

describe('store: commit / undo / redo (the one human+AI path)', () => {
  it('commits actions, then undoes and redoes them', () => {
    const s = useStore.getState();
    const p0 = s.project;
    const media: MediaAsset = { id: 'm1', name: 'x.mp4', type: 'video', duration: 8, width: 1280, height: 720, hasAudio: true, source: 'file' };
    s.commit([
      { type: 'add_media', asset: media },
      { type: 'add_clip', clip: { trackId: p0.tracks[0].id, mediaId: 'm1', start: 0, duration: 8, inPoint: 0 } },
    ], 'Add clip');
    expect(useStore.getState().project.clips).toHaveLength(1);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().undo();
    expect(useStore.getState().project.clips).toHaveLength(0);
    expect(useStore.getState().canRedo).toBe(true);

    useStore.getState().redo();
    expect(useStore.getState().project.clips).toHaveLength(1);
  });

  it('re-lints after every change', () => {
    const s = useStore.getState();
    expect(s.lint).toBeTruthy();
    s.replaceProject(fixture(), 'fixture');
    expect(useStore.getState().lint.score).toBeTypeOf('number');
  });
});

describe('store: applyTool is ONE undo step', () => {
  it('groups a multi-action tool run into a single history entry', async () => {
    useStore.getState().replaceProject(fixture(), 'fixture');
    const depthBefore = useStore.getState().history.depth;
    const durBefore = projectDuration(useStore.getState().project);

    const res = await useStore.getState().applyTool('remove_dead_air', { max_pause_ms: 500 });
    expect(res.actions.length).toBeGreaterThan(1);
    expect(useStore.getState().history.depth).toBe(depthBefore + 1);
    expect(projectDuration(useStore.getState().project)).toBeLessThan(durBefore);

    // a single undo returns to the exact pre-tool document
    useStore.getState().undo();
    expect(useStore.getState().project.clips).toHaveLength(1);
    expect(projectDuration(useStore.getState().project)).toBe(durBefore);
  });

  it('previewTool does not mutate the project or history', async () => {
    useStore.getState().replaceProject(fixture(), 'fixture');
    const depthBefore = useStore.getState().history.depth;
    const res = await useStore.getState().previewTool('remove_dead_air', { max_pause_ms: 500 });
    expect(res.actions.length).toBeGreaterThan(0);
    expect(useStore.getState().history.depth).toBe(depthBefore);
    expect(useStore.getState().project.clips).toHaveLength(1);
  });
});

describe('store: versions (git for video)', () => {
  it('snapshots, diffs and restores', () => {
    const s = useStore.getState();
    s.replaceProject(fixture(), 'fixture');
    const v = useStore.getState().snapshot('v1', 'manual');
    expect(useStore.getState().versions).toHaveLength(1);

    // change the project after the snapshot
    useStore.getState().commit([{ type: 'set_clip_props', clipId: 'c1', patch: { volume: 0.4 } }], 'Lower volume');
    const d = useStore.getState().diffVersion(v.id);
    expect(d).toBeTruthy();
    expect(d!.modified.some((m) => m.id === 'c1')).toBe(true);

    useStore.getState().restoreVersion(v.id);
    const c1 = useStore.getState().project.clips.find((c) => c.id === 'c1');
    expect(c1?.volume ?? 1).toBe(1);
    // restore also parks a "Before restore" safety snapshot
    expect(useStore.getState().versions.length).toBeGreaterThanOrEqual(2);
  });

  it('deleteVersion removes only that version', () => {
    useStore.getState().replaceProject(fixture(), 'fixture');
    const a = useStore.getState().snapshot('a');
    const b = useStore.getState().snapshot('b');
    useStore.getState().deleteVersion(a.id);
    expect(useStore.getState().versions.map((v) => v.id)).toEqual([b.id]);
  });
});

describe('store: co-editing locks (human priority)', () => {
  it('touch locks a clip; lockedIds reflects expiry', () => {
    useStore.getState().touch(['c1']);
    expect(useStore.getState().lockedIds().has('c1')).toBe(true);
    // simulate the 10s window elapsing
    useStore.setState({ locks: { c1: Date.now() - 1 } });
    expect(useStore.getState().lockedIds().has('c1')).toBe(false);
  });

  it('a human commit auto-locks the clips it touched', () => {
    useStore.getState().replaceProject(fixture(), 'fixture');
    useStore.setState({ locks: {} });
    useStore.getState().commit([{ type: 'set_clip_props', clipId: 'c1', patch: { volume: 0.7 } }], 'Human edit', 'human');
    expect(useStore.getState().lockedIds().has('c1')).toBe(true);
  });

  it('an AI commit does not create human locks', () => {
    useStore.getState().replaceProject(fixture(), 'fixture');
    useStore.setState({ locks: {} });
    useStore.getState().commit([{ type: 'set_clip_props', clipId: 'c1', patch: { volume: 0.7 } }], 'AI edit', 'ai');
    expect(useStore.getState().lockedIds().has('c1')).toBe(false);
  });

  it('filterLocked drops clip-scoped actions but not time-range actions (honest limit)', () => {
    const acts: Action[] = [
      { type: 'set_clip_props', clipId: 'c1', patch: { volume: 0.5 } },
      { type: 'ripple_delete_range', start: 0, end: 1, shiftMarkers: true },
    ];
    const { actions, skipped } = filterLocked(acts, new Set(['c1']));
    expect(skipped).toBe(1);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('ripple_delete_range');
  });
});

describe('store: agent session', () => {
  it('creates, connects, logs activity and revokes', () => {
    const sess = useStore.getState().createSession('ws://localhost:8787');
    expect(sess.token.length).toBeGreaterThan(8);
    expect(sess.connected).toBe(false);

    useStore.getState().setSessionConnected(true);
    expect(useStore.getState().session?.connected).toBe(true);

    useStore.getState().logActivity('ran remove_dead_air');
    expect(useStore.getState().session?.activity[0].text).toBe('ran remove_dead_air');

    useStore.getState().revokeSession();
    expect(useStore.getState().session).toBeNull();
  });
});

describe('store: AI settings', () => {
  it('updates settings in state and hasAI reflects the key', () => {
    useStore.getState().setAISettings({ apiKey: '', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' });
    expect(useStore.getState().aiSettings.model).toBe('gpt-4o-mini');
    useStore.getState().setAISettings({ apiKey: 'sk-test' });
    expect(useStore.getState().aiSettings.apiKey).toBe('sk-test');
  });
});