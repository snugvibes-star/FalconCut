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
export interface ChatOptions { json?: boolean; signal?: AbortSignal; temperature?: number; maxTokens?: number }

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
      ? ` Google has no route at ${path}. Press "Fetch models" in Settings to see the exact model names your key can use, and keep the endpoint as …/v1beta or …/v1beta/models — CutFlow adds /models/<model>:generateContent itself.`
      : res.status === 400 && /api key/i.test(msg)
        ? ` The key was rejected. Copy it again from aistudio.google.com/apikey — both key types work here: standard keys (AIza…) and the newer authorization keys (AQ.…). If you just created the key, give it a minute to activate.${geminiKeyNote(settings.apiKey)}`
        : res.status === 401
          ? ` The key was not accepted as an API key.${/access_token_type_unsupported|multiple authentication/i.test(msg) ? ' Google saw the wrong credential type — CutFlow sends it as an API key, so this usually means the value is an OAuth token rather than a key.' : ''}${geminiKeyNote(settings.apiKey)} Copy a Gemini API key from aistudio.google.com/apikey.`
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
  if (provider === 'gemini') return geminiComplete(messages, opts, settings, opts.signal);
  return openaiComplete(messages, opts, settings, provider === 'openrouter', opts.signal);
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

  let full = '';
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
      headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://cutflow.app';
      headers['X-Title'] = 'CutFlow';
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
    if (full.trim() || sse) return full;
    throw new Error('empty stream');
  } catch {
    if (full.trim()) return full;
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
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://cutflow.app';
    headers['X-Title'] = 'CutFlow';
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

/** The ctx.ai function tools use (e.g. translate_captions). */
export function makeAIFn(settings: AISettings = loadAISettings()): (system: string, user: string) => Promise<string> {
  return (system, user) => ask(system, user, {}, settings);
}