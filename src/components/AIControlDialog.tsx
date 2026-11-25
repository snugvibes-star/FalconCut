import { useState } from 'react';
import {
  Bot, Plus, Trash2, Check, Settings2, BarChart3, SlidersHorizontal, BookOpen,
  Shield, Zap, RotateCcw,
} from 'lucide-react';
import {
  listAIProfiles, getActiveAIProfileId, setActiveAIProfile, saveAIProfile, deleteAIProfile,
  getAITaskSettings, setAITaskSetting, usageSummary, listUsage, resolveAISettings,
  resolveAISettingsForTask, hasAI, providerOf, getAIProfile, PROVIDER_PRESETS, AI_TASKS,
  listDisabledTools, setToolEnabled,
  type AIProfile, type AITask, type AIProvider,
} from '../../ai/client';
import { TOOLS, toolLabel } from '../../tools/registry';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';

type Tab = 'profiles' | 'tasks' | 'tools' | 'usage';

const TASKS: { id: AITask; label: string; desc: string }[] = [
  { id: 'chat', label: 'Chat', desc: 'Everyday conversation and questions' },
  { id: 'plan', label: 'Edit planning', desc: 'Turning your requests into tool calls' },
  { id: 'caption', label: 'Captions', desc: 'Caption generation and styling' },
  { id: 'translate', label: 'Translation', desc: 'Translating captions between languages' },
  { id: 'analysis', label: 'Analysis', desc: 'Summaries, storyboards and judgments' },
];

const TABS: { id: Tab; label: string; icon: typeof Bot }[] = [
  { id: 'profiles', label: 'Profiles', icon: Bot },
  { id: 'tasks', label: 'Tasks', icon: SlidersHorizontal },
  { id: 'tools', label: 'Tools', icon: BookOpen },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
];

/** Display grouping only. The catalog itself always comes from the registry,
 * with a fallback group so a newly added tool is never hidden from the UI. */
const TOOL_GROUPS: { name: string; tools: string[] }[] = [
  { name: 'Timeline & structure', tools: ['add_text','timeline_edit','remove_dead_air','remove_fillers','cut_retakes','crop_region','duplicate_clip','reverse_clip','remove_section','manage_track','group_clips','time_range_edit'] },
  { name: 'Captions', tools: ['add_captions','add_hook_title','translate_captions','restyle_captions','shift_captions','fix_caption_timing','import_captions','set_caption_style_advanced','set_caption_highlight','set_caption_effects','edit_caption_word'] },
  { name: 'Motion & style', tools: ['zoom_on_emphasis','reframe','add_transitions','snap_to_beats','add_motif','apply_color_preset','add_broll_slots','auto_broll','set_clip_look','set_clip_look_advanced','set_blend_mode','set_clip_fades','label_clips'] },
  { name: 'Effects & animation', tools: ['add_effect','configure_effect','remove_effect','animate_property','speed_ramp','apply_mask','set_clip_transition'] },
  { name: 'Audio & music', tools: ['add_music','balance_audio','cleanup_audio'] },
  { name: 'Automation', tools: ['auto_edit','auto_fix','smart_cutdown','ab_variants','auto_multicam','set_project_settings_ai'] },
  { name: 'Markers & notes', tools: ['add_marker','add_marker_advanced','add_review_note'] },
];

function validEndpoint(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

export function AIControlDialog() {
  const close = () => useUI.getState().close('aiControl');
  const toast = useUI((s) => s.toast);
  const [tab, setTab] = useState<Tab>('profiles');
  const [profiles, setProfiles] = useState<AIProfile[]>(() => listAIProfiles());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveAIProfileId());
  const [editing, setEditing] = useState<AIProfile | null>(null);
  const [taskSettings, setTaskSettings] = useState(() => getAITaskSettings());
  const [usage, setUsage] = useState(() => usageSummary());
  const [disabledTools, setDisabledTools] = useState<string[]>(() => listDisabledTools());
  const [, force] = useState(0);

  const refresh = () => {
    setProfiles(listAIProfiles());
    setActiveId(getActiveAIProfileId());
    setTaskSettings(getAITaskSettings());
    setUsage(usageSummary());
    setDisabledTools(listDisabledTools());
    // Keep the chat's "connected" badge and Settings form in step with profiles.
    useStore.getState().refreshAISettings();
    force((n) => n + 1);
  };

  const newProfile = () => {
    const preset = PROVIDER_PRESETS.openai;
    setEditing({
      id: `prof_${Date.now().toString(36)}`,
      name: 'New profile',
      endpoint: preset.endpoint,
      apiKey: '',
      model: preset.model,
      temperature: 0.4,
      maxTokens: 0,
      provider: 'openai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  const saveProfile = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.model.trim()) {
      toast('Give the profile a name and a model.', 'error');
      return;
    }
    if (!validEndpoint(editing.endpoint)) {
      toast('Enter a valid http(s) endpoint URL.', 'error');
      return;
    }
    const wasConnected = hasAI(resolveAISettings());
    saveAIProfile(editing);
    // A first working profile should just work — don't leave the user staring
    // at a key they saved while the chat still says "not connected".
    if (!wasConnected && hasAI(editing)) setActiveAIProfile(editing.id);
    setEditing(null);
    refresh();
    toast(`Profile "${editing.name}" saved.`, 'success');
  };

  const removeProfile = (id: string) => {
    if (!window.confirm('Delete this AI profile? Tasks routed to it will fall back to the active profile.')) return;
    deleteAIProfile(id);
    refresh();
    toast('Profile deleted.', 'info');
  };

  const activate = (id: string) => {
    setActiveAIProfile(id);
    refresh();
    toast('Active AI profile switched.', 'success');
  };

  const setTask = (task: AITask, patch: { profileId?: string; temperature?: number; maxTokens?: number }) => {
    setAITaskSetting(task, patch);
    refresh();
  };

  const toggleTool = (name: string) => {
    setToolEnabled(name, disabledTools.includes(name));
    refresh();
  };

  const allTools = (enabled: boolean) => {
    if (!enabled && !window.confirm('Hide every tool from AI calls? Buttons and the command palette will still work.')) return;
    for (const t of TOOLS) setToolEnabled(t.name, enabled);
    refresh();
    toast(enabled ? 'All AI tools enabled.' : 'All AI tools hidden from AI calls.', 'info');
  };

  const resolved = resolveAISettings();
  const connected = hasAI(resolved);
  const profileName = (id: string) => id === 'active' ? 'Active profile'
    : profiles.find((p) => p.id === id)?.name ?? (id === 'settings' ? 'Settings key' : id);
  const assigned = new Set(TOOL_GROUPS.flatMap((g) => g.tools));
  const groups = [...TOOL_GROUPS.map((g) => ({ name: g.name, tools: g.tools.filter((t) => TOOLS.some((d) => d.name === t)) })),
    { name: 'Other tools', tools: TOOLS.filter((t) => !assigned.has(t.name)).map((t) => t.name) }]
    .filter((g) => g.tools.length > 0);

  return (
    <Dialog title="AI Control Center" onClose={close}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-paper-dim">
          Manage AI profiles, per-task behavior, tool permissions and usage. Every editing tool works without AI;
          a key only adds free-form chat and model-planned edits. Keys stay in this browser's local storage.
        </p>
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${connected ? 'border-heat-green/40 bg-heat-green/5 text-heat-green' : 'border-line bg-ink-850 text-paper-dim'}`}>
          {connected ? <Shield size={14} /> : <Zap size={14} />}
          <span>{connected ? `Connected: ${resolved.model} (${providerOf(resolved)})` : 'No AI connected — using the built-in rules engine.'}</span>
        </div>

        <div className="cf-hscroll flex items-center gap-1 border-b border-line pb-2" role="tablist" aria-label="AI control sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${tab === id ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
              onClick={() => setTab(id)}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* ---- Profiles ---- */}
        {tab === 'profiles' && (
          <section className="space-y-3" aria-label="AI profiles">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-paper-dim">Keep separate keys for different jobs, then switch instantly.</p>
              <button className="btn-solid text-xs py-1.5 flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" onClick={newProfile}>
                <Plus size={13} /> New profile
              </button>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto panel bg-ink-850 p-2">
              {profiles.map((p) => (
                <div key={p.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${activeId === p.id ? 'border-signal/60 bg-signal/5' : 'border-line'}`}>
                  <button className="icon-btn p-1 shrink-0" title={activeId === p.id ? 'Active profile' : 'Make active'}
                    onClick={() => activate(p.id)} aria-label={activeId === p.id ? `${p.name} (active profile)` : `Activate ${p.name}`}>
                    {activeId === p.id ? <Check size={14} className="text-signal" /> : <Settings2 size={14} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-paper">{p.name}</div>
                    <div className="truncate font-mono text-[10px] text-paper-dim">{p.model} · {p.provider}{p.apiKey ? ' · key set' : ' · no key'}</div>
                  </div>
                  <button className="icon-btn p-1 shrink-0" title="Edit profile" aria-label={`Edit ${p.name}`} onClick={() => setEditing({ ...p })}>
                    <SlidersHorizontal size={13} />
                  </button>
                  <button className="icon-btn p-1 shrink-0 hover:text-heat" title="Delete profile" aria-label={`Delete ${p.name}`} onClick={() => removeProfile(p.id)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {!profiles.length && <p className="py-4 text-center text-[11px] text-paper-faint">No profiles. Create one, or add a key in Settings → AI.</p>}
            </div>
            {editing && (
              <div className="rounded-lg border border-signal/40 bg-ink-850 p-3 space-y-2">
                <h3 className="text-xs font-semibold text-paper">{profiles.some((p) => p.id === editing.id) ? 'Edit AI profile' : 'New AI profile'}</h3>
                <label className="block">
                  <span className="label">Name</span>
                  <input className="field py-1 text-xs" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="label">Provider</span>
                  <select className="field py-1 text-xs cursor-pointer" value={editing.provider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider;
                      const preset = PROVIDER_PRESETS[provider];
                      setEditing({ ...editing, provider, endpoint: preset.endpoint, model: preset.model });
                    }}>
                    {(Object.keys(PROVIDER_PRESETS) as AIProvider[]).map((id) => (
                      <option key={id} value={id}>{PROVIDER_PRESETS[id].label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label">Endpoint</span>
                  <input className="field py-1 text-xs" value={editing.endpoint} onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })} spellCheck={false} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label">Model</span>
                    <input className="field py-1 text-xs" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} spellCheck={false} />
                  </label>
                  <label className="block">
                    <span className="label">API key</span>
                    <input className="field py-1 text-xs" type="password" value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} autoComplete="off" placeholder="Optional for local servers" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="label">Temperature (0–2)</span>
                    <input className="field py-1 text-xs" type="number" min="0" max="2" step="0.1" value={editing.temperature}
                      onChange={(e) => setEditing({ ...editing, temperature: Number(e.target.value) })} />
                  </label>
                  <label className="block">
                    <span className="label">Max tokens (0 = default)</span>
                    <input className="field py-1 text-xs" type="number" min="0" step="256" value={editing.maxTokens}
                      onChange={(e) => setEditing({ ...editing, maxTokens: Number(e.target.value) })} />
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button className="btn-solid text-xs py-1" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="btn-signal text-xs py-1" onClick={saveProfile}>Save profile</button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ---- Per-task settings ---- */}
        {tab === 'tasks' && (
          <section className="space-y-3" aria-label="Per-task AI settings">
            <p className="text-[11px] leading-relaxed text-paper-dim">
              Route each kind of request through a saved profile and fine-tune it. Leave a value at 0 to inherit the profile.
              These settings apply to chat, model-written plans, captions, translation and analysis alike.
            </p>
            <div className="space-y-2">
              {TASKS.filter((t) => AI_TASKS.includes(t.id)).map((t) => {
                const s = taskSettings[t.id] ?? {};
                const effective = resolveAISettingsForTask(t.id);
                const route = s.profileId ? getAIProfile(s.profileId) : undefined;
                return (
                  <div key={t.id} className="rounded-lg border border-line bg-ink-850 p-2.5">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-paper">{t.label}</div>
                        <div className="text-[10px] text-paper-dim">{t.desc}</div>
                      </div>
                      <span className="text-right text-[10px] text-paper-faint">
                        {profileName(route ? route.id : (s.profileId ?? 'active'))} · {effective.model}
                      </span>
                    </div>
                    <label className="mb-2 block">
                      <span className="label">Profile (empty = active profile)</span>
                      <select className="field py-1 text-xs cursor-pointer" value={s.profileId ?? ''}
                        onChange={(e) => setTask(t.id, { profileId: e.target.value || undefined })}>
                        <option value="">Active profile</option>
                        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.model}</option>)}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="label">Temperature (0 = inherit)</span>
                        <input className="field py-1 text-xs" type="number" min="0" max="2" step="0.1"
                          value={s.temperature ?? 0}
                          onChange={(e) => setTask(t.id, { temperature: Number(e.target.value) })} />
                      </label>
                      <label className="block">
                        <span className="label">Max tokens (0 = inherit)</span>
                        <input className="field py-1 text-xs" type="number" min="0" step="256"
                          value={s.maxTokens ?? 0}
                          onChange={(e) => setTask(t.id, { maxTokens: Number(e.target.value) })} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ---- Tool permissions / catalog ---- */}
        {tab === 'tools' && (
          <section className="space-y-3" aria-label="AI tool permissions">
            <div className="flex items-start gap-2">
              <BookOpen size={14} className="mt-0.5 shrink-0 text-signal" />
              <p className="text-[11px] leading-relaxed text-paper-dim">
                {TOOLS.length - disabledTools.length} of {TOOLS.length} real editing tools are available to AI.
                Hidden tools are removed from model prompts and rejected if a model calls them. Buttons and the
                command palette still work — this controls AI access only.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-solid text-[11px] py-1 flex items-center gap-1" onClick={() => allTools(true)}>
                <RotateCcw size={12} /> Enable all
              </button>
              <button className="btn-solid text-[11px] py-1" onClick={() => allTools(false)}>Hide all from AI</button>
              <span className="text-[10px] text-paper-faint">{disabledTools.length} hidden</span>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto panel bg-ink-850 p-3">
              {groups.map((group) => (
                <div key={group.name}>
                  <h3 className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-paper-dim">{group.name}</h3>
                  <div className="flex flex-wrap gap-1">
                    {group.tools.map((t) => {
                      const enabled = !disabledTools.includes(t);
                      return (
                        <button key={t} title={`${enabled ? 'Hide from AI' : 'Allow AI to use'}: ${toolLabel(t)}`}
                          aria-pressed={enabled}
                          onClick={() => toggleTool(t)}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${enabled ? 'border-line bg-ink-800 text-paper-dim hover:text-paper' : 'border-line/60 bg-ink-900 text-paper-faint line-through'}`}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- Usage ---- */}
        {tab === 'usage' && (
          <section className="space-y-3" aria-label="AI usage">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Total calls', value: String(usage.calls) },
                { label: 'Successful', value: String(usage.ok) },
                { label: 'Failed', value: String(usage.fail) },
                { label: 'Est. tokens', value: usage.tokens.toLocaleString() },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-line bg-ink-850 p-2 text-center">
                  <div className="font-display text-lg font-semibold text-paper">{s.value}</div>
                  <div className="text-[10px] text-paper-dim">{s.label}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-paper-dim">
              Estimated cost so far: <strong className="text-paper">${usage.costUsd.toFixed(4)}</strong>. This is a rough hint based on
              character counts, not a bill — actual pricing varies by provider and model.
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto panel bg-ink-850 p-2">
              {listUsage().slice(-30).reverse().map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[10px]">
                  <span className={r.ok ? 'text-heat-green' : 'text-heat'}>{r.ok ? '✓' : '✕'}</span>
                  <span className="text-paper-dim">{new Date(r.at).toLocaleString()}</span>
                  <span className="text-paper">{r.task}</span>
                  <span className="font-mono text-paper-dim">{r.model}</span>
                  <span className="hidden text-paper-faint sm:inline">{profileName(r.profileId)}</span>
                  <span className="ml-auto text-paper-dim">~{r.tokensEstimate} tok</span>
                </div>
              ))}
              {!usage.calls && <p className="py-4 text-center text-[11px] text-paper-faint">No AI calls recorded yet.</p>}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
