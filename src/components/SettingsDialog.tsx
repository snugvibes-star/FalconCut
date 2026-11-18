import { useState, type FormEvent } from 'react';
import { chatComplete, listModels, GEMINI_ENDPOINT, GEMINI_MODEL, OPENAI_ENDPOINT, OPENAI_MODEL, providerOf, type AISettings, type AIProvider } from '../../ai/client';
import { FEATURE_CHECKLIST, GROUP_ORDER, checklistSummary, type FeatureStatus } from '../features/checklist';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { Dialog } from './Dialog';

type ChecklistFilter = 'all' | FeatureStatus;

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
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const onClose = () => close('settings');

  const provider = providerOf({
    endpoint: draft.endpoint,
    apiKey: draft.apiKey,
    model: draft.model,
    temperature: 0.4,
    provider: draft.provider ?? settings.provider,
  });

  /** Switching providers presets a known-good endpoint + model for it. */
  const switchProvider = (p: AIProvider) => {
    setTestResult(null);
    if (p === 'gemini') {
      setDraft((d) => ({
        ...d,
        provider: 'gemini',
        endpoint: `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`,
        model: GEMINI_MODEL,
      }));
    } else {
      setDraft((d) => ({
        ...d,
        provider: 'openai',
        endpoint: OPENAI_ENDPOINT,
        model: OPENAI_MODEL,
      }));
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
        { temperature: 0, maxTokens: 16 },
        draftSettings,
      );
      setTestResult({ ok: true, text: `Connected — the model replied: "${reply.trim().slice(0, 60)}"` });
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
      toast(testResult?.ok ? 'AI settings saved — connection verified.' : 'AI settings saved. Use Test connection to verify it.', 'success');
      onClose();
    } catch {
      setError('Could not save AI settings. Try again or check browser storage permissions.');
    }
  };

  return (
    <Dialog title="AI settings" onClose={onClose}>
      <div className="space-y-4">
      <ChecklistSection />
      <form onSubmit={save} className="space-y-4">
        <p className="text-xs leading-relaxed text-paper-dim">
          Connect an AI model for planning and auto edit. Supported: Google Gemini and any OpenAI-compatible chat endpoint. AI is optional; editing tools work without an API key.
        </p>
        <div>
          <label className="label" htmlFor="ai-provider">Provider</label>
          <select id="ai-provider" className="field cursor-pointer" value={provider}
            onChange={(e) => switchProvider(e.target.value as AIProvider)}>
            <option value="openai">OpenAI-compatible (OpenAI, OpenRouter, LM Studio…)</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ai-endpoint">API endpoint</label>
          <input id="ai-endpoint" type="url" className="field" required autoComplete="off" spellCheck={false}
            value={draft.endpoint} onChange={(e) => { setDraft({ ...draft, endpoint: e.target.value }); setTestResult(null); }}
            placeholder={provider === 'gemini' ? `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent` : OPENAI_ENDPOINT}
            aria-describedby="ai-cors" />
          <p id="ai-cors" className="mt-1 text-[11px] leading-relaxed text-paper-dim">
            {provider === 'gemini'
              ? 'Paste the full :generateContent URL (preset above), or just …/v1beta/models — the model action is added automatically. The key is sent as x-goog-api-key.'
              : 'Use the full chat-completions URL, not just the server address. The endpoint must allow CORS from this app.'}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="ai-key">API key</label>
          <div className="flex gap-2">
            <input id="ai-key" type="password" className="field min-w-0" autoComplete="off" spellCheck={false}
              value={draft.apiKey} onChange={(e) => { setDraft({ ...draft, apiKey: e.target.value }); setTestResult(null); }}
              placeholder={provider === 'gemini' ? 'AIza… key from aistudio.google.com' : 'Leave empty to disable AI'}
              aria-describedby="ai-key-note" />
            <button type="button" className="btn-solid shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              disabled={!draft.apiKey} onClick={() => setDraft({ ...draft, apiKey: '' })}>Clear key</button>
          </div>
          <p id="ai-key-note" className="mt-1 text-[11px] leading-relaxed text-paper-dim">
            Stored in this browser's local storage, not encrypted. Clearing the key takes effect only after Save settings.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="label" htmlFor="ai-model">Model name</label>
            <input id="ai-model" className="field" required autoComplete="off" spellCheck={false}
              value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              list="ai-model-options"
              placeholder={provider === 'gemini' ? GEMINI_MODEL : OPENAI_MODEL} />
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
            onClick={() => void fetchModels()} disabled={fetching || !draft.apiKey.trim()}>
            {fetching ? 'Fetching…' : 'Fetch models'}
          </button>
          <button type="button" className="btn-signal focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            onClick={() => void testConnection()} disabled={testing || !draft.apiKey.trim() || !draft.endpoint.trim()}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <span className="text-[11px] leading-snug text-paper-dim">
            Fetch models lists what your key can use; Test sends one tiny real request with the values in this form — no save needed.
          </span>
        </div>
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
      </div>
    </Dialog>
  );
}
