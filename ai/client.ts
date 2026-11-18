/**
 * Chat client. Two protocols:
 * - `openai`: OpenAI-compatible chat/completions (OpenAI, OpenRouter, LM
 *   Studio, Ollama's compat layer, …) — the default.
 * - `gemini`: Google Gemini `generateContent` (different body, headers and
 *   response shape — a Gemini key does NOT work through the OpenAI shape).
 * The endpoint URL, API key and model name are stored ONLY in localStorage
 * and sent ONLY to the user-configured endpoint. With no key, hasAI() is
 * false and the whole editor still works via buttons and the rules-only
 * auto_edit. Nothing here is required for core editing.
 */
export type AIProvider = 'openai' | 'gemini';

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
export const OPENAI_MODEL_PLACEHOLDER = OPENAI_MODEL;

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

export function hasAI(s: AISettings = loadAISettings()): boolean {
  return !!s.apiKey.trim() && !!s.endpoint.trim();
}

/** Which protocol to speak. Explicit field wins; otherwise detect from the URL
 * so older saved settings (no provider field) keep working. */
export function providerOf(s: AISettings): AIProvider {
  if (s.provider === 'openai' || s.provider === 'gemini') return s.provider;
  return /generativelanguage\.googleapis\.com/i.test(s.endpoint) ? 'gemini' : 'openai';
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

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(`Could not reach the Gemini endpoint: ${(e as Error).message}. Check the URL in Settings → AI.`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    const msg = data?.error?.message ?? '';
    const hint = res.status === 404 && /model/i.test(msg)
      ? ' Check the Model name — press "Fetch models" in Settings to list the models this key can actually use.'
      : '';
    throw new Error(`Gemini returned ${res.status}. ${msg}${hint}`.trim());
  }
  const data = await res.json().catch(() => null) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  } | null;
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (!text) {
    const block = data?.promptFeedback?.blockReason ?? cand?.finishReason;
    throw new Error(`Gemini returned no text${block ? ` (reason: ${block})` : ''}. Try a different prompt or model.`);
  }
  return text;
}

/** Low-level chat completion. Throws a readable error on failure. */
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions = {}, settings: AISettings = loadAISettings()): Promise<string> {
  if (!hasAI(settings)) throw new Error('No AI endpoint configured. Add one in Settings → AI, or use the buttons (no key needed).');
  if (providerOf(settings) === 'gemini') return geminiComplete(messages, opts, settings, opts.signal);

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: opts.temperature ?? settings.temperature,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await fetch(settings.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(`Could not reach the AI endpoint: ${(e as Error).message}. Check the URL in Settings → AI.`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '') as string;
    let msg = text.slice(0, 300);
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string };
      msg = typeof data.error === 'string' ? data.error : data.error?.message ?? msg;
    } catch { /* keep raw text */ }
    const hint = res.status === 404 || res.status === 400
      ? ' If this mentions an unknown model, press "Fetch models" in Settings to list the models this endpoint offers.'
      : '';
    throw new Error(`AI endpoint returned ${res.status}. ${msg}${hint}`.trim());
  }
  const data = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI endpoint returned an unexpected response shape (no choices[0].message.content).');
  return content;
}

/** Query the endpoint for the models the key can actually use, so users never
 * have to guess model names. Gemini: GET /v1beta/models (x-goog-api-key).
 * OpenAI-compatible: GET /models on the same base as the chat URL. */
export async function listModels(settings: AISettings = loadAISettings(), signal?: AbortSignal): Promise<string[]> {
  if (!hasAI(settings)) throw new Error('Add an API key first — then Fetch models lists what the key can use.');
  if (providerOf(settings) === 'gemini') {
    const root = settings.endpoint.match(/^https?:\/\/[^/]+\/v1(?:beta)?\/models/i)?.[0]
      ?? `${GEMINI_ENDPOINT}`;
    let res: Response;
    try {
      res = await fetch(root, { headers: { 'x-goog-api-key': settings.apiKey }, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new Error(`Could not reach Gemini to list models: ${(e as Error).message}`);
    }
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
  let res: Response;
  try {
    res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${settings.apiKey}` }, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(`Could not reach ${base}/models: ${(e as Error).message}. Some servers (Ollama, LM Studio) may not support listing — type the model name instead.`);
  }
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