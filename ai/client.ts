/**
 * Chat client. Three providers, two protocols:
 * - `openai` / `openrouter`: OpenAI-compatible chat/completions (OpenAI,
 *   OpenRouter, LM Studio, Ollama's compat layer, any gateway) — the default.
 *   OpenRouter differs only in its preset URL and attribution headers.
 * - `gemini`: Google Gemini `generateContent` (different body, headers and
 *   response shape — a Gemini key does NOT work through the OpenAI shape).
 *
 * Transport: requests go direct first. Some providers (api.openai.com) refuse
 * browser CORS, which client code cannot fix — when CutFlow is served from its
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

export interface AISettings {
  endpoint: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Optional; when missing it is detected from the endpoint URL so settings
   * saved before this field existed keep working. */
  provider?: AIProvider;
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
};

const LS_KEY = 'cutflow.ai.settings';

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
 * by CutFlow's own local server (`Start CutFlow.bat`, `npm run serve`,
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
      .then(async (r) => (r.ok ? (await r.json() as { proxy?: string } | null)?.proxy === 'cutflow-local' : false))
      .catch(() => false);
  }
  return proxyProbe;
}

export interface AIResponse { res: Response; viaProxy: boolean }

/** fetch() plus the local-proxy fallback described above. A CORS rejection
 * surfaces as a TypeError before any bytes reach the provider, so replaying the
 * request server-side is safe and cannot double-apply a side effect. */
async function aiRequest(url: string, init: RequestInit, label: string): Promise<AIResponse> {
  try {
    return { res: await fetch(url, init), viaProxy: false };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const direct = (e as Error).message;
    if (!(await localProxyAvailable())) {
      throw new Error(`Could not reach ${label}: ${direct}. Check the URL and the key. Providers that block browser requests (e.g. api.openai.com) work when CutFlow is opened from its local server — double-click Start CutFlow.bat.`);
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
export interface ChatOptions { json?: boolean; signal?: AbortSignal; temperature?: number; maxTokens?: number }

/** Google Gemini generateContent: build the URL (users may paste either the
 * full `:generateContent` URL or just the `/models` root), send the key via
 * the `x-goog-api-key` header, and map messages onto the Gemini shape. */
async function geminiComplete(messages: ChatMessage[], opts: ChatOptions, settings: AISettings, signal: AbortSignal | undefined): Promise<string> {
  let url = settings.endpoint;
  if (/generateContent/.test(url)) {
    // The endpoint has a model action baked in. The MODEL FIELD must win —
    // otherwise users who change the model (e.g. after a retirement like
    // gemini-2.0-flash) still hit the stale model encoded in the preset URL.
    url = url.replace(/\/models\/[^/?]+:generateContent/i, `/models/${encodeURIComponent(settings.model)}:generateContent`);
  } else {
    // Accept "/models", "/models/" or the API root — append the model action.
    url = `${url.replace(/\/+$/, '')}/${settings.model}:generateContent`;
  }
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
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = (await aiRequest(
      url,
      { method: 'POST', headers, body: JSON.stringify(payload), signal },
      'the Gemini endpoint',
    )).res;
    if (res.ok) break;
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
    const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    const msg = data?.error?.message ?? '';
    const hint = res.status === 404 && /model/i.test(msg)
      ? ' Check the Model name — press "Fetch models" in Settings to list the models this key can actually use.'
      : res.status === 400 && /api key/i.test(msg)
        ? ' The API key looks invalid — copy it again from aistudio.google.com.'
        : res.status === 429
          ? ' Gemini rate limit or quota reached — wait a moment and retry.'
          : '';
    throw new Error(`Gemini returned ${res.status}. ${msg}${hint}`.trim());
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
  if (provider === 'gemini') return geminiComplete(messages, opts, settings, opts.signal);
  return openaiComplete(messages, opts, settings, provider === 'openrouter', opts.signal);
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
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://cutflow.app';
    headers['X-Title'] = 'CutFlow';
  }

  const dropped: string[] = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    const { res, viaProxy } = await aiRequest(
      settings.endpoint,
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
      ? ' Check the API key (and that it has access to this model).'
      : res.status === 402
        ? ' The provider says the account has no credits — add credits or use a free model.'
        : res.status === 429
          ? ' Rate limit or free-tier quota reached — wait a moment or use another model.'
          : (res.status === 404 || res.status === 400)
            ? ' If this mentions an unknown model, press "Fetch models" in Settings to list the models this endpoint offers.'
            : '';
    const route = viaProxy ? ' (sent through your local CutFlow proxy)' : '';
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
    const root = settings.endpoint.match(/^https?:\/\/[^/]+\/v1(?:beta)?\/models/i)?.[0]
      ?? `${GEMINI_ENDPOINT}`;
    const res = (await aiRequest(
      root,
      { headers: settings.apiKey.trim() ? { 'x-goog-api-key': settings.apiKey } : {}, signal },
      'Gemini (model list)',
    )).res;
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(`Gemini returned ${res.status} listing models. ${data?.error?.message ?? ''}`.trim());
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
  const base = settings.endpoint.replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
  const res = (await aiRequest(
    `${base}/models`,
    { headers: settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey}` } : {}, signal },
    `${base}/models`,
  )).res;
  if (!res.ok) throw new Error(`Listing models returned ${res.status}. Type the model name manually instead.`);
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

/** The ctx.ai function tools use (e.g. translate_captions). */
export function makeAIFn(settings: AISettings = loadAISettings()): (system: string, user: string) => Promise<string> {
  return (system, user) => ask(system, user, {}, settings);
}