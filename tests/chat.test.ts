import { describe, it, expect } from 'vitest';
import { createProject, applyActions } from '../engine';
import type { MediaAsset, Project } from '../engine/types';
import { respond, undoIntent } from '../ai/agent';
import { parseTextRequest, rulesPlan, buildProjectContext } from '../ai/planner';
import { runTool, TOOL_MAP } from '../tools/registry';
import { DEFAULT_AI_SETTINGS } from '../ai/client';

/** No key: exercises the rules path, which is the one users see out of the box. */
const offline = { ...DEFAULT_AI_SETTINGS, apiKey: '' };

function project(): Project {
  const video: MediaAsset = { id: 'v1', name: 'a.mp4', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, source: 'file' };
  let p = createProject('Chat test', '16:9');
  p = applyActions(p, [{ type: 'add_media', asset: video }]);
  p = applyActions(p, [{ type: 'add_clip', clip: { id: 'c1', trackId: p.tracks[0].id, mediaId: 'v1', start: 0, duration: 10, inPoint: 0 } }]);
  return p;
}

describe('chat decides chat vs edit', () => {
  it('answers "hello" without any plan', async () => {
    const turn = await respond(project(), 'hello', [], offline);
    expect(turn.mode).toBe('chat');
    expect(turn.plan).toBeUndefined();
    expect(turn.text).toMatch(/hi/i);
  });

  it('answers "what can you do?" in plain text', async () => {
    const turn = await respond(project(), 'what can you do?', [], offline);
    expect(turn.mode).toBe('chat');
    expect(turn.plan).toBeUndefined();
    expect(turn.text).toMatch(/caption/i);
    expect(turn.text).toMatch(/Settings/);
  });

  it('does not turn a casual question into a plan', async () => {
    for (const q of ['who are you', 'how are you?', 'thanks!']) {
      const turn = await respond(project(), q, [], offline);
      expect(turn.mode, q).toBe('chat');
      expect(turn.plan, q).toBeUndefined();
    }
  });

  it('reads "add text Welcome at the top and make it bold" as one direct action', async () => {
    const turn = await respond(project(), "add text 'Welcome' at the top and make it bold", [], offline);
    expect(turn.mode).toBe('action');
    expect(turn.plan?.steps).toHaveLength(1);
    const step = turn.plan!.steps[0];
    expect(step.tool).toBe('add_text');
    expect(step.params).toMatchObject({ text: 'Welcome', position: 'top', bold: true });
  });

  it('adds the title for real through the engine', async () => {
    const params = parseTextRequest("add text 'Welcome' at the top and make it bold")!;
    const p = project();
    const r = await runTool(p, 'add_text', params);
    expect(r.actions).toHaveLength(1);
    const after = applyActions(p, r.actions);
    const clip = after.clips.find((c) => c.kind === 'text');
    expect(clip?.text?.text).toBe('Welcome');
    expect(clip?.text?.role).toBe('title');
    expect(clip?.text?.style.fontWeight).toBe(900);
    expect(clip!.text!.style.y).toBeLessThan(0.3);
  });

  it('shows a plan only for multi-step work, and every step is a real tool', async () => {
    const turn = await respond(project(), 'make this a cinematic tiktok with captions and remove dead air', [], offline);
    expect(turn.mode).toBe('plan');
    expect(turn.plan!.steps.length).toBeGreaterThanOrEqual(3);
    for (const s of turn.plan!.steps) expect(TOOL_MAP.has(s.tool), s.tool).toBe(true);
    // No invented tool names in the visible text either.
    expect(turn.text).not.toMatch(/[a-z]+_[a-z]+/);
  });
});

describe('rules router', () => {
  it('understands undo/redo without a model', () => {
    expect(undoIntent('undo that')).toBe('undo');
    expect(undoIntent('Undo the last edit.')).toBe('undo');
    expect(undoIntent('redo')).toBe('redo');
    expect(undoIntent('remove the pauses')).toBeNull();
  });

  it('text requests keep their position and colour', () => {
    expect(parseTextRequest('put the text "Sale" at the bottom in red')).toMatchObject({ text: 'Sale', position: 'bottom', color: 'red' });
    expect(parseTextRequest('add a title')).toBeNull();
  });
});

describe('timeline control', () => {
  it('gives the model real clip ids', () => {
    expect(buildProjectContext(project())).toContain('c1 · V1 · 0.0–10.0s');
  });

  it('trims the first clip for "trim the first 5 seconds"', async () => {
    const plan = rulesPlan(project(), 'trim the first 5 seconds');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].tool).toBe('timeline_edit');
    expect(plan.steps[0].params).toMatchObject({ clip_id: 'c1', operation: 'trim_start', value: 5 });

    const p = project();
    const r = await runTool(p, 'timeline_edit', plan.steps[0].params);
    const after = applyActions(p, r.actions);
    const clip = after.clips.find((c) => c.id === 'c1')!;
    expect(clip.start).toBe(5);
    expect(clip.duration).toBeCloseTo(5);
  });

  it('deletes, splits and changes speed on a named clip', async () => {
    const p = project();
    const del = await runTool(p, 'timeline_edit', { clip_id: 'c1', operation: 'delete' });
    expect(applyActions(p, del.actions).clips).toHaveLength(0);
    const split = await runTool(p, 'timeline_edit', { clip_id: 'c1', operation: 'split', value: 4 });
    expect(applyActions(p, split.actions).clips).toHaveLength(2);
    const speed = await runTool(p, 'timeline_edit', { clip_id: 'c1', operation: 'speed', value: 2 });
    expect(applyActions(p, speed.actions).clips[0].speed).toBe(2);
  });
});
