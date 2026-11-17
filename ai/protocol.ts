/**
 * The ONE JSON contract every AI surface uses (chat, planner, in-page API,
 * relay, MCP). Weak models reply with a small JSON object; this module parses
 * it forgivingly and validates tool names/params against the real registry.
 */
import { TOOL_MAP } from '../tools/registry';

export interface ToolCall {
  tool: string;
  params?: Record<string, unknown>;
  why?: string;
}

export interface AgentReply {
  thought?: string;
  say?: string;
  calls: ToolCall[];
}

export const AGENT_SYSTEM_PROMPT = `You are CutFlow's video editing assistant. You edit by calling tools, never by describing edits.
Reply with ONLY one JSON object (no markdown, no prose outside it):
{"thought":"<one short sentence of reasoning>","say":"<short friendly message to the user>","calls":[{"tool":"<tool name>","params":{<params>}}]}
Rules:
- Use ONLY the tool names and params given in the tool list. Do not invent any.
- Prefer a few high-level tools over many small ones. auto_edit does a full pipeline in one call.
- Every call is previewed for the user before it is applied, so you can be bold but explain in "say".
- If no edit is needed, return "calls":[] and explain why in "say".
- Keep "thought" and "say" short. Never put video files or keys anywhere.`;

/** Pull the first valid JSON value out of a model reply (handles code fences). */
export function extractJSON(text: string): unknown | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) candidates.push(text.slice(objStart, objEnd + 1));
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(text.slice(arrStart, arrEnd + 1));
  candidates.push(text.trim());
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
  }
  return null;
}

function normalizeCalls(arr: unknown[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = o.tool ?? o.name ?? o.action;
    if (typeof name !== 'string' || !name) continue;
    const rawParams = o.params ?? o.arguments ?? o.args ?? {};
    const params = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? (rawParams as Record<string, unknown>) : {};
    const why = o.why ?? o.reason;
    out.push({ tool: name, params, ...(typeof why === 'string' ? { why } : {}) });
  }
  return out;
}

/** Parse a model reply into an AgentReply. Never throws. */
export function parseAgentReply(text: string): AgentReply {
  const data = extractJSON(text);
  if (data == null) return { say: text.trim().slice(0, 600), calls: [] };
  if (Array.isArray(data)) return { calls: normalizeCalls(data) };
  if (typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const callsRaw = o.calls ?? o.tools ?? o.actions ?? (typeof o.tool === 'string' ? [o] : []);
    const say = typeof o.say === 'string' ? o.say : typeof o.message === 'string' ? o.message : undefined;
    return {
      thought: typeof o.thought === 'string' ? o.thought : undefined,
      say,
      calls: normalizeCalls(Array.isArray(callsRaw) ? callsRaw : []),
    };
  }
  return { say: text.trim().slice(0, 600), calls: [] };
}

export interface ValidatedCalls {
  valid: ToolCall[];
  errors: string[];
}

/** Validate against the registry; coerce numbers, drop bad enum values. */
export function validateCalls(calls: ToolCall[]): ValidatedCalls {
  const valid: ToolCall[] = [];
  const errors: string[] = [];
  for (const c of calls) {
    const def = TOOL_MAP.get(c.tool);
    if (!def) { errors.push(`Unknown tool "${c.tool}" — skipped.`); continue; }
    const params: Record<string, unknown> = { ...(c.params ?? {}) };
    for (const [key, spec] of Object.entries(def.params)) {
      if (params[key] === undefined) {
        if (spec.default !== undefined) params[key] = spec.default;
        continue;
      }
      if (spec.type === 'number') {
        const n = Number(params[key]);
        if (Number.isFinite(n)) params[key] = n; else delete params[key];
      } else if (spec.type === 'boolean') {
        params[key] = params[key] === true || params[key] === 'true';
      } else if (spec.type === 'enum' && spec.enum && !spec.enum.includes(String(params[key]))) {
        errors.push(`${c.tool}: "${key}" must be one of ${spec.enum.join(', ')} — using default.`);
        if (spec.default !== undefined) params[key] = spec.default; else delete params[key];
      }
    }
    valid.push({ tool: c.tool, params, ...(c.why ? { why: c.why } : {}) });
  }
  return { valid, errors };
}