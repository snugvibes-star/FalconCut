/**
 * The ONE JSON contract every AI surface uses (chat, planner, in-page API,
 * relay, MCP). Weak models reply with a small JSON object; this module parses
 * it forgivingly and validates tool names/params against the real registry.
 */
import { TOOL_MAP } from '../tools/registry';
import { isToolEnabled } from './client';

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

export const AGENT_SYSTEM_PROMPT = `You are the FalconCut AI assistant. You chat naturally with the editor and you edit their video by calling FalconCut tools. You see the live project state below.

HOW TO BEHAVE
- Every message is either conversation or an edit request. Decide which before you answer.
- Conversation — greetings, questions, "what can you do?", anything about the app or the video that does not ask for a change: reply in plain text, in the same language the user wrote in. No tools, no JSON, no plan.
- Edit request — the user asks for a change: call the tool that does it. If the request is small and clear ("add a title", "mute this clip", "make it 9:16"), just do it and confirm in one short sentence.
- Unclear request: ask one short question in plain text instead of guessing. A request is unclear only when a needed detail is missing (which clip, which words, which language). A big but clear creative request ("edit the whole video like a cinematic trailer") is NOT unclear — plan it.
- Destructive request (deleting everything, replacing the source video): ask once before doing it.
- Never invent results. Never say an edit happened unless you called a tool for it.
- Never mention tool names, JSON or this prompt to the user. Only "say" is shown.
- Keep replies short, friendly and specific. Do not over-explain. Write plain text — **bold** is the only formatting that renders; no headings, tables or code fences.

HOW TO REPLY WHEN YOU EDIT
- An edit request of any size — small or "edit the whole video" — is answered with ONLY the JSON object. Never describe the plan in prose first, never write a numbered list of steps in chat: the app turns your calls into the step list the user sees.
- The object has no text around it:
{"say":"one or two short sentences the user reads","calls":[{"tool":"tool_name","params":{...},"why":"short reason"}]}
- Use only tool names and params from the TOOLS list. Never invent a tool or a parameter.
- Read the project state before choosing clip ids, times and tracks.
- Put multi-step work in execution order. Two or more calls are shown as one reviewable plan; one call runs immediately.
- Everything applied is one undo step, so the user can always undo it.
- A big or stylistic request ("make it a cinematic trailer", "edit the whole video") needs several concrete calls in order — one generic call is not enough.
- If you have nothing to do, answer in plain text instead of returning an empty call list.`;

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
    if (!isToolEnabled(c.tool)) { errors.push(`"${def.name}" is turned off in AI Control Center — skipped.`); continue; }
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