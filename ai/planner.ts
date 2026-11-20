/**
 * The planner: reads a request and returns the tool calls that would satisfy
 * it. The model writes the calls when a key is connected; the built-in rules
 * router does the same job on-device when there is no key, and says so.
 * Execution lives in the store (preview + lint per step); this module only
 * produces the plan and the shared project context.
 */
import type { Project } from '../engine/types';
import { projectDuration, getMedia } from '../engine/types';
import { getPack } from '../styles/packs';
import { effectivePack } from '../styles/rules';
import { lintProject } from '../quality/lint';
import { toolsPromptText, TOOL_MAP } from '../tools/registry';
import type { AgentReply } from './protocol';

export interface PlanStep {
  tool: string;
  params: Record<string, unknown>;
  why: string;
}

export interface Plan {
  steps: PlanStep[];
  summary: string;
  source: 'ai' | 'rules';
}

/** Compact, model-readable snapshot of the project + analysis + quality. */
export function buildProjectContext(project: Project): string {
  const pack = effectivePack(getPack(project), project.rules);
  const dur = projectDuration(project);
  const lines: string[] = [];
  lines.push(`PROJECT: "${project.name}" · ${project.settings.aspect} ${project.settings.width}x${project.settings.height} · ${dur.toFixed(1)}s · ${project.clips.length} clips · ${project.tracks.length} tracks`);
  // Clip ids are what make targeted edits ("trim this clip", "delete that")
  // possible. Only the first 40 are listed to keep the prompt small.
  const timeline = project.clips.slice(0, 40).map((c) => {
    const track = project.tracks.find((t) => t.id === c.trackId);
    const name = c.name || c.text?.text || getMedia(project, c.mediaId)?.name || c.kind;
    return `- ${c.id} · ${track?.name ?? '?'} · ${c.start.toFixed(1)}–${(c.start + c.duration).toFixed(1)}s · ${c.kind} “${name.slice(0, 40)}”`;
  });
  lines.push(`TIMELINE (clip_id · track · start–end · kind):\n${timeline.join('\n') || '(empty)'}`);
  lines.push(`STYLE PACK: ${pack.name} (${pack.videoType}). Pacing: avg shot ${pack.pacing.avgShotSec}s, dead air max ${pack.pacing.deadAirMaxMs}ms. Captions: ${pack.captions.enabled ? pack.captions.style : 'off'}. Zoom: ${pack.zoom.enabled ? `max ${pack.zoom.maxScale}` : 'off'}. Color: ${pack.color}.`);
  if (project.rules.length) lines.push(`USER RULES: ${project.rules.filter((r) => r.enabled).map((r) => r.text).join(' | ')}`);

  const an = project.analysis;
  if (an) {
    for (const ma of Object.values(an.byMedia)) {
      const asset = getMedia(project, ma.mediaId);
      const bits: string[] = [`${asset?.name ?? ma.mediaId} (${ma.duration.toFixed(0)}s)`];
      bits.push(`${ma.integratedLoudness} LUFS`);
      if (ma.isMusic) bits.push(`music ~${ma.bpm} BPM`);
      else bits.push(`${Math.round(ma.speechRatio * 100)}% speech`);
      if (ma.silences.length) bits.push(`${ma.silences.length} pauses`);
      if (ma.scenes.length) bits.push(`${ma.scenes.length} shot cuts`);
      if (ma.faces.length) bits.push(`face tracked (${ma.faceMethod})`);
      if (ma.fillers.length) bits.push(`${ma.fillers.length} fillers`);
      if (ma.retakes.length) bits.push(`${ma.retakes.length} retakes`);
      if (ma.transcript?.words.length) {
        const text = ma.transcript.segments.map((s) => s.text).join(' ');
        bits.push(`transcript: "${text.slice(0, 400)}${text.length > 400 ? '…' : ''}"`);
      } else {
        bits.push('no transcript yet');
      }
      lines.push(`MEDIA ${bits.join(' · ')}`);
    }
    if (an.storyboard) lines.push(`STORYBOARD:\n${an.storyboard.slice(0, 1200)}`);
  } else {
    lines.push('ANALYSIS: not run yet (import media to analyze).');
  }

  const report = lintProject(project, pack);
  lines.push(`QUALITY: score ${report.score}/100, ${report.issues.length} issues. ${report.issues.slice(0, 6).map((i) => `[${i.severity}] ${i.code}: ${i.message}`).join(' ')}`);
  lines.push(`\nTOOLS (call these by name):\n${toolsPromptText()}`);
  return lines.join('\n');
}

export function planFromReply(reply: AgentReply): Plan {
  const steps: PlanStep[] = reply.calls.slice(0, 8).map((c) => ({
    tool: c.tool,
    params: c.params ?? {},
    why: c.why ?? TOOL_MAP.get(c.tool)?.description ?? '',
  }));
  return {
    steps,
    summary: reply.say?.trim() || (steps.length ? `Plan: ${steps.map((s) => s.tool).join(' → ')}` : 'No edits proposed.'),
    source: 'ai',
  };
}

/* ---- rules-only intent router -------------------------------------------
 * Without a key there is no model to read the request, but most editing asks
 * are recognisable. This maps the words people actually type onto the same
 * real tools the AI would call, so chat still does what it says — and the
 * summary lists exactly which intents matched, so nothing is invented. */
interface Intent {
  id: string;
  test: RegExp;
  steps: PlanStep[];
}

const INTENTS: Intent[] = [
  { id: '9:16 reframe', test: /\b(tiktok|reels?|shorts?|vertical|9:16|portrait video)\b/i, steps: [{ tool: 'reframe', params: { aspect: '9:16' }, why: 'Vertical frame for TikTok / Reels / Shorts.' }] },
  { id: '1:1 reframe', test: /\b(square|1:1)\b/i, steps: [{ tool: 'reframe', params: { aspect: '1:1' }, why: 'Square frame for feed posts.' }] },
  { id: '4:5 reframe', test: /\b(4:5|instagram feed|ig feed)\b/i, steps: [{ tool: 'reframe', params: { aspect: '4:5' }, why: 'Portrait 4:5 frame for Instagram feed.' }] },
  { id: '16:9 reframe', test: /\b(youtube|landscape|widescreen|16:9|horizontal)\b/i, steps: [{ tool: 'reframe', params: { aspect: '16:9' }, why: 'Landscape frame for YouTube.' }] },
  { id: 'captions', test: /\b(caption|captions|subtitle|subtitles|subtitled|srt)\b/i, steps: [{ tool: 'add_captions', params: {}, why: 'Styled captions from the transcript.' }] },
  { id: 'hook title', test: /\b(hook|title|headline|attention|thumbnail text)\b/i, steps: [{ tool: 'add_hook_title', params: {}, why: 'Big opening title in the first 3 seconds.' }] },
  { id: 'remove dead air', test: /\b(dead air|pause|pauses|silence|silent|slow|drag|dragging|tighten|tighter|pace|paced|pacing|faster|fast|snappier|speed up)\b/i, steps: [{ tool: 'remove_dead_air', params: {}, why: 'Cut silent gaps so the pacing stays tight.' }] },
  { id: 'remove fillers', test: /\b(filler|fillers|ums?|uhs?|erm+|you know|like i said)\b/i, steps: [{ tool: 'remove_fillers', params: {}, why: 'Remove filler words from the transcript.' }] },
  { id: 'cut retakes', test: /\b(retake|retakes|false start|restart|mess ?up)\b/i, steps: [{ tool: 'cut_retakes', params: {}, why: 'Keep the last complete take of repeated lines.' }] },
  { id: 'audio cleanup', test: /\b(noise|noisy|hiss|hiss|hum|echo|muddy|clean(?: up)? (?:the )?audio|voice ?over)\b/i, steps: [{ tool: 'cleanup_audio', params: {}, why: 'Reduce noise and harsh sibilance.' }] },
  { id: 'audio balance', test: /\b(audio|sound|loud|louder|volume|levels?|quiet|clipping|normaliz)/i, steps: [{ tool: 'balance_audio', params: {}, why: 'Even, broadcast-safe loudness.' }] },
  { id: 'zoom energy', test: /\b(zoom|zooms|energy|energetic|punch|dynamic|movement)\b/i, steps: [{ tool: 'zoom_on_emphasis', params: {}, why: 'Gentle punch-ins on emphasized words.' }] },
  { id: 'transitions', test: /\b(transition|transitions|crossfade|dissolve|smooth cuts)\b/i, steps: [{ tool: 'add_transitions', params: {}, why: 'Restrained transitions only at real scene changes.' }] },
  { id: 'music', test: /\b(music|song|soundtrack|background track|bgm)\b/i, steps: [{ tool: 'add_music', params: {}, why: 'Music bed ducked under speech.' }] },
  { id: 'b-roll', test: /\b(b-?roll|cutaway|cutaways|stock footage)\b/i, steps: [{ tool: 'add_broll_slots', params: {}, why: 'Mark long talking stretches for cutaways.' }] },
  { id: 'color look', test: /\b(cinematic|color|colour|grade|grading|look|warm|cool|vibrant|black and white|b&w|moody)\b/i, steps: [{ tool: 'apply_color_preset', params: {}, why: 'Apply a matching color look to every clip.' }] },
  { id: 'quality fix', test: /\b(quality|lint|fix|errors|issues|review)\b/i, steps: [{ tool: 'auto_fix', params: {}, why: 'Run the quality checker and fix what it reports.' }] },
  { id: 'A/B variants', test: /\b(a\/b|ab test|variants?|alternatives?)\b/i, steps: [{ tool: 'ab_variants', params: {}, why: 'Build alternative edits to compare.' }] },
  { id: 'multi-cam', test: /\b(multi-?cam|angles?|camera switch)\b/i, steps: [{ tool: 'auto_multicam', params: {}, why: 'Cut between camera angles on speaker turns.' }] },
];

const TRANSLATE = /\btranslate\b[^.]*?\b(?:to|into)\s+([a-z][a-z -]{2,24})/i;

/** Read a "add text/title …" request the way a person means it. The quoted
 *  form wins; otherwise take the words before a position/style clause. */
export function parseTextRequest(q: string): Record<string, unknown> | null {
  const quoted = q.match(/\b(?:add|insert|put|create|write)\b[^.]*?\b(?:text|title|label|words?)\b[^"“'’]*["“'’]([^"”'’]{1,120})["”'’]/i);
  const loose = quoted ? null : q.match(/\b(?:add|insert|put|create|write)\b[^.]*?\b(?:text|title|label)\b\s+(?:that says\s+|saying\s+)?([^.,;:]{1,80}?)(?=\s+(?:at|on|in|to|and|with)\b|[.!?]?$)/i);
  const text = (quoted?.[1] ?? loose?.[1] ?? '').trim().replace(/^["'“”]|["'“”]$/g, '');
  if (!text || /^(it|this|that|here|there)$/i.test(text)) return null;
  if (/^(to|for|at|on|in|with|and)\b/i.test(text)) return null;

  const params: Record<string, unknown> = { text };
  if (/\b(top|upper)\b/i.test(q)) params.position = 'top';
  else if (/\b(bottom|lower)\b/i.test(q)) params.position = 'bottom';
  if (/\b(bold|heavy|thick)\b/i.test(q)) params.bold = true;
  const color = q.match(/\b(white|black|red|orange|yellow|green|blue|purple|pink|gold|gr[ae]y)\b/i);
  if (color) params.color = color[1].toLowerCase();
  return params;
}

/** True when the message asks for a change, so rules mode may use a plan. */
export function looksLikeEdit(q: string): boolean {
  const t = q.trim();
  if (!t) return false;
  return INTENTS.some((i) => i.test.test(t))
    || TRANSLATE.test(t)
    || !!parseTextRequest(t)
    || /\b(add|insert|put|create|make|edit|cut|trim|split|remove|delete|replace|change|set|apply|fix|clean|speed|slow|zoom|crop|resize|mute|unmute|move|sync|colour|color|grade|export|render|reverse|freeze)\b/i.test(t);
}

/** No-AI fallback. Reads the request the way a person would and returns the
 *  matching tools; falls back to the full pipeline when nothing is recognised. */
export function rulesPlan(project: Project, request = '', videoType?: string): Plan {
  const q = (request || '').trim();
  const steps: PlanStep[] = [];
  const matched: string[] = [];

  const textRequest = parseTextRequest(q);
  if (textRequest) {
    steps.push({ tool: 'add_text', params: textRequest, why: 'Add the text you asked for as an editable title clip.' });
    matched.push('text title');
  }

  for (const intent of INTENTS) {
    if (textRequest && intent.id === 'hook title') continue;
    if (intent.test.test(q)) {
      steps.push(...intent.steps);
      matched.push(intent.id);
    }
  }

  const translate = q.match(TRANSLATE);
  if (translate) {
    const language = translate[1].trim().replace(/[.!?].*$/, '');
    steps.push({ tool: 'translate_captions', params: { language }, why: `Translate captions to ${language}.` });
    matched.push(`translate → ${language}`);
  }

  // "trim the first 5 seconds" is unambiguous: it means the earliest clip.
  const trim = q.match(/\b(?:trim|cut|remove)\b[^.]*?\b(?:first|start(?:ing)?)\s+(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|seconds?\b)/i);
  if (trim && project.clips.length) {
    const first = [...project.clips].sort((a, b) => a.start - b.start)[0];
    const seconds = Number(trim[1]);
    steps.push({
      tool: 'timeline_edit',
      params: { clip_id: first.id, operation: 'trim_start', value: first.start + seconds },
      why: `Drop the first ${seconds}s.`,
    });
    matched.push('trim start');
  }

  // "Make it better / professional / premium" and anything unrecognised get the
  // full rules pipeline — still one undo step and still honest about what ran.
  if (!steps.length || /\b(better|best|professional|pro|premium|polish|auto ?edit|full edit|improve)\b/i.test(q)) {
    return {
      steps: [
        { tool: 'auto_edit', params: videoType ? { video_type: videoType } : {}, why: 'Full rules-only pipeline: balance audio, cut dead air/retakes/fillers, captions, zooms, transitions, color, hook, b-roll slots, music.' },
        { tool: 'auto_fix', params: {}, why: 'Run the quality checker and fix any remaining issues (up to 3 passes).' },
      ],
      summary: q
        ? `Built-in rules pipeline used for “${q.slice(0, 80)}” — add an AI key in Settings to have a model plan unusual requests.`
        : 'Built-in rules pipeline. Works fully on-device — no AI key needed.',
      source: 'rules',
    };
  }

  // De-duplicate (two intents can map to the same tool) and cap the plan.
  const seen = new Set<string>();
  const unique = steps.filter((s) => (seen.has(s.tool) ? false : (seen.add(s.tool), true))).slice(0, 8);
  void project;
  return {
    steps: unique,
    summary: `Matched your request with the built-in rules: ${matched.slice(0, 6).join(', ')}. Review the plan, then Run.`,
    source: 'rules',
  };
}
