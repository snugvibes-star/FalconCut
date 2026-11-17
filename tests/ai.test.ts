import { describe, it, expect } from 'vitest';
import { createProject, applyActions, diffProjects } from '../engine';
import type { MediaAsset, Project } from '../engine/types';
import { parseAgentReply, validateCalls, extractJSON } from '../ai/protocol';
import { rulesPlan, planFromReply, buildProjectContext } from '../ai/planner';

function base(): Project {
  let p = createProject('Diff test', '16:9');
  const video: MediaAsset = { id: 'v1', name: 'a.mp4', type: 'video', duration: 20, width: 1920, height: 1080, hasAudio: true, source: 'file' };
  p = applyActions(p, [{ type: 'add_media', asset: video }]);
  p = applyActions(p, [{ type: 'add_clip', clip: { id: 'c1', trackId: p.tracks[0].id, mediaId: 'v1', start: 0, duration: 10, inPoint: 0 } }]);
  return p;
}

describe('diffProjects', () => {
  it('reports identical projects', () => {
    const p = base();
    const d = diffProjects(p, p);
    expect(d.identical).toBe(true);
    expect(d.summary).toBe('No changes.');
  });

  it('detects added, removed and modified clips', () => {
    const before = base();
    const after = applyActions(before, [
      { type: 'add_clip', clip: { id: 'c2', trackId: before.tracks[0].id, mediaId: 'v1', start: 10, duration: 5, inPoint: 10 } },
      { type: 'set_clip_props', clipId: 'c1', patch: { volume: 0.5 } },
    ]);
    const removed = applyActions(after, [{ type: 'remove_clip', clipId: 'c2' }]);
    const d = diffProjects(before, after);
    expect(d.added.map((c) => c.id)).toEqual(['c2']);
    expect(d.modified.map((c) => c.id)).toEqual(['c1']);
    expect(d.modified[0].fields).toContain('volume');
    const d2 = diffProjects(after, removed);
    expect(d2.removed.map((c) => c.id)).toEqual(['c2']);
  });

  it('summarizes duration and settings changes', () => {
    const before = base();
    const after = applyActions(before, [
      { type: 'trim_clip', clipId: 'c1', duration: 6 },
      { type: 'set_settings', patch: { aspect: '9:16', width: 1080, height: 1920 } },
    ]);
    const d = diffProjects(before, after);
    expect(d.durationBefore).toBe(10);
    expect(d.durationAfter).toBe(6);
    expect(d.settingsChanged).toContain('aspect');
    expect(d.summary).toContain('duration');
  });
});

describe('AI protocol', () => {
  it('extracts JSON from code fences and prose', () => {
    expect(extractJSON('here you go:\n```json\n{"calls":[{"tool":"auto_edit"}]}\n```')).toBeTruthy();
    expect(extractJSON('sure! {"calls":[]} hope that helps')).toEqual({ calls: [] });
    expect(extractJSON('no json at all')).toBeNull();
  });

  it('parses object, array and single-tool replies', () => {
    const obj = parseAgentReply('{"thought":"tighten","say":"On it","calls":[{"tool":"remove_dead_air","params":{"max_pause_ms":600},"why":"slow"}]}');
    expect(obj.calls).toHaveLength(1);
    expect(obj.calls[0].tool).toBe('remove_dead_air');
    expect(obj.calls[0].why).toBe('slow');
    expect(obj.say).toBe('On it');
    const arr = parseAgentReply('[{"tool":"auto_edit"},{"name":"auto_fix"}]');
    expect(arr.calls.map((c) => c.tool)).toEqual(['auto_edit', 'auto_fix']);
    const single = parseAgentReply('{"tool":"add_captions","params":{"style":"karaoke"}}');
    expect(single.calls[0].tool).toBe('add_captions');
  });

  it('falls back to prose when there is no JSON', () => {
    const r = parseAgentReply('I cannot do that.');
    expect(r.calls).toEqual([]);
    expect(r.say).toBe('I cannot do that.');
  });

  it('validates tools, coerces numbers and fixes bad enums', () => {
    const { valid, errors } = validateCalls([
      { tool: 'remove_dead_air', params: { max_pause_ms: '600' } },
      { tool: 'add_captions', params: { style: 'sparkle' } },
      { tool: 'not_a_tool', params: {} },
    ]);
    expect(valid.map((c) => c.tool)).toEqual(['remove_dead_air', 'add_captions']);
    expect(valid[0].params!.max_pause_ms).toBe(600);
    expect(valid[1].params!.style).not.toBe('sparkle');
    expect(errors.some((e) => e.includes('not_a_tool'))).toBe(true);
  });
});

describe('planner', () => {
  it('rules fallback always proposes auto_edit + auto_fix', () => {
    const plan = rulesPlan(base());
    expect(plan.source).toBe('rules');
    expect(plan.steps.map((s) => s.tool)).toEqual(['auto_edit', 'auto_fix']);
  });

  it('builds context with tools and project info', () => {
    const ctx = buildProjectContext(base());
    expect(ctx).toContain('Diff test');
    expect(ctx).toContain('auto_edit');
    expect(ctx).toContain('TOOLS');
  });

  it('maps a reply to a reviewable plan', () => {
    const reply = parseAgentReply('{"say":"Tightening","calls":[{"tool":"remove_dead_air","params":{},"why":"too slow"},{"tool":"auto_fix","params":{}}]}');
    const { valid } = validateCalls(reply.calls);
    const plan = planFromReply({ ...reply, calls: valid });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].why).toBe('too slow');
    expect(plan.summary).toBe('Tightening');
  });
});