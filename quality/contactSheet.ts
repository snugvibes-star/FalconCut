/**
 * Contact sheet: a grid of rendered frames at key moments (hook, cuts,
 * caption starts, ending). Used by the quality report and the AI self-review.
 * Browser-only (needs the media resolver).
 */
import type { Project } from '../engine/types';
import { projectDuration } from '../engine/types';
import { renderFrame } from '../engine/render';
import type { MediaResolver } from '../engine/media';
import { tc } from '../analysis/storyboard';

export interface ContactSheet { dataUrl: string; moments: { t: number; label: string }[] }

export function pickKeyMoments(p: Project, max = 12): { t: number; label: string }[] {
  const dur = projectDuration(p);
  const moments: { t: number; label: string; prio: number }[] = [];
  const add = (t: number, label: string, prio: number) => {
    if (t >= 0 && t < dur && !moments.some((m) => Math.abs(m.t - t) < 0.4)) moments.push({ t, label, prio });
  };
  add(0.1, 'Opening / hook', 0);
  add(Math.max(0, dur - 0.3), 'Ending', 1);
  const videoClips = p.clips.filter((c) => c.kind === 'media').sort((a, b) => a.start - b.start);
  for (const c of videoClips.slice(0, 30)) add(c.start + 0.05, 'Cut', 2);
  const caps = p.clips.filter((c) => c.kind === 'text' && c.text?.role === 'caption');
  for (const c of caps.slice(0, 12)) add(c.start + Math.min(0.3, c.duration / 2), 'Caption', 3);
  for (const m of p.markers.filter((x) => x.kind === 'broll').slice(0, 4)) add(m.time, 'B-roll slot', 4);
  // fill evenly if sparse
  let i = 1;
  while (moments.length < Math.min(max, 6) && i < 6) { add((dur * i) / 6, 'Sample', 5); i++; }
  return moments.sort((a, b) => a.prio - b.prio || a.t - b.t).slice(0, max).sort((a, b) => a.t - b.t).map(({ t, label }) => ({ t, label }));
}

export async function renderContactSheet(
  p: Project,
  resolver: MediaResolver,
  opts: { cols?: number; cellW?: number; moments?: { t: number; label: string }[] } = {}
): Promise<ContactSheet> {
  const moments = opts.moments ?? pickKeyMoments(p);
  const cols = opts.cols ?? 4;
  const cellW = opts.cellW ?? 320;
  const aspect = p.settings.width / p.settings.height;
  const cellH = Math.round(cellW / aspect);
  const labelH = 26;
  const rows = Math.ceil(moments.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * (cellH + labelH);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0B0E16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const frame = document.createElement('canvas');
  frame.width = cellW; frame.height = cellH;
  const fctx = frame.getContext('2d')!;
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    resolver.hint?.(p.clips.find((c) => c.kind === 'media' && m.t >= c.start && m.t < c.start + c.duration)?.mediaId ?? '', 0);
    // give seeks a moment to land
    await new Promise((r) => setTimeout(r, 60));
    renderFrame(p, m.t, fctx, resolver);
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * (cellH + labelH);
    ctx.drawImage(frame, x, y);
    ctx.fillStyle = '#0F131D';
    ctx.fillRect(x, y + cellH, cellW, labelH);
    ctx.fillStyle = '#9AA7BF';
    ctx.font = '600 12px "Inter Variable", system-ui, sans-serif';
    ctx.fillText(`${tc(m.t)}  ${m.label}`.slice(0, 44), x + 8, y + cellH + 17);
  }
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.82), moments };
}