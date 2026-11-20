/**
 * Text tools — the ones a person reaches for first ("add a title", "put
 * Welcome at the top"). They use the same `add_text` action the Text panel
 * uses, so AI-created text is fully editable in the inspector, selectable on
 * the timeline and undoable like any other edit.
 */
import type { Action } from '../engine/actions';
import { defaultTextStyle, projectDuration } from '../engine/types';
import type { ToolContext, ToolResult } from './cutTools';

const COLORS: Record<string, string> = {
  white: '#FFFFFF', black: '#000000', red: '#FF3B30', orange: '#FF9500',
  yellow: '#FFD60A', green: '#30D158', blue: '#0A84FF', purple: '#BF5AF2',
  pink: '#FF2D55', gold: '#E8C547', gray: '#9BA1AC', grey: '#9BA1AC',
};

function resolveColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  return COLORS[v.toLowerCase()];
}

export function addText(
  ctx: ToolContext,
  params: {
    text: string;
    position?: 'top' | 'center' | 'bottom';
    bold?: boolean;
    color?: string;
    size?: number;
    start?: number;
    duration?: number;
  },
): ToolResult {
  const p = ctx.project;
  const text = String(params.text ?? '').trim();
  if (!text) return { actions: [], summary: 'No text given.', warnings: ['add_text needs the words to show.'] };
  if (!p.tracks.some((t) => t.kind === 'text')) {
    return { actions: [], summary: 'This project has no text track.', warnings: ['Add a text track first (Timeline → + Text).'] };
  }

  const total = projectDuration(p);
  const start = Math.max(0, Math.min(Number(params.start) || 0, Math.max(0, total - 0.2)));
  const duration = Math.max(0.5, Math.min(Number(params.duration) || Math.min(3, Math.max(1.5, total - start || 3)), Math.max(0.5, total - start || 3)));
  const where = params.position ?? 'center';
  const y = where === 'top' ? 0.14 : where === 'bottom' ? 0.84 : 0.5;
  const color = resolveColor(params.color) ?? '#FFFFFF';
  const base = defaultTextStyle('clean');

  const actions: Action[] = [{
    type: 'add_text',
    start,
    duration,
    text,
    role: 'title',
    preset: 'clean',
    style: {
      ...base,
      fontSize: Math.max(0.03, Math.min(0.16, Number(params.size) || 0.085)),
      fontWeight: params.bold ? 900 : base.fontWeight,
      color,
      y,
      x: 0.5,
      maxWidth: 0.86,
      maxLines: 2,
      animation: 'fade',
      shadow: true,
      outlineWidth: 0,
    },
  }];

  const styleBits = [where === 'center' ? 'centred' : where, params.bold ? 'bold' : '', color !== '#FFFFFF' ? color : '']
    .filter(Boolean).join(', ');
  return {
    actions,
    summary: `Added the title “${text}” (${styleBits}) from ${start.toFixed(1)}s for ${duration.toFixed(1)}s.`,
    stats: { durationSec: duration },
  };
}
