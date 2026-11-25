import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory localStorage so profile/task/usage persistence can be tested in Node.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
});

import {
  listAIProfiles, saveAIProfile, deleteAIProfile, getActiveAIProfileId, setActiveAIProfile,
  resolveAISettings, getAITaskSettings, setAITaskSetting, resolveAISettingsForTask,
  recordUsage, usageSummary, listUsage, DEFAULT_AI_PROFILE, saveAISettings,
  listDisabledTools, setToolEnabled, isToolEnabled, profileIdForTask,
  type AIProfile,
} from '../ai/client';

import { validateCalls } from '../ai/protocol';
import { toolsPromptText, toolManifest, TOOLS } from '../tools/registry';

function profile(id: string, name: string): AIProfile {
  return {
    id, name, endpoint: 'https://api.openai.com/v1/chat/completions', apiKey: `key-${id}`,
    model: 'gpt-4o-mini', temperature: 0.4, maxTokens: 0, provider: 'openai',
    createdAt: 1, updatedAt: 1,
  };
}

describe('AI profiles', () => {
  beforeEach(() => { mem.clear(); });

  it('starts with the default profile', () => {
    const list = listAIProfiles();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('default');
    expect(getActiveAIProfileId()).toBeNull();
  });

  it('saves, activates and resolves settings from a profile', () => {
    saveAIProfile(profile('p1', 'Planning'));
    saveAIProfile({ ...profile('p2', 'Captions'), endpoint: 'https://generativelanguage.googleapis.com/v1beta/models', model: 'gemini-3.8-flash', provider: 'gemini', temperature: 0.8 });
    expect(listAIProfiles().length).toBe(3);

    setActiveAIProfile('p2');
    expect(getActiveAIProfileId()).toBe('p2');
    const resolved = resolveAISettings();
    expect(resolved.model).toBe('gemini-3.8-flash');
    expect(resolved.provider).toBe('gemini');
    expect(resolved.temperature).toBe(0.8);
  });

  it('updates an existing profile without duplicating it', () => {
    saveAIProfile(profile('p1', 'First'));
    saveAIProfile({ ...profile('p1', 'Renamed'), temperature: 1.2 });
    const list = listAIProfiles();
    expect(list.length).toBe(2); // default + p1
    expect(list.find((p) => p.id === 'p1')!.name).toBe('Renamed');
    expect(list.find((p) => p.id === 'p1')!.temperature).toBe(1.2);
  });

  it('deleting the active profile falls back safely', () => {
    saveAIProfile(profile('p1', 'One'));
    setActiveAIProfile('p1');
    deleteAIProfile('p1');
    // No connected profile remains, so the legacy Settings connection is used.
    expect(getActiveAIProfileId()).toBeNull();
    expect(listAIProfiles().some((p) => p.id === 'p1')).toBe(false);
    // Resolving after deletion still works.
    expect(resolveAISettings().model).toBeTruthy();
  });
});

describe('per-task AI settings', () => {
  beforeEach(() => { mem.clear(); });

  it('task overrides win over the profile, with unconfigured tasks inheriting', () => {
    saveAIProfile({ ...profile('p1', 'One'), temperature: 0.4, maxTokens: 0 });
    setActiveAIProfile('p1');
    setAITaskSetting('plan', { temperature: 0.1, maxTokens: 2048 });

    const plan = resolveAISettingsForTask('plan');
    expect(plan.temperature).toBe(0.1);
    expect(plan.maxTokens).toBe(2048);

    const chat = resolveAISettingsForTask('chat');
    expect(chat.temperature).toBe(0.4); // inherits profile
  });

  it('tasks persist across module reads', () => {
    setAITaskSetting('caption', { temperature: 0.9 });
    expect(getAITaskSettings().caption.temperature).toBe(0.9);
    // Unconfigured tasks inherit the active profile; there is no invented default.
    expect(getAITaskSettings().plan.temperature).toBeUndefined();
  });

  it('treats 0 as inherit and routes a task through another profile', () => {
    saveAIProfile({ ...profile('p1', 'One'), temperature: 0.4 });
    saveAIProfile({ ...profile('p2', 'Translator'), endpoint: 'https://generativelanguage.googleapis.com/v1beta/models:generateContent', model: 'gemini-3.8-flash', provider: 'gemini', temperature: 0.9 });
    setActiveAIProfile('p1');

    setAITaskSetting('translate', { temperature: 0, maxTokens: 0 });
    expect(getAITaskSettings().translate).toEqual({});
    expect(resolveAISettingsForTask('translate').temperature).toBe(0.4);

    setAITaskSetting('translate', { profileId: 'p2', temperature: 0.2 });
    const routed = resolveAISettingsForTask('translate');
    expect(routed.model).toBe('gemini-3.8-flash');
    expect(routed.temperature).toBe(0.2);
    expect(profileIdForTask('translate')).toBe('p2');

    deleteAIProfile('p2');
    expect(resolveAISettingsForTask('translate').model).toBe('gpt-4o-mini');
  });

  it('falls back to legacy Settings when no profile is active', () => {
    saveAISettings({ apiKey: 'sk-legacy', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', temperature: 1.1 });
    setActiveAIProfile(null);
    expect(resolveAISettings().apiKey).toBe('sk-legacy');
    expect(resolveAISettings().temperature).toBe(1.1);
  });
});

describe('AI usage tracking', () => {
  beforeEach(() => { mem.clear(); });

  it('records calls and summarizes them', () => {
    recordUsage('p1', 'chat', 'gpt-4o-mini', true, 400);
    recordUsage('p1', 'plan', 'gpt-4o-mini', false, 800);
    recordUsage('p2', 'caption', 'gemini', true, 200);

    const summary = usageSummary();
    expect(summary.calls).toBe(3);
    expect(summary.ok).toBe(2);
    expect(summary.fail).toBe(1);
    expect(summary.byTask.chat).toBe(1);
    expect(summary.byTask.plan).toBe(1);
    expect(summary.byTask.caption).toBe(1);
    expect(summary.tokens).toBeGreaterThan(0);
    expect(summary.costUsd).toBeGreaterThan(0);
    expect(listUsage().length).toBe(3);
  });

  it('cost estimate is non-negative and bounded', () => {
    recordUsage('p1', 'chat', 'm', true, 0);
    const summary = usageSummary();
    expect(summary.costUsd).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(summary.costUsd)).toBe(true);
  });
});

describe('AI tool permissions', () => {
  beforeEach(() => { mem.clear(); });

  it('persists a disabled-tool list', () => {
    expect(listDisabledTools()).toEqual([]);
    setToolEnabled('remove_dead_air', false);
    expect(listDisabledTools()).toContain('remove_dead_air');
    expect(isToolEnabled('remove_dead_air')).toBe(false);
    setToolEnabled('remove_dead_air', true);
    expect(isToolEnabled('remove_dead_air')).toBe(true);
  });

  it('hides disabled tools from prompts and rejects model calls to them', () => {
    setToolEnabled('add_captions', false);
    expect(toolsPromptText()).not.toContain('add_captions(');
    expect(toolManifest().some((t) => t.name === 'add_captions')).toBe(false);
    expect(toolsPromptText()).toContain('add_text(');
    const r = validateCalls([
      { tool: 'add_captions', params: {} },
      { tool: 'add_text', params: { text: 'Hi' } },
    ]);
    expect(r.valid.map((c) => c.tool)).toEqual(['add_text']);
    expect(r.errors.join(' ')).toContain('turned off');
  });

  it('the catalog count is derived from the registry', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
  });
});

describe('default profile shape', () => {
  it('has the expected fields', () => {
    expect(DEFAULT_AI_PROFILE.provider).toBe('openai');
    expect(DEFAULT_AI_PROFILE.maxTokens).toBe(0);
    expect(DEFAULT_AI_PROFILE.name).toBe('Default');
  });
});
