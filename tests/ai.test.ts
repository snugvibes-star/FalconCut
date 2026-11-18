import { describe, it, expect } from 'vitest';
import { createProject, applyActions, diffProjects } from '../engine';
import type { MediaAsset, Project } from '../engine/types';
import { parseAgentReply, validateCalls, extractJSON } from '../ai/protocol';
import { rulesPlan, planFromReply, buildProjectContext } from '../ai/planner';
import { hasAI, isLocalEndpoint, providerOf, PROVIDER_PRESETS, COMPATIBLE_PRESETS, OPENROUTER_ENDPOINT, GEMINI_MODEL } from '../ai/client';

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

describe('AI provider resolution', () => {
  const base = { temperature: 0.4, model: 'some-model' };

  it('resolves the protocol from the explicit field or the endpoint URL', () => {
    expect(providerOf({ ...base, endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'k' })).toBe('openai');
    expect(providerOf({ ...base, endpoint: OPENROUTER_ENDPOINT, apiKey: 'k' })).toBe('openrouter');
    expect(providerOf({ ...base, endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', apiKey: 'k' })).toBe('gemini');
    // An explicit provider wins over a URL that looks like another provider.
    expect(providerOf({ ...base, endpoint: OPENROUTER_ENDPOINT, apiKey: 'k', provider: 'openai' })).toBe('openai');
  });

  it('requires a key for remote endpoints but not for local servers', () => {
    expect(hasAI({ ...base, endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: '' })).toBe(false);
    expect(hasAI({ ...base, endpoint: 'http://localhost:11434/v1/chat/completions', apiKey: '' })).toBe(true);
    expect(hasAI({ ...base, endpoint: 'http://127.0.0.1:1234/v1/chat/completions', apiKey: '' })).toBe(true);
    expect(isLocalEndpoint('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(hasAI({ ...base, endpoint: '', apiKey: 'k' })).toBe(false);
  });

  it('ships a usable preset for every provider', () => {
    for (const p of ['openai', 'openrouter', 'gemini'] as const) {
      expect(PROVIDER_PRESETS[p].endpoint).toMatch(/^https:\/\//);
      expect(PROVIDER_PRESETS[p].model.length).toBeGreaterThan(0);
    }
    expect(PROVIDER_PRESETS.gemini.endpoint).toContain(':generateContent');
    expect(PROVIDER_PRESETS.gemini.model).toBe(GEMINI_MODEL);
    // "OpenAI" means the OpenAI-*compatible protocol, not one vendor's GPT models.
    expect(PROVIDER_PRESETS.openai.label).toMatch(/compatible/i);
  });

  it('offers OpenAI-compatible vendor presets that are all real chat-completions URLs', () => {
    expect(COMPATIBLE_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of COMPATIBLE_PRESETS) {
      // Every preset must be a concrete completions endpoint, not a bare host.
      expect(preset.endpoint).toMatch(/\/chat\/completions$/);
      // …and must be recognised as the OpenAI protocol by the client.
      expect(providerOf({ temperature: 0.4, model: 'm', endpoint: preset.endpoint, apiKey: '' })).toBe('openai');
      // Local presets are the only keyless ones, and they must be loopback.
      if (preset.local) expect(isLocalEndpoint(preset.endpoint)).toBe(true);
      else expect(isLocalEndpoint(preset.endpoint)).toBe(false);
    }
    expect(COMPATIBLE_PRESETS.some((p) => p.label.startsWith('Groq'))).toBe(true);
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