/**
 * One conversational turn: either chat or editing.
 *
 * The assistant used to turn *every* message into a plan, which made "hello"
 * produce a fake step list. Now the model decides the intent:
 *   - conversation → plain text, no tools, no plan card
 *   - one clear edit → a single tool call that runs immediately
 *   - multi-step work → a real model-written plan the user can review
 *
 * Without a key the same decision is made by the rules router, so the chat is
 * still useful — it just says what it can and cannot understand.
 */
import type { Project } from '../engine/types';
import { AGENT_SYSTEM_PROMPT, parseAgentReply, validateCalls } from './protocol';
import { buildProjectContext, looksLikeEdit, planFromReply, rulesPlan, type Plan } from './planner';
import { chatStream, hasAI, loadAISettings, type AISettings, type ChatMessage as WireMessage } from './client';

export interface HistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatTurn {
  text: string;
  /** Present only when the assistant really wants to change the project. */
  plan?: Plan;
  mode: 'chat' | 'action' | 'plan';
}

/* ---- deterministic intents (handled by the store, never by a model) ------ */
export function undoIntent(text: string): 'undo' | 'redo' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(undo|undo that|undo it|undo the last (edit|action)|revert|revert that|revert it|go back|put it back)$/.test(t)) return 'undo';
  if (/^(redo|redo that|redo it|redo the last (edit|action))$/.test(t)) return 'redo';
  return null;
}

/* ---- keyless (rules) conversation --------------------------------------- */
const GREETING = /^(hi|hello|hey|hiya|yo|hola|namaste|salam|assalam|good (morning|afternoon|evening)|how are you)\b/i;
const CAPS = /\b(what can you do|what do you do|who are you|what are you|your (features|abilities)|how do i use|how does this work)\b/i;
const THANKS = /^(thanks|thank you|thx|cheers|nice|cool|great|perfect|awesome)\b/i;

const RULES_NOTE = 'I am CutFlow’s built-in assistant, and no AI key is connected yet, so I follow the rules engine instead of a language model.';

const HELP_TEXT = [
  RULES_NOTE,
  'I can handle clear edit instructions: make this 9:16 for TikTok, add captions, add a hook title or a text title, remove pauses, filler words or retakes, clean and balance audio, add zooms, transitions or music, mark b-roll slots, apply colour looks, fix quality issues, build A/B variants, cut multicam, and translate captions.',
  'Add a key in Settings → AI to chat freely, in any language, and to let the model plan unusual requests.',
].join('\n\n');

/** Answer without a model. Never invents a plan and never pretends to be one. */
function rulesTurn(project: Project, text: string): ChatTurn {
  const t = text.trim();

  if (undoIntent(t)) {
    // The store handles undo/redo before reaching this point.
    return { mode: 'chat', text: 'Tell me “undo that” right after an edit and I will revert it.' };
  }

  if (looksLikeEdit(t)) {
    const plan = rulesPlan(project, t);
    return {
      mode: plan.steps.length === 1 ? 'action' : 'plan',
      plan,
      text: plan.summary,
    };
  }

  if (GREETING.test(t)) {
    return {
      mode: 'chat',
      text: `Hi! ${RULES_NOTE}\n\nWhat are we editing? Try “make this a 9:16 TikTok with captions”, “add a bold title saying Welcome” or “remove the pauses”.`,
    };
  }
  if (CAPS.test(t)) return { mode: 'chat', text: HELP_TEXT };
  if (THANKS.test(t)) return { mode: 'chat', text: 'Anytime. Tell me the next change when you are ready.' };
  if (/^(bye|goodbye|see you|good night)\b/i.test(t)) return { mode: 'chat', text: 'See you. Your project is saved on this device.' };

  return {
    mode: 'chat',
    text: `${RULES_NOTE}\n\nI did not recognise an edit in that. Try a concrete instruction — a platform reframe, captions, a title, cutting pauses or fillers, audio cleanup, zooms, transitions, music, colour, quality fixes, A/B variants, multicam or caption translation. Add a key in Settings → AI for free-form chat and planning.`,
  };
}

/* ---- main entry --------------------------------------------------------- */
export async function respond(
  project: Project,
  text: string,
  history: HistoryTurn[] = [],
  settings: AISettings = loadAISettings(),
  onDelta?: (delta: string) => void,
): Promise<ChatTurn> {
  if (!hasAI(settings)) return rulesTurn(project, text);

  const system = `${AGENT_SYSTEM_PROMPT}\n\nPROJECT STATE (live, read it before editing)\n${buildProjectContext(project)}`;
  const messages: WireMessage[] = [{ role: 'system', content: system }];
  for (const turn of history.slice(-16)) {
    if (turn.text.trim()) messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({ role: 'user', content: text });

  // Stream prose to the UI, but hold back a JSON reply: it may be an edit, and
  // the user must never see raw JSON. The first non-space character decides.
  let probe = '';
  let decided = false;
  let isJson = false;
  const emit = (delta: string) => {
    if (!decided) {
      probe += delta;
      const head = probe.trimStart();
      if (!head) return;
      decided = true;
      isJson = head.startsWith('{') || head.startsWith('[') || head.startsWith('```');
      if (!isJson) onDelta?.(probe);
      return;
    }
    if (!isJson) onDelta?.(delta);
  };

  const raw = await chatStream(messages, emit, { temperature: settings.temperature }, settings);
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('The model returned an empty reply. Try again.');

  const looksJson = /^(\{|\[|```)/.test(trimmed);
  if (!looksJson) return { mode: 'chat', text: trimmed };

  const reply = parseAgentReply(trimmed);
  const { valid, errors } = validateCalls(reply.calls);
  const say = reply.say?.trim() ?? '';

  if (!valid.length) {
    return {
      mode: 'chat',
      text: say || 'I did not find an edit to make. Tell me what to change and I will do it.',
    };
  }

  const plan = planFromReply({ ...reply, calls: valid });
  if (errors.length) plan.summary = `${plan.summary} (${errors.join(' ')})`.trim();
  return {
    mode: valid.length === 1 ? 'action' : 'plan',
    plan,
    text: say || plan.summary,
  };
}
