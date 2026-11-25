/**
 * Chat client. Three providers, two protocols:
 * - `openai` / `openrouter`: OpenAI-compatible chat/completions (OpenAI,
 *   OpenRouter, LM Studio, Ollama's compat layer, any gateway) — the default.
 *   OpenRouter differs only in its preset URL and attribution headers.
 * - `gemini`: Google Gemini `generateContent` (different body, headers and
 *   response shape — a Gemini key does NOT work through the OpenAI shape).
 *
 * Transport: requests go direct first. Some providers (api.openai.com) refuse
 * browser CORS, which client code cannot fix — when FalconCut is served from its
 * own local server, the request is transparently replayed through the
 * same-origin /__ai proxy (see server/aiProxy.mjs). Without that server it
 * stays direct and the error message explains why.
 *
 * The endpoint URL, API key and model name are stored ONLY in localStorage
 * and sent ONLY to the user-configured endpoint. With no key (and no local
 * endpoint) hasAI() is false and the whole editor still works via buttons and
 * the rules-only auto_edit. Nothing here is required for core editing.
 */
export type AIProvider = 'openai' | 'gemini' | 'openrouter';
export type AITask = 'chat' | 'plan' | 'caption' | 'translate' | 'analysis';

export interface AISettings {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Max output tokens for this connection; 0/undefined means endpoint default. */
  maxTokens?: number;
  /** Optional; when missing it is detected from the endpoint URL so settings
   * saved before this field existed keep working. */
  provider?: AIProvider;
}

/** A saved, named AI provider profile. Users can keep several — e.g.
 * "OpenAI GPT-4o for planning", "Gemini for captions", "Ollama local for privacy". */
export interface AIProfile {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  provider: AIProvider;
  createdAt: number;
  updatedAt: number;
}

/** Per-task AI settings. When a task has no entry, the active profile's
 * values are used. Set `profileId` to route one task through a different
 * profile (for example Gemini for translation, GPT for planning). */
export interface AITaskSettings {
  /** Use this saved profile for the task instead of the active one. */
  profileId?: string;
  /** 0/undefined = inherit the profile's temperature. */
  temperature?: number;
  /** 0/undefined = inherit the profile's token limit. */
  maxTokens?: number;
}

/** One API call, for usage tracking and cost estimation. */
export interface UsageRecord {
  id: string;
  profileId: string;
  task: AITask;
  model: string;
  at: number;
  ok: boolean;
  tokensEstimate: number;   // rough: chars / 4
  costUsdEstimate: number;  // very rough, per-provider pricing would need rates
}

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MODEL = 'gpt-4o-mini';
export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Checked against the live API (Nov 2026): gemini-2.0-flash was retired by
 * Google (404 "no longer available"). New default per Google's own guidance. */
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** `auto` lets OpenRouter pick a working model for whatever credits the key
 * has, so a fresh key never fails on a model that was removed or gated. */
export const OPENROUTER_MODEL = 'auto';
export const OPENAI_MODEL_PLACEHOLDER = OPENAI_MODEL;

/** Endpoint + model preset per provider (used by the Provider selector). */
export const PROVIDER_PRESETS: Record<AIProvider, { endpoint: string; model: string; label: string }> = {
  openai: { endpoint: OPENAI_ENDPOINT, model: OPENAI_MODEL, label: 'OpenAI-compatible' },
  openrouter: { endpoint: OPENROUTER_ENDPOINT, model: OPENROUTER_MODEL, label: 'OpenRouter' },
  gemini: { endpoint: `${GEMINI_ENDPOINT}/${GEMINI_MODEL}:generateContent`, model: GEMINI_MODEL, label: 'Google Gemini' },
};

export const DEFAULT_AI_PROFILE: AIProfile = {
  id: 'default',
  name: 'Default',
  endpoint: OPENAI_ENDPOINT,
  apiKey: '',
  model: OPENAI_MODEL,
  temperature: 0.4,
  maxTokens: 0,
  provider: 'openai',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/**
 * Endpoint presets for the OpenAI-*compatible* protocol — i.e. any server that
 * speaks `POST /chat/completions` with a Bearer key, which is most of the
 * industry. `model` is left undefined where the vendor's catalogue churns
 * weekly: the endpoint is the durable part, and the in-dialog "Fetch models"
 * button lists the real names for that key instead of us shipping a guess.
 */
export interface CompatiblePreset {
  id: string;
  label: string;
  endpoint: string;
  model?: string;
  /** Local servers need no key. */
  local?: boolean;
}
export const COMPATIBLE_PRESETS: CompatiblePreset[] = [
  { id: 'openai', label: 'OpenAI', endpoint: OPENAI_ENDPOINT, model: OPENAI_MODEL },
  { id: 'groq', label: 'Groq', endpoint: 'https://api.groq.com/openai/v1/chat/completions' },
  { id: 'together', label: 'Together', endpoint: 'https://api.together.xyz/v1/chat/completions' },
  { id: 'mistral', label: 'Mistral', endpoint: 'https://api.mistral.ai/v1/chat/completions' },
  { id: 'deepseek', label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
  { id: 'fireworks', label: 'Fireworks', endpoint: 'https://api.fireworks.ai/inference/v1/chat/completions' },
  { id: 'perplexity', label: 'Perplexity', endpoint: 'https://api.perplexity.ai/chat/completions' },
  { id: 'ollama', label: 'Ollama (local)', endpoint: 'http://localhost:11434/v1/chat/completions', model: 'llama3.2', local: true },
  { id: 'lmstudio', label: 'LM Studio (local)', endpoint: 'http://localhost:1234/v1/chat/completions', local: true },
];


/** Models Google has retired with a known replacement — auto-upgraded on load
 * so saved settings keep working after the API changes under them. */
const RETIRED_GEMINI: Record<string, string> = {
  'gemini-2.0-flash': GEMINI_MODEL,
  'gemini-2.0-flash-lite': GEMINI_MODEL,
  'gemini-1.5-flash': GEMINI_MODEL,
  'gemini-1.5-pro': GEMINI_MODEL,
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  endpoint: OPENAI_ENDPOINT,
  apiKey: '',
  model: OPENAI_MODEL,
  temperature: 0.4,
  maxTokens: 0,
};

const LS_KEY = 'falconcut.ai.settings';

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_AI_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    // Retired-model migration: a saved Gemini model the API no longer serves
    // would fail on every call — upgrade it to Google's recommended successor.
    if (parsed.model && RETIRED_GEMINI[parsed.model]) parsed.model = RETIRED_GEMINI[parsed.model];
    return { ...DEFAULT_AI_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export function saveAISettings(patch: Partial<AISettings>): AISettings {
  const next = { ...loadAISettings(), ...patch };
  try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}

export function clearAISettings(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

/** True when the endpoint is a local server (Ollama, LM Studio, a local
 * gateway). Those normally need no API key at all, so an empty key must not
 * make the app think AI is unconfigured. */
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function hasAI(s: AISettings = loadAISettings()): boolean {
  if (!s.endpoint.trim()) return false;
  return !!s.apiKey.trim() || isLocalEndpoint(s.endpoint);
}

/** Which protocol to speak. Explicit field wins; otherwise detect from the URL
 * so older saved settings (no provider field) keep working. OpenRouter speaks
 * the OpenAI protocol but gets its own identity for presets/attribution. */
export function providerOf(s: AISettings): AIProvider {
  if (s.provider === 'openai' || s.provider === 'gemini' || s.provider === 'openrouter') return s.provider;
  if (/generativelanguage\.googleapis\.com/i.test(s.endpoint)) return 'gemini';
  if (/openrouter\.ai/i.test(s.endpoint)) return 'openrouter';
  return 'openai';
}

/**
 * Local proxy detection.
 *
 * Some providers — api.openai.com above all — reject browser requests with a
 * CORS error, which no client-side code can work around. When the app is served
 * by FalconCut's own local server (`Start FalconCut.bat`, `npm run serve`,
 * `npm run dev`), the same origin exposes POST /__ai?url=… and forwards the call
 * server-side. We probe once, cache the answer, and every request then falls
 * back to it automatically on a network-level failure only.
 */
let proxyProbe: Promise<boolean> | null = null;

export function localProxyAvailable(): Promise<boolean> {
  if (typeof location === 'undefined' || typeof fetch === 'undefined') return Promise.resolve(false);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname)) return Promise.resolve(false);
  if (!proxyProbe) {
    proxyProbe = fetch('/__ai', { method: 'GET', headers: { Accept: 'application/json' } })
      .then(async (r) => (r.ok ? (await r.json() as { proxy?: string } | null)?.proxy === 'falconcut-local' : false))
      .catch(() => false);
  }
  return proxyProbe;
}

export interface AIResponse { res: Response; viaProxy: boolean }

/** fetch() plus the local-proxy routing described above.
 *
 * When the app is served from its own local server, remote calls go through the
 * proxy FIRST. Reason: a CORS-blocked provider does not fail fast — the browser
 * can sit on the request for ~20 s before rejecting, which made "Verify" feel
 * broken even when it eventually worked. The proxy is same-origin, so it returns
 * the provider's real answer in one round trip. Local endpoints (Ollama/LM
 * Studio) always go direct, and any proxy failure still falls back to direct. */
async function aiRequest(url: string, init: RequestInit, label: string): Promise<AIResponse> {
  const canProxy = typeof location !== 'undefined'
    && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  if (canProxy && (await localProxyAvailable())) {
    try {
      return { res: await fetch(`/__ai?url=${encodeURIComponent(url)}`, init), viaProxy: true };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      // Health probe answered but the hop failed — try the provider directly.
    }
  }
  try {
    return { res: await fetch(url, init), viaProxy: false };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const direct = (e as Error).message;
    if (isLocalEndpoint(url)) {
      throw new Error(`Could not reach your local AI server at ${url}: ${direct}. Is it running? Ollama: "ollama serve". LM Studio: start the Local Server tab (port 1234). Then check the port matches.`);
    }
    if (!(await localProxyAvailable())) {
      throw new Error(`Could not reach ${label}: ${direct}. Check the URL and the key. Providers that block browser requests (e.g. api.openai.com) work when FalconCut is opened from its local server — double-click Start FalconCut.bat.`);
    }
    try {
      return { res: await fetch(`/__ai?url=${encodeURIComponent(url)}`, init), viaProxy: true };
    } catch (e2) {
      if ((e2 as Error).name === 'AbortError') throw e2;
      throw new Error(`Could not reach ${label}: ${direct}. The local proxy was unavailable too.`);
    }
  }
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

/**
 * Normalise an OpenAI-compatible endpoint to a usable chat URL. Users paste the
 * root (`https://api.groq.com/openai/v1`), the base with a slash, or the full
 * URL; posting to a bare base returns 404 and reads like a bad key. If the path
 * already contains /chat/completions we keep it verbatim (query and all).
 */
export function openaiUrl(endpoint: string): string {
  const raw = endpoint.trim();
  if (!raw) return raw;
  if (/\/chat\/completions(\/|\?|#|$)/i.test(raw)) return raw.replace(/\/+$/, '');
  return `${raw.replace(/\/+$/, '')}/chat/completions`;
}
export interface ChatOptions { json?: boolean; signal?: AbortSignal; temperature?: number; maxTokens?: number; task?: AITask }

/**
 * Plain-language note about the credential shape. There are now TWO valid
 * Google key formats — standard keys (`AIza…`) and the newer authorization
 * keys (`AQ.…`) that AI Studio issues by default — so a "wrong prefix" warning
 * would be false for most users. Only call out values that are clearly not
 * Gemini API keys at all.
 */
function geminiKeyNote(key: string): string {
  const k = (key || '').trim();
  if (!k) return '';
  if (/^AQ\./i.test(k)) {
    return ' AQ.… is the newer AI Studio authorization key — it is valid, but only on the native Gemini endpoint (Provider "Google Gemini"), not on the OpenAI-compatible one.';
  }
  if (/^AIza/i.test(k)) return '';
  if (/^sk-/i.test(k)) return ' That looks like an OpenAI-style key (sk-…) — switch Provider to the OpenAI-compatible option to use it.';
  if (/^(ya29\.|1\/\/)/.test(k)) return ' That looks like an OAuth token, not an API key — create a Gemini API key at aistudio.google.com/apikey.';
  return '';
}

/**
 * Normalise any Gemini endpoint into a working `generateContent` URL.
 *
 * Real users paste every shape of this URL, and Google answers all the wrong
 * ones with a bare 404, which used to look like "the key is broken":
 *   …/v1beta                              → …/v1beta/models/<m>:generateContent
 *   …/v1beta/                             → same (trailing slash)
 *   …/v1beta/models                       → …/v1beta/models/<m>:generateContent
 *   …/v1beta/models/gemini-2.0-flash      → replaces the model with the field
 *   …/v1beta/models/gemini-2.0-flash:generateContent → replaces the model
 *   …?key=…                               → query dropped (key goes in a header)
 * The MODEL FIELD always wins over a model baked into the pasted URL.
 */
export function geminiUrl(endpoint: string, model: string): string {
  const raw = endpoint.trim();
  if (!raw) return raw;
  const modelName = (model.trim() || GEMINI_MODEL);
  // Drop query/hash: the key travels in a header, and a leftover ?key= would be
  // forwarded to the local proxy inside the URL.
  const clean = raw.replace(/[?#].*$/, '');
  // Full action URL — keep its shape, swap the model.
  if (/:(stream)?generateContent$/i.test(clean)) {
    return clean.replace(/\/models\/[^/]+(?=:(?:stream)?generateContent$)/i, `/models/${encodeURIComponent(modelName)}`);
  }
  const base = clean.replace(/\/+$/, '');
  const modelsRoot = /\/models$/i.test(base)
    ? base
    : /\/models\/[^/]+$/i.test(base)
      ? base.replace(/\/models\/[^/]+$/i, '/models')
      : `${base}/models`;
  return `${modelsRoot}/${encodeURIComponent(modelName)}:generateContent`;
}

async function geminiComplete(messages: ChatMessage[], opts: ChatOptions, settings: AISettings, signal: AbortSignal | undefined): Promise<string> {
  let url = geminiUrl(settings.endpoint, settings.model);
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? settings.temperature,
  };
  if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
  if (opts.json) generationConfig.responseMimeType = 'application/json';

  const payload: Record<string, unknown> = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig,
  };

  // Some Gemini models (thinking variants) reject responseMimeType or
  // maxOutputTokens. Retry without the offending config key instead of failing.
  const dropped: string[] = [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey.trim()) headers['x-goog-api-key'] = settings.apiKey;
  let usedQueryKey = false;
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = (await aiRequest(
      url,
      { method: 'POST', headers, body: JSON.stringify(payload), signal },
      'the Gemini endpoint',
    )).res;
    if (res.ok) break;
    // Google accepts the key two ways. A few newer authorization keys (AQ.…)
    // are refused in the header on some projects; when the header attempt is
    // rejected as unauthenticated, retry once with ?key= (and WITHOUT the
    // header, or Google replies "Multiple authentication credentials received").
    if ((res.status === 401 || res.status === 403) && !usedQueryKey && settings.apiKey.trim()) {
      usedQueryKey = true;
      delete headers['x-goog-api-key'];
      url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(settings.apiKey.trim())}`;
      continue;
    }
    const text = await res.clone().text().catch(() => '');
    const lower = text.toLowerCase();
    const retryable = res.status === 400;
    if (retryable && !dropped.includes('responseMimeType') && /responsemimetype|response_mime_type|json/.test(lower) && opts.json) {
      delete (generationConfig as Record<string, unknown>).responseMimeType;
      (payload.generationConfig as Record<string, unknown>) = generationConfig;
      dropped.push('responseMimeType');
      continue;
    }
    if (retryable && !dropped.includes('maxOutputTokens') && /maxoutputtokens|max_output_tokens/.test(lower)) {
      delete (generationConfig as Record<string, unknown>).maxOutputTokens;
      (payload.generationConfig as Record<string, unknown>) = generationConfig;
      dropped.push('maxOutputTokens');
      continue;
    }
    break;
  }
  if (!res) throw new Error('Gemini request could not be sent.');
  if (!res.ok) {
    // Google sends JSON for API errors but plain HTML/text for a wrong route,
    // and a bare "404" told the user nothing. Always surface something.
    const text = await res.text().catch(() => '');
    let msg = '';
    try {
      const data = JSON.parse(text) as { error?: { message?: string; status?: string } | string };
      msg = typeof data.error === 'string' ? data.error : data.error?.message ?? '';
    } catch {
      msg = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    }
    const path = (() => { try { const u = new URL(url); return u.pathname; } catch { return url; } })();
    const hint = res.status === 404
      ? ` Google has no route at ${path}. Press "Fetch models" in Settings to see the exact model names your key can use, and keep the endpoint as …/v1beta or …/v1beta/models — FalconCut adds /models/<model>:generateContent itself.`
      : res.status === 400 && /api key/i.test(msg)
        ? ` The key was rejected. Copy it again from aistudio.google.com/apikey — both key types work here: standard keys (AIza…) and the newer authorization keys (AQ.…). If you just created the key, give it a minute to activate.${geminiKeyNote(settings.apiKey)}`
        : res.status === 401
          ? ` The key was not accepted as an API key.${/access_token_type_unsupported|multiple authentication/i.test(msg) ? ' Google saw the wrong credential type — FalconCut sends it as an API key, so this usually means the value is an OAuth token rather than a key.' : ''}${geminiKeyNote(settings.apiKey)} Copy a Gemini API key from aistudio.google.com/apikey.`
          : res.status === 403
            ? ` The key is valid but is not allowed to use this model or API — check key restrictions in Google AI Studio, or pick another model.${geminiKeyNote(settings.apiKey)}`
            : res.status === 429
              ? ' Gemini rate limit or quota reached — wait a moment and retry.'
              : geminiKeyNote(settings.apiKey);
    throw new Error(`Gemini returned ${res.status}${msg ? `. ${msg}` : ''}${hint}`.trim());
  }
  const data = await res.json().catch(() => null) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  const cand = data?.candidates?.[0];
  // Thinking models emit thought parts alongside the answer — keep only text.
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
  if (!text) {
    const block = data?.promptFeedback?.blockReason ?? cand?.finishReason;
    throw new Error(`Gemini returned no text${block ? ` (reason: ${block})` : ''}. Try a different prompt or model.`);
  }
  return text;
}

/** Low-level chat completion. Throws a readable error on failure. */
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions = {}, settings: AISettings = loadAISettings()): Promise<string> {
  if (!hasAI(settings)) throw new Error('No AI endpoint configured. Add one in Settings → AI, or use the buttons (no key needed).');
  const provider = providerOf(settings);
  const task: AITask = opts.task ?? 'chat';
  const profileId = profileIdForTask(task);
  let text = '';
  let ok = false;
  try {
    if (provider === 'gemini') text = await geminiComplete(messages, opts, settings, opts.signal);
    else text = await openaiComplete(messages, opts, settings, provider === 'openrouter', opts.signal);
    ok = true;
    return text;
  } finally {
    const chars = (messages.reduce((s, m) => s + m.content.length, 0) + text.length);
    void recordUsage(profileId, task, settings.model, ok, chars);
  }
}

/**
 * Streaming chat for the OpenAI-compatible family (OpenAI, OpenRouter,
 * Ollama, LM Studio, gateways). Gemini streams a different shape, so it uses
 * the normal (non-streaming) call and delivers the whole reply at once.
 *
 * Returns the full text. If streaming is not supported by the endpoint, it
 * falls back to the regular call — but only while nothing has been shown yet,
 * so the user never sees the same sentence twice.
 */
export async function chatStream(
  messages: ChatMessage[],
  onDelta: (delta: string) => void,
  opts: ChatOptions = {},
  settings: AISettings = loadAISettings(),
): Promise<string> {
  const provider = providerOf(settings);
  if (provider === 'gemini') {
    const text = await chatComplete(messages, opts, settings);
    if (text) onDelta(text);
    return text;
  }

  // Streaming bypasses chatComplete, so it records its own usage. A fallback
  // to chatComplete marks the call as already recorded to avoid double-counting.
  const task: AITask = opts.task ?? 'chat';
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  let full = '';
  let recorded = false;
  const record = (ok: boolean) => {
    if (recorded) return;
    recorded = true;
    void recordUsage(profileIdForTask(task), task, settings.model, ok, promptChars + full.length);
  };
  try {
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      temperature: opts.temperature ?? settings.temperature,
      stream: true,
    };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey}`;
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://falconcut.app';
      headers['X-Title'] = 'FalconCut';
    }
    const { res } = await aiRequest(
      openaiUrl(settings.endpoint),
      { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal },
      'the AI endpoint',
    );
    if (!res.ok || !res.body) throw new Error(`stream unavailable (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sse = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        sse = true;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            full += delta;
            onDelta(delta);
          }
        } catch { /* keep-alive or split frame */ }
      }
    }
    // Some local servers answer with one plain JSON body even when asked to
    // stream; if nothing came through, use the regular path.
    if (full.trim() || sse) { record(true); return full; }
    throw new Error('empty stream');
  } catch (e) {
    if (full.trim()) { record(true); return full; }
    if ((e as Error).name === 'AbortError') { record(false); throw e; }
    // chatComplete has the parameter-level retries and records usage itself.
    recorded = true;
    const text = await chatComplete(messages, opts, settings);
    if (text) onDelta(text);
    return text;
  }
}

/** OpenAI-compatible chat/completions (OpenAI, OpenRouter, LM Studio, Ollama…).
 *
 * Real endpoints disagree about optional parameters: newer OpenAI reasoning
 * models reject `max_tokens` (they want `max_completion_tokens`) and may
 * reject `temperature` or `response_format`; several OpenRouter models do the
 * same. Instead of guessing, we send the rich body first and, on a parameter
 * complaint, retry with the offending key removed. That is what makes Test
 * connection work across every provider instead of only the "safe" ones. */
async function openaiComplete(
  messages: ChatMessage[], opts: ChatOptions, settings: AISettings, openrouter: boolean, signal: AbortSignal | undefined,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: opts.temperature ?? settings.temperature,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Local servers (Ollama, LM Studio) need no key; sending an empty bearer
  // token would be rejected, so only attach it when one exists.
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey}`;
  if (openrouter) {
    // Optional attribution headers OpenRouter uses for app ranking; harmless.
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://falconcut.app';
    headers['X-Title'] = 'FalconCut';
  }

  const dropped: string[] = [];
  const url = openaiUrl(settings.endpoint);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { res, viaProxy } = await aiRequest(
      url,
      { method: 'POST', headers, body: JSON.stringify(body), signal },
      'the AI endpoint',
    );
    if (res.ok) {
      const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string | null } }[] } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
      // Some reasoning models return an empty content string with a valid
      // completion (all tokens went to reasoning). Surface a clear message.
      if (Array.isArray(data?.choices) && data!.choices.length > 0) {
        throw new Error('The model returned an empty reply — it may be a reasoning model that needs more output tokens. Increase the prompt or pick another model.');
      }
      throw new Error('AI endpoint returned an unexpected response shape (no choices[0].message.content).');
    }

    const text = await res.text().catch(() => '') as string;
    let msg = text.slice(0, 400);
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      msg = typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? msg;
    } catch { /* keep raw text */ }

    // Parameter-level complaints: retry with the offending key fixed/removed.
    const lower = msg.toLowerCase();
    const retryable = res.status === 400 || res.status === 422;
    if (retryable && !dropped.includes('max_tokens') && /max_tokens|max completion tokens|unsupported parameter/.test(lower) && body.max_tokens != null) {
      // Newer OpenAI models: rename to max_completion_tokens and retry.
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      dropped.push('max_tokens');
      continue;
    }
    if (retryable && !dropped.includes('temperature') && /temperature/.test(lower) && body.temperature != null) {
      delete body.temperature;
      dropped.push('temperature');
      continue;
    }
    if (retryable && !dropped.includes('response_format') && /response_format|json_object|json mode/.test(lower) && body.response_format != null) {
      delete body.response_format;
      dropped.push('response_format');
      continue;
    }

    const hint = res.status === 401 || res.status === 403
      ? ` Check the API key (and that it has access to this model).${/googleapis\.com/i.test(url) && /^AQ\./i.test(settings.apiKey.trim()) ? ' AQ.… keys are Gemini authorization keys: they work only with Provider "Google Gemini" (native API), not the OpenAI-compatible endpoint.' : ''}`
      : res.status === 402
        ? ' The provider says the account has no credits — add credits or use a free model.'
        : res.status === 429
          ? ' Rate limit or free-tier quota reached — wait a moment or use another model.'
          : (res.status === 404 || res.status === 400)
            ? ' If this mentions an unknown model, press "Fetch models" in Settings to list the models this endpoint offers.'
            : '';
    const route = viaProxy ? ' (sent through your local FalconCut proxy)' : '';
    throw new Error(`AI endpoint returned ${res.status}${route}. ${msg}${hint}`.trim());
  }
  throw new Error('The endpoint kept rejecting optional parameters. Try a different model, or press "Fetch models" in Settings.');
}

/** Query the endpoint for the models the key can actually use, so users never
 * have to guess model names. Gemini: GET /v1beta/models (x-goog-api-key).
 * OpenAI-compatible: GET /models on the same base as the chat URL. */
export async function listModels(settings: AISettings = loadAISettings(), signal?: AbortSignal): Promise<string[]> {
  if (!hasAI(settings)) throw new Error('Add an API key first (or point the endpoint at a local server) — then Fetch models lists what it can use.');
  if (providerOf(settings) === 'gemini') {
    // Always list from the API root: the pasted endpoint may be the base, the
    // models root, or a full model action URL.
    const host = (() => { try { return new URL(settings.endpoint).origin; } catch { return ''; } })();
    const root = /generativelanguage\.googleapis\.com/i.test(settings.endpoint)
      ? `${host}/v1beta/models`
      : GEMINI_ENDPOINT;
    const res0 = (await aiRequest(
      root,
      { headers: settings.apiKey.trim() ? { 'x-goog-api-key': settings.apiKey } : {}, signal },
      'Gemini (model list)',
    )).res;
    // Same header-vs-query key fallback as generateContent (see geminiComplete).
    const res = !res0.ok && (res0.status === 401 || res0.status === 403) && settings.apiKey.trim()
      ? (await aiRequest(
        `${root}?key=${encodeURIComponent(settings.apiKey.trim())}`,
        { headers: {}, signal },
        'Gemini (model list)',
      )).res
      : res0;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = text.slice(0, 200);
      try {
        const data = JSON.parse(text) as { error?: { message?: string } };
        msg = data.error?.message ?? msg;
      } catch { /* keep raw */ }
      throw new Error(`Gemini returned ${res.status} listing models. ${msg}${geminiKeyNote(settings.apiKey)}`.trim());
    }
    const data = await res.json().catch(() => null) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null;
    const names = (data?.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter((n) => n && !/embedding|aqa|imagen|veo/i.test(n));
    if (names.length === 0) throw new Error('Gemini listed no chat models for this key.');
    return names;
  }
  // OpenAI-compatible: derive /models from the chat URL's origin (+ base path).
  const base = openaiUrl(settings.endpoint).replace(/\/chat\/completions.*$/i, '').replace(/\/+$/, '');
  const res = (await aiRequest(
    `${base}/models`,
    { headers: settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey}` } : {}, signal },
    `${base}/models`,
  )).res;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text.slice(0, 200);
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string };
      msg = typeof data.error === 'string' ? data.error : data.error?.message ?? msg;
    } catch { /* keep raw */ }
    throw new Error(`Listing models returned ${res.status}${msg ? `. ${msg}` : ''}. Type the model name manually instead.`);
  }
  const data = await res.json().catch(() => null) as { data?: { id?: string }[] } | { models?: { name?: string }[] } | null;
  const raw = Array.isArray((data as { data?: { id?: string }[] })?.data) ? (data as { data?: { id?: string }[] }).data!
    : Array.isArray((data as { models?: { name?: string }[] })?.models) ? (data as { models?: { name?: string }[] }).models!.map((m) => ({ id: m.name }))
    : [];
  const names = raw.map((m) => m.id ?? '').filter(Boolean);
  if (names.length === 0) throw new Error('The endpoint returned no models — type the model name manually.');
  return names;
}

/** Convenience: one system + one user message. */
export function ask(system: string, user: string, opts: ChatOptions = {}, settings?: AISettings): Promise<string> {
  return chatComplete([{ role: 'system', content: system }, { role: 'user', content: user }], opts, settings);
}

/** The ctx.ai function tools use (e.g. translate_captions). The optional
 * task routes the call through that task's profile and token settings. */
export function makeAIFn(settings: AISettings = loadAISettings()): (system: string, user: string, task?: AITask) => Promise<string> {
  return (system, user, task = 'chat') => {
    const selected = applyTaskSettings(settings, task);
    return ask(system, user, { task, temperature: selected.temperature, maxTokens: selected.maxTokens }, selected);
  };
}

/* =========================================================================
 * AI PROFILES — multiple named provider configurations
 * ========================================================================= */

const PROFILES_KEY = 'falconcut.ai.profiles';
const ACTIVE_PROFILE_KEY = 'falconcut.ai.activeProfile';
const TASK_SETTINGS_KEY = 'falconcut.ai.taskSettings';
const USAGE_KEY = 'falconcut.ai.usage';
const DISABLED_TOOLS_KEY = 'falconcut.ai.disabledTools';
const MAX_USAGE = 200; // keep usage history bounded

/** Tasks that actually make a model call, in the order the UI lists them. */
export const AI_TASKS: AITask[] = ['chat', 'plan', 'caption', 'translate', 'analysis'];

const DEFAULT_TASK_SETTINGS: Record<AITask, AITaskSettings> = {
  chat: {}, plan: {}, caption: {}, translate: {}, analysis: {},
};

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function legacyDefaultProfile(): AIProfile {
  const s = loadAISettings();
  return {
    ...DEFAULT_AI_PROFILE,
    endpoint: s.endpoint,
    apiKey: s.apiKey,
    model: RETIRED_GEMINI[s.model] ?? s.model,
    temperature: clampNumber(s.temperature, 0, 2, 0.4),
    maxTokens: Math.max(0, Math.round(Number(s.maxTokens) || 0)),
    provider: providerOf(s),
  };
}

function normalizeProfile(input: Partial<AIProfile> | null | undefined, index = 0): AIProfile {
  const p = input ?? {};
  const endpoint = typeof p.endpoint === 'string' && p.endpoint.trim() ? p.endpoint.trim() : OPENAI_ENDPOINT;
  const apiKey = typeof p.apiKey === 'string' ? p.apiKey.trim() : '';
  const rawModel = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : OPENAI_MODEL;
  const model = RETIRED_GEMINI[rawModel] ?? rawModel;
  const provider: AIProvider = p.provider === 'openai' || p.provider === 'gemini' || p.provider === 'openrouter'
    ? p.provider
    : providerOf({ endpoint, apiKey, model, temperature: 0.4 });
  const now = Date.now();
  return {
    id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : uid('prof'),
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Profile ${index + 1}`,
    endpoint,
    apiKey,
    model,
    temperature: clampNumber(p.temperature, 0, 2, 0.4),
    maxTokens: Math.max(0, Math.round(Number(p.maxTokens) || 0)),
    provider,
    createdAt: Number.isFinite(p.createdAt) ? Number(p.createdAt) : now,
    updatedAt: Number.isFinite(p.updatedAt) ? Number(p.updatedAt) : now,
  };
}

/** Turn a profile into the connection settings the client speaks. */
function profileToSettings(p: AIProfile): AISettings {
  return {
    endpoint: p.endpoint,
    apiKey: p.apiKey,
    model: p.model,
    temperature: p.temperature,
    maxTokens: p.maxTokens,
    provider: p.provider,
  };
}

function loadProfiles(): AIProfile[] {
  const ls = storage();
  if (!ls) return [legacyDefaultProfile()];
  try {
    const raw = ls.getItem(PROFILES_KEY);
    // No saved list yet: show the existing single connection as "Default" so
    // activating it never silently disconnects a working key.
    if (raw == null) return [legacyDefaultProfile()];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [legacyDefaultProfile()];
    // An empty array means the user deleted every profile — respect that.
    return arr.map((p, i) => normalizeProfile(p as Partial<AIProfile>, i));
  } catch { return [legacyDefaultProfile()]; }
}

function saveProfiles(profiles: AIProfile[]) {
  try { storage()?.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch { /* ignore */ }
}

export function listAIProfiles(): AIProfile[] { return loadProfiles(); }

export function getAIProfile(id: string): AIProfile | undefined {
  return loadProfiles().find((p) => p.id === id);
}

export function getActiveAIProfileId(): string | null {
  try { return storage()?.getItem(ACTIVE_PROFILE_KEY) ?? null; } catch { return null; }
}

export function setActiveAIProfile(id: string | null) {
  // Activating an empty "Default" while a legacy Settings key exists would
  // otherwise look like a sudden disconnection. Copy that connection in first.
  if (id === 'default') {
    const current = getAIProfile('default');
    const legacy = loadAISettings();
    if (current && !hasAI(profileToSettings(current)) && hasAI(legacy)) {
      saveAIProfile({
        ...current,
        endpoint: legacy.endpoint,
        apiKey: legacy.apiKey,
        model: RETIRED_GEMINI[legacy.model] ?? legacy.model,
        temperature: clampNumber(legacy.temperature, 0, 2, current.temperature),
        maxTokens: Math.max(0, Math.round(Number(legacy.maxTokens) || 0)),
        provider: providerOf(legacy),
      });
    }
  }
  try {
    if (id) storage()?.setItem(ACTIVE_PROFILE_KEY, id);
    else storage()?.removeItem(ACTIVE_PROFILE_KEY);
  } catch { /* ignore */ }
}

/** Resolve the connection to use: active profile, then the legacy single
 * Settings connection, then the built-in default. */
export function resolveAISettings(): AISettings {
  const activeId = getActiveAIProfileId();
  const profile = activeId ? getAIProfile(activeId) : undefined;
  return profile ? profileToSettings(profile) : loadAISettings();
}

export function saveAIProfile(profile: AIProfile) {
  const profiles = loadProfiles();
  const id = typeof profile.id === 'string' && profile.id.trim() ? profile.id.trim() : uid('prof');
  const idx = profiles.findIndex((p) => p.id === id);
  const createdAt = idx >= 0 ? profiles[idx].createdAt : Number(profile.createdAt) || Date.now();
  const next = normalizeProfile({ ...profile, id, createdAt }, idx >= 0 ? idx : profiles.length);
  next.updatedAt = Date.now();
  if (idx >= 0) profiles[idx] = next;
  else profiles.push(next);
  saveProfiles(profiles);
}

export function deleteAIProfile(id: string) {
  const profiles = loadProfiles().filter((p) => p.id !== id);
  saveProfiles(profiles);
  // Clear per-task routes that pointed at the deleted profile.
  const tasks = getAITaskSettings();
  let tasksChanged = false;
  for (const task of AI_TASKS) {
    if (tasks[task]?.profileId === id) {
      const rest = { ...tasks[task] };
      delete rest.profileId;
      tasks[task] = rest;
      tasksChanged = true;
    }
  }
  if (tasksChanged) saveTaskSettings(tasks);
  if (getActiveAIProfileId() === id) {
    // Prefer a remaining profile that can actually connect; otherwise fall
    // back to the legacy Settings connection instead of a known-empty profile.
    const fallback = profiles.find((p) => hasAI(profileToSettings(p)));
    setActiveAIProfile(fallback?.id ?? null);
  }
}

/* =========================================================================
 * PER-TASK AI SETTINGS
 * ========================================================================= */

function sanitizeTaskSettings(input: unknown): AITaskSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: AITaskSettings = {};
  if (typeof raw.profileId === 'string' && raw.profileId.trim()) out.profileId = raw.profileId.trim();
  const temp = Number(raw.temperature);
  if (Number.isFinite(temp) && temp > 0) out.temperature = Math.max(0.01, Math.min(2, temp));
  const max = Number(raw.maxTokens);
  if (Number.isFinite(max) && max > 0) out.maxTokens = Math.round(Math.min(1_000_000, max));
  return out;
}

function saveTaskSettings(settings: Record<AITask, AITaskSettings>) {
  try { storage()?.setItem(TASK_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

export function getAITaskSettings(): Record<AITask, AITaskSettings> {
  const out: Record<AITask, AITaskSettings> = { ...DEFAULT_TASK_SETTINGS };
  const raw = (() => {
    try {
      const text = storage()?.getItem(TASK_SETTINGS_KEY);
      return text ? JSON.parse(text) as unknown : null;
    } catch { return null; }
  })();
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const task of AI_TASKS) out[task] = sanitizeTaskSettings(obj[task]);
  }
  return out;
}

export function setAITaskSetting(task: AITask, patch: AITaskSettings) {
  const cur = getAITaskSettings();
  // 0 means "inherit" everywhere, so store it as absent and keep storage clean.
  const next = { ...cur, [task]: sanitizeTaskSettings({ ...cur[task], ...patch }) };
  saveTaskSettings(next);
}

/** Apply one task's profile route and overrides on top of a base connection. */
export function applyTaskSettings(base: AISettings, task: AITask): AISettings {
  const taskSettings = getAITaskSettings()[task] ?? {};
  const routed = taskSettings.profileId ? getAIProfile(taskSettings.profileId) : undefined;
  const s = routed ? profileToSettings(routed) : base;
  return {
    ...s,
    temperature: taskSettings.temperature ?? s.temperature,
    maxTokens: taskSettings.maxTokens ?? s.maxTokens,
  };
}

/** Resolve settings for a specific task: task profile/overrides → active
 * profile → legacy Settings connection. */
export function resolveAISettingsForTask(task: AITask): AISettings {
  return applyTaskSettings(resolveAISettings(), task);
}

/* =========================================================================
 * USAGE TRACKING
 * ========================================================================= */

/** Which profile served this task, for the usage log. */
export function profileIdForTask(task: AITask): string {
  const route = getAITaskSettings()[task]?.profileId;
  if (route && getAIProfile(route)) return route;
  const active = getActiveAIProfileId();
  if (active && getAIProfile(active)) return active;
  return 'settings';
}

const TASK_SET = new Set<string>(AI_TASKS);

function loadUsage(): UsageRecord[] {
  try {
    const arr = JSON.parse(storage()?.getItem(USAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        id: typeof r.id === 'string' ? r.id : uid('use'),
        profileId: typeof r.profileId === 'string' ? r.profileId : 'settings',
        task: (TASK_SET.has(String(r.task)) ? r.task : 'chat') as AITask,
        model: typeof r.model === 'string' ? r.model : 'unknown',
        at: Number.isFinite(Number(r.at)) ? Number(r.at) : Date.now(),
        ok: r.ok === true,
        tokensEstimate: Math.max(0, Math.round(Number(r.tokensEstimate) || 0)),
        costUsdEstimate: Math.max(0, Number(r.costUsdEstimate) || 0),
      }))
      .slice(-MAX_USAGE);
  } catch { return []; }
}

function saveUsage(usage: UsageRecord[]) {
  try { storage()?.setItem(USAGE_KEY, JSON.stringify(usage.slice(-MAX_USAGE))); } catch { /* ignore */ }
}

export function listUsage(): UsageRecord[] { return loadUsage(); }

export function recordUsage(profileId: string, task: AITask, model: string, ok: boolean, chars: number) {
  const tokensEstimate = Math.max(0, Math.round(chars / 4));
  // Very rough cost estimates (USD per 1K tokens). Providers change pricing;
  // these are order-of-magnitude hints, not bills.
  const ratePer1k = 0.0015;
  const costUsdEstimate = (tokensEstimate / 1000) * ratePer1k;
  const record: UsageRecord = {
    id: uid('use'),
    profileId,
    task,
    model,
    at: Date.now(),
    ok,
    tokensEstimate,
    costUsdEstimate,
  };
  const usage = loadUsage();
  usage.push(record);
  saveUsage(usage);
}

export function usageSummary(): { calls: number; ok: number; fail: number; tokens: number; costUsd: number; byTask: Record<AITask, number> } {
  const usage = loadUsage();
  const byTask: Record<AITask, number> = { chat: 0, plan: 0, caption: 0, translate: 0, analysis: 0 };
  let tokens = 0, cost = 0, ok = 0;
  for (const r of usage) {
    byTask[r.task] += 1;
    tokens += r.tokensEstimate;
    cost += r.costUsdEstimate;
    if (r.ok) ok++;
  }
  return { calls: usage.length, ok, fail: usage.length - ok, tokens, costUsd: cost, byTask };
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* =========================================================================
 * TOOL PERMISSIONS — tools the model may not call
 * ========================================================================= */

export function listDisabledTools(): string[] {
  try {
    const arr = JSON.parse(storage()?.getItem(DISABLED_TOOLS_KEY) ?? '[]') as unknown;
    return Array.isArray(arr) ? [...new Set(arr.filter((n): n is string => typeof n === 'string' && !!n))] : [];
  } catch { return []; }
}

export function isToolEnabled(name: string): boolean {
  return !listDisabledTools().includes(name);
}

export function setToolEnabled(name: string, enabled: boolean) {
  const disabled = new Set(listDisabledTools());
  if (enabled) disabled.delete(name);
  else disabled.add(name);
  try { storage()?.setItem(DISABLED_TOOLS_KEY, JSON.stringify([...disabled].sort())); } catch { /* ignore */ }
}