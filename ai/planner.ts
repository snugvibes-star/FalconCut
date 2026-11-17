/**
 * The planner: turns a user request into a short, reviewable plan of tool
 * calls (3-8). With no AI key it falls back to the rules-only pipeline, so
 * "Auto edit" always works. Execution lives in the store (preview + lint per
 * step); this module only produces the plan and the shared project context.
 */
import type { Project } from '../engine/types';
import { projectDuration, getMedia } from '../engine/types';
import { getPack } from '../styles/packs';
import { effectivePack } from '../styles/rules';
import { lintProject } from '../quality/lint';
import { toolsPromptText, TOOL_MAP } from '../tools/registry';
import { AGENT_SYSTEM_PROMPT, parseAgentReply, validateCalls, type AgentReply } from './protocol';
import { ask, hasAI, loadAISettings, type AISettings } from './client';

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

/** No-AI fallback: the full rules pipeline. Always available. */
export function rulesPlan(project: Project, videoType?: string): Plan {
  const steps: PlanStep[] = [
    { tool: 'auto_edit', params: videoType ? { video_type: videoType } : {}, why: 'Full rules-only pipeline: balance audio, cut dead air/retakes/fillers, captions, zooms, transitions, color, hook, b-roll slots, music.' },
    { tool: 'auto_fix', params: {}, why: 'Run the quality checker and fix any remaining issues (up to 3 passes).' },
  ];
  void project;
  return { steps, summary: 'No AI key configured — using the built-in rules pipeline. Works fully on-device.', source: 'rules' };
}

export async function makePlan(
  project: Project,
  userRequest: string,
  settings: AISettings = loadAISettings(),
  signal?: AbortSignal,
): Promise<Plan> {
  if (!hasAI(settings)) return rulesPlan(project);
  const context = buildProjectContext(project);
  const system = `${AGENT_SYSTEM_PROMPT}\n\nYou are PLANNING. Propose 3 to 8 tool calls in execution order that fulfill the request. Give each call a short "why". Nothing is applied yet — the user reviews this plan first. If the request is vague, use auto_edit then auto_fix.`;
  const user = `${context}\n\nUSER REQUEST: ${userRequest || 'Make this video better.'}\n\nReturn ONLY the JSON object with a "calls" array (the plan).`;
  const text = await ask(system, user, { json: true, signal }, settings);
  const reply = parseAgentReply(text);
  const { valid, errors } = validateCalls(reply.calls);
  const plan = planFromReply({ ...reply, calls: valid });
  if (!plan.steps.length) return { ...rulesPlan(project), summary: 'The AI proposed no valid tools — falling back to the rules pipeline.' };
  if (errors.length) plan.summary += ` (${errors.join(' ')})`;
  return plan;
}