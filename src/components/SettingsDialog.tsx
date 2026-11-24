import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { chatComplete, COMPATIBLE_PRESETS, hasAI, isLocalEndpoint, listModels, localProxyAvailable, GEMINI_ENDPOINT, GEMINI_MODEL, OPENAI_ENDPOINT, OPENAI_MODEL, OPENROUTER_MODEL, PROVIDER_PRESETS, providerOf, type AISettings, type AIProvider, type CompatiblePreset } from '../../ai/client';
import { FEATURE_CHECKLIST, GROUP_ORDER, checklistSummary, type FeatureStatus } from '../features/checklist';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';
import { ShortcutsSection } from './ShortcutsSection';
import { AppearanceSection } from './AppearanceSection';

type ChecklistFilter = 'all' | FeatureStatus;
type SettingsTab = 'ai' | 'shortcuts' | 'appearance' | 'checklist';

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'ai', label: 'AI' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'checklist', label: 'Checklist' },
];

const STATUS_DOT: Record<FeatureStatus, string> = {
  working: 'bg-signal',
  partial: 'bg-heat-amber',
  'not-possible': 'bg-heat',
};
const STATUS_LABEL: Record<FeatureStatus, string> = {
  working: 'Working',
  partial: 'Partial',
  'not-possible': 'Not possible',
};
const FILTERS: { id: ChecklistFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'working', label: 'Working' },
  { id: 'partial', label: 'Partial' },
  { id: 'not-possible', label: 'Not possible' },
];

function ChecklistSection() {
  const [filter, setFilter] = useState<ChecklistFilter>('all');
  const summary = checklistSummary();
  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: FEATURE_CHECKLIST.filter((item) => item.group === group && (filter === 'all' || item.status === filter)),
  })).filter((g) => g.items.length > 0);

  return (
    <section className="space-y-3" aria-label="Feature checklist">
      <div>
        <h2 className="label">Feature checklist</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-paper-dim">
          What this browser build can actually do today, per group. Hover an item for details.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button"
            className={filter === f.id ? 'btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal' : 'btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
        <span className="ml-auto text-[11px] text-paper-dim" aria-live="polite">
          Working {summary.working} · Partial {summary.partial} · Not possible {summary.notPossible}
        </span>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto panel bg-ink-850 p-3">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <h3 className="mb-1 font-display text-[11px] font-semibold uppercase tracking-wide text-paper-dim">{group}</h3>
            <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {items.map((item) => (
                <li key={item.id} title={item.note ?? STATUS_LABEL[item.status]} className="flex items-center gap-2 text-xs leading-snug">
                  <span className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[item.status]}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="text-paper">{item.label}</span>
                    {item.note && <span className="block text-[10px] text-paper-dim">{item.note}</span>}
                  </span>
                  <span className="sr-only">{` — ${STATUS_LABEL[item.status]}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}


export function SettingsDialog() {
  const settings = useStore((s) => s.aiSettings);
  const setAISettings = useStore((s) => s.setAISettings);
  const close = useUI((s) => s.close);
  const toast = useUI((s) => s.toast);
  const [draft, setDraft] = useState(() => ({ ...settings, temperature: String(settings.temperature) }));
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  /** Inline key check result — the shield button next to the key field. */
  const [keyCheck, setKeyCheck] = useState<{ state: 'checking' | 'ok' | 'bad'; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  /** null = still probing. Whether this origin exposes the /__ai proxy. */
  const [proxy, setProxy] = useState<boolean | null>(null);
  const onClose = () => close('settings');

  useEffect(() => {
    let live = true;
    void localProxyAvailable().then((ok) => { if (live) setProxy(ok); });
    return () => { live = false; };
  }, []);

  const provider = providerOf({
    endpoint: draft.endpoint,
    apiKey: draft.apiKey,
    model: draft.model,
    temperature: 0.4,
    provider: draft.provider ?? settings.provider,
  });

  /** A key is optional for local servers (Ollama, LM Studio) — hasAI() knows. */
  const ready = hasAI({ endpoint: draft.endpoint, apiKey: draft.apiKey, model: draft.model, temperature: 0.4, provider });
  const localServer = isLocalEndpoint(draft.endpoint);

  /** Switching providers presets a known-good endpoint + model for it. */
  const switchProvider = (p: AIProvider) => {
    setTestResult(null);
    setKeyCheck(null);
    const preset = PROVIDER_PRESETS[p];
    setDraft((d) => ({ ...d, provider: p, endpoint: preset.endpoint, model: preset.model }));
  };

  /** Endpoint preset inside the OpenAI-compatible family (any vendor). */
  const applyCompatiblePreset = (preset: CompatiblePreset) => {
    setTestResult(null);
    setKeyCheck(null);
    setDraft((d) => ({ ...d, provider: 'openai', endpoint: preset.endpoint, model: preset.model ?? d.model }));
  };

  const draftSettings = (): AISettings => ({
    endpoint: draft.endpoint.trim(),
    apiKey: draft.apiKey.trim(),
    model: draft.model.trim(),
    temperature: Number(draft.temperature) || 0.4,
    provider: draft.provider ?? settings.provider,
  });

  /** Shield button: is this key valid for this endpoint, right now? */
  const verifyKey = async () => {
    setKeyCheck({ state: 'checking', text: 'Checking the key with one tiny request…' });
    try {
      const reply = await chatComplete(
        [{ role: 'user', content: 'Reply with the single word: ok' }],
        { temperature: 0, maxTokens: 16 },
        draftSettings(),
      );
      setKeyCheck({ state: 'ok', text: `Key is valid — the endpoint answered${reply.trim() ? `: "${reply.trim().slice(0, 40)}"` : '.'}` });
    } catch (e) {
      setKeyCheck({ state: 'bad', text: (e as Error).message });
    }
  };

  /** Real connection test with the CURRENT draft values (no save needed). */
  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      const draftSettings: AISettings = {
        endpoint: draft.endpoint.trim(),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
        temperature: Number(draft.temperature) || 0.4,
        provider: draft.provider ?? settings.provider,
      };
      const reply = await chatComplete(
        [{ role: 'user', content: 'Reply with exactly the word: connected' }],
        { temperature: 0, maxTokens: 64 },
        draftSettings,
      );
      setTestResult({ ok: true, text: reply.trim() ? `Connected — the model replied: "${reply.trim().slice(0, 60)}"` : 'Connected — the model responded (empty text reply, which is normal for some reasoning models).' });
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  /** Ask the endpoint which models the key can actually use (no guessing). */
  const fetchModels = async () => {
    setFetching(true);
    setError('');
    try {
      const draftSettings: AISettings = {
        endpoint: draft.endpoint.trim(),
        apiKey: draft.apiKey.trim(),
        model: draft.model.trim(),
        temperature: Number(draft.temperature) || 0.4,
        provider: draft.provider ?? settings.provider,
      };
      const names = await listModels(draftSettings);
      setModels(names);
      // If the current model isn't in the list, preselect the newest-looking
      // chat model so the user lands on a name that works.
      if (names.length && !names.includes(draftSettings.model)) {
        setDraft((d) => ({ ...d, model: names[0] }));
      }
      setTestResult({ ok: true, text: `${names.length} models available — pick one below. Currently: ${names.includes(draftSettings.model) ? draftSettings.model : names[0]}` });
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message });
    } finally {
      setFetching(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const endpoint = draft.endpoint.trim();
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    } catch {
      setError('Enter a complete HTTP or HTTPS endpoint URL.');
      return;
    }
    const temperature = Number(draft.temperature);
    if (!draft.model.trim() || !draft.temperature.trim() || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      setError('Enter a model name and a temperature between 0 and 2.');
      return;
    }
    const next: AISettings = {
      endpoint,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      temperature,
      provider,
    };
    try {
      setAISettings(next);
      toast(keyCheck?.state === 'ok' || testResult?.ok ? 'AI settings saved — key verified.' : 'AI settings saved. Use Verify or Test connection to check it.', 'success');
      onClose();
    } catch {
      setError('Could not save AI settings. Try again or check browser storage permissions.');
    }
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="space-y-4">
      <div className="cf-hscroll flex items-center gap-1 -mt-1 border-b border-line pb-2.5" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${tab === t.id ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper hover:bg-ink-800'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'checklist' && <ChecklistSection />}
      {tab === 'shortcuts' && <ShortcutsSection />}
      {tab === 'appearance' && <AppearanceSection />}
      {tab === 'ai' && (
      <form onSubmit={save} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-paper-dim">
            Need multiple keys, per-task behavior, tool permissions or usage stats?
          </p>
          <button type="button" className="btn-solid text-xs py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            onClick={() => { onClose(); useUI.getState().open('aiControl'); }}>
            Open AI Control Center →
          </button>
        </div>
        <p className="text-xs leading-relaxed text-paper-dim">
          Connect any chat model for planning and auto edit: any OpenAI-compatible vendor (OpenAI, Groq, Together, Mistral, DeepSeek, Fireworks, Perplexity, Ollama, LM Studio…), OpenRouter, or Google Gemini's native API. AI is optional; every editing tool works without an API key.
        </p>
        <div>
          <label className="label" htmlFor="ai-provider">Provider</label>
          <select id="ai-provider" className="field cursor-pointer" value={provider}
            onChange={(e) => switchProvider(e.target.value as AIProvider)}>
            <option value="openai">OpenAI-compatible API (any vendor or local server)</option>
            <option value="openrouter">OpenRouter (one key, hundreds of models)</option>
            <option value="gemini">Google Gemini (native API)</option>
          </select>
          <p className="mt-1 text-[11px] leading-relaxed text-paper-dim">
            {provider === 'openrouter'
              ? 'OpenRouter routes one key to many providers. "auto" picks a working model for your credits; press Fetch models to see everything the key can use (free models end in :free).'
              : provider === 'gemini'
                ? 'Create a key at aistudio.google.com/apikey. Both formats work: standard keys starting with AIza and the newer authorization keys starting with AQ. Any endpoint shape works too: …/v1beta, …/v1beta/models, or a full …/models/<model>:generateContent URL — FalconCut builds the model action itself and the Model name field always wins.'
                : 'Any server that speaks the OpenAI chat-completions API — not just OpenAI. Pick a vendor below, or paste your own endpoint (vLLM, Azure, a gateway…). A bare base URL such as …/v1 is fine: /chat/completions is added when it is missing.'}
          </p>
          {provider === 'openai' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {COMPATIBLE_PRESETS.map((preset) => {
                const active = draft.endpoint === preset.endpoint;
                return (
                  <button key={preset.id} type="button" onClick={() => applyCompatiblePreset(preset)}
                    className={`px-2 py-1 rounded-md border text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${
                      active ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-paper-dim hover:text-paper hover:border-signal/40'
                    }`}
                    title={`${preset.endpoint}${preset.local ? ' — no key needed' : ''}`}>
                    {preset.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <label className="label" htmlFor="ai-endpoint">API endpoint</label>
          <input id="ai-endpoint" type="url" className="field" required autoComplete="off" spellCheck={false}
            value={draft.endpoint} onChange={(e) => { setDraft({ ...draft, endpoint: e.target.value }); setTestResult(null); setKeyCheck(null); }}
            placeholder={provider === 'gemini' ? `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent` : OPENAI_ENDPOINT}
            aria-describedby="ai-cors" />
          <p id="ai-cors" className="mt-1 text-[11px] leading-relaxed text-paper-dim">
            {provider === 'gemini'
              ? 'Paste the full :generateContent URL (preset above), or just …/v1beta/models — the model action is added automatically. The key is sent as x-goog-api-key.'
              : provider === 'openrouter'
                ? 'Full chat-completions URL (preset above). The key is sent as a Bearer token with OpenRouter attribution headers.'
                : 'Use the full chat-completions URL, not just the server address. Browser-blocked providers (api.openai.com included) are proxied automatically when the app runs from its local server.'}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="ai-key">API key</label>
          <div className="flex flex-wrap gap-2">
            <input id="ai-key" type={showKey ? 'text' : 'password'} className="field w-full sm:w-auto sm:min-w-0 sm:flex-1" autoComplete="off" spellCheck={false}
              value={draft.apiKey} onChange={(e) => { setDraft({ ...draft, apiKey: e.target.value }); setTestResult(null); setKeyCheck(null); }}
              placeholder={provider === 'gemini' ? 'AIza… or AQ.… key from aistudio.google.com' : localServer ? 'Not required for local servers' : 'Paste the key from your provider'}
              aria-describedby="ai-key-note" />
            <button type="button" className="icon-btn shrink-0 border border-line rounded-lg w-9"
              title={showKey ? 'Hide the key' : 'Show the key'} aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => setShowKey((v) => !v)}>
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button"
              className="btn-solid shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal gap-1.5"
              disabled={!ready || keyCheck?.state === 'checking'}
              aria-label="Verify API key" aria-busy={keyCheck?.state === 'checking'}
              title="Verify key — sends one tiny real request and tells you whether this key works with this endpoint"
              onClick={() => void verifyKey()}>
              {keyCheck?.state === 'checking' ? <Loader2 size={14} className="animate-spin" />
                : keyCheck?.state === 'ok' ? <ShieldCheck size={14} className="text-heat-green" />
                : keyCheck?.state === 'bad' ? <ShieldX size={14} className="text-heat" />
                : <ShieldCheck size={14} />}
              <span className="hidden sm:inline">Verify</span>
            </button>
            <button type="button" className="btn-solid shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              disabled={!draft.apiKey} onClick={() => { setDraft({ ...draft, apiKey: '' }); setKeyCheck(null); }}>Clear</button>
          </div>
          {provider === 'openai' && /^(AIza|AQ\.)/i.test(draft.apiKey.trim()) && (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-heat-amber">
              <ShieldX size={12} className="mt-0.5 shrink-0" />
              <span>That is a Google Gemini key. Switch Provider to “Google Gemini” — Gemini keys, and especially the newer AQ.… ones, are rejected by OpenAI-compatible endpoints.</span>
            </p>
          )}
          {provider === 'gemini' && /^sk-/i.test(draft.apiKey.trim()) && (
            <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-heat-amber">
              <ShieldX size={12} className="mt-0.5 shrink-0" />
              <span>That looks like an OpenAI-style key (sk-…). Use the OpenAI-compatible provider for it, or paste a Gemini key from aistudio.google.com/apikey.</span>
            </p>
          )}
          {keyCheck && (
            <p role="status" className={`mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed ${
              keyCheck.state === 'ok' ? 'text-heat-green' : keyCheck.state === 'bad' ? 'text-heat' : 'text-paper-dim'
            }`}>
              {keyCheck.state === 'ok' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                : keyCheck.state === 'bad' ? <ShieldX size={12} className="mt-0.5 shrink-0" />
                : <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />}
              <span>{keyCheck.text}</span>
            </p>
          )}
          <p id="ai-key-note" className="mt-1 text-[11px] leading-relaxed text-paper-dim">
            Verify sends one tiny request and reports whether the key is valid for this endpoint — nothing is saved until you press Save settings. The key is stored in this browser's local storage, not encrypted.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="label" htmlFor="ai-model">Model name</label>
            <input id="ai-model" className="field" required autoComplete="off" spellCheck={false}
              value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              list="ai-model-options"
              placeholder={provider === 'gemini' ? GEMINI_MODEL : provider === 'openrouter' ? OPENROUTER_MODEL : OPENAI_MODEL} />
            <datalist id="ai-model-options">
              {models.map((m) => <option key={m} value={m} />)}
            </datalist>
            {models.length > 0 && <p className="mt-1 text-[11px] text-heat-green">✓ {models.length} models from this key — start typing to filter.</p>}
          </div>
          <div>
            <label className="label" htmlFor="ai-temperature">Temperature</label>
            <input id="ai-temperature" className="field" type="number" min="0" max="2" step="any" required
              value={draft.temperature} onChange={(e) => setDraft({ ...draft, temperature: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            onClick={() => void fetchModels()} disabled={fetching || !ready}>
            {fetching ? 'Fetching…' : 'Fetch models'}
          </button>
          <button type="button" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            onClick={() => void testConnection()} disabled={testing || !ready}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <span className="text-[11px] leading-snug text-paper-dim">
            Fetch models lists what your key can use; Test sends one tiny real request with the values in this form — no save needed.
          </span>
        </div>
        {proxy !== null && (
          <p className="text-[11px] leading-relaxed text-paper-dim">
            {proxy
              ? 'Connection proxy: active (this app is running from its local server). Providers that block direct browser requests, such as api.openai.com, are routed locally without any extra setup — your key still goes straight to the provider.'
              : 'Connection proxy: not available on this origin. OpenAI and other providers that block direct browser requests may fail here — open FalconCut from its local server (Start FalconCut.bat) to enable the proxy, or use OpenRouter or Gemini.'}
          </p>
        )}
        {testResult && (
          <p role="status" className={`text-xs leading-relaxed ${testResult.ok ? 'text-heat-green' : 'text-heat'}`}>
            {testResult.ok ? '✓ ' : '✕ '}{testResult.text}
          </p>
        )}
        <div className="panel bg-ink-850 p-3 text-xs leading-relaxed text-paper-dim">
          <h3 className="mb-1 font-display font-semibold text-paper">What leaves your device</h3>
          <p>Videos and media files stay local. When you use AI, your prompts, transcript text and project summary are sent to the configured endpoint along with your API key. Only use an endpoint you trust.</p>
        </div>
        {error && <p role="alert" className="text-xs text-heat">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button type="button" className="btn-solid focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal">Save settings</button>
        </div>
      </form>
      )}
      </div>
    </Dialog>
  );
}
