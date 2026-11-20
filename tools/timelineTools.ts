/**
 * Direct timeline surgery for the assistant: move, trim, split, delete, mute
 * and change speed on one clip. The clip id comes from the TIMELINE block in
 * the project context, so the model edits the real clip the user means.
 */
import type { Action } from '../engine/actions';
import type { ToolContext, ToolResult } from './cutTools';

export type TimelineOp = 'move' | 'trim_start' | 'trim_end' | 'split' | 'delete' | 'speed' | 'mute' | 'unmute';

export function editTimeline(
  ctx: ToolContext,
  params: { clip_id: string; operation: TimelineOp; value?: number },
): ToolResult {
  const p = ctx.project;
  const id = String(params.clip_id ?? '').trim();
  const clip = p.clips.find((c) => c.id === id) ?? p.clips.find((c) => c.id.toLowerCase() === id.toLowerCase());
  if (!clip) {
    return {
      actions: [],
      summary: `No clip with id "${id}".`,
      warnings: ['Read the TIMELINE block and use the exact clip_id.'],
    };
  }
  const value = Number(params.value);
  const label = clip.name || clip.text?.text || clip.id;
  const actions: Action[] = [];

  switch (params.operation) {
    case 'delete':
      actions.push({ type: 'remove_clip', clipId: clip.id });
      return { actions, summary: `Deleted “${label}”.` };

    case 'mute':
      actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { volume: 0 } });
      return { actions, summary: `Muted “${label}”.` };

    case 'unmute':
      actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { volume: 1 } });
      return { actions, summary: `Unmuted “${label}”.` };

    case 'move':
      if (!Number.isFinite(value)) return { actions: [], summary: 'move needs a start time in seconds.' };
      actions.push({ type: 'move_clip', clipId: clip.id, start: Math.max(0, value) });
      return { actions, summary: `Moved “${label}” to ${Math.max(0, value).toFixed(2)}s.` };

    case 'trim_start':
      if (!Number.isFinite(value) || value <= clip.start) return { actions: [], summary: 'trim_start needs a new start time after the current one.' };
      actions.push({ type: 'trim_clip', clipId: clip.id, start: value });
      return { actions, summary: `Trimmed the start of “${label}” to ${value.toFixed(2)}s.` };

    case 'trim_end':
      if (!Number.isFinite(value) || value <= 0.05) return { actions: [], summary: 'trim_end needs the new duration in seconds.' };
      actions.push({ type: 'trim_clip', clipId: clip.id, duration: value });
      return { actions, summary: `Shortened “${label}” to ${value.toFixed(2)}s.` };

    case 'split':
      if (!Number.isFinite(value) || value <= clip.start || value >= clip.start + clip.duration) {
        return { actions: [], summary: 'split needs a time inside the clip.' };
      }
      actions.push({ type: 'split_clip', clipId: clip.id, time: value });
      return { actions, summary: `Split “${label}” at ${value.toFixed(2)}s.` };

    case 'speed':
      if (!Number.isFinite(value) || value <= 0 || value > 8) return { actions: [], summary: 'speed must be between 0.1 and 8.' };
      actions.push({ type: 'set_speed', clipId: clip.id, speed: value });
      return { actions, summary: `Set “${label}” to ${value}× speed.` };

    default:
      return {
        actions: [],
        summary: `Unknown operation “${String(params.operation)}”.`,
        warnings: ['Use move, trim_start, trim_end, split, delete, speed, mute or unmute.'],
      };
  }
}
