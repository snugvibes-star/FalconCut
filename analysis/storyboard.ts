/**
 * The storyboard: a compact plain-text summary of the whole project that can
 * be pasted into ANY language model. This is how the AI "sees" the video
 * without watching it.
 */
import type { Project } from '../engine/types';
import { getMedia, projectDuration } from '../engine/types';

export const tc = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
};

export function buildStoryboard(p: Project, maxChars = 6000): string {
  const lines: string[] = [];
  const dur = projectDuration(p);
  lines.push(`PROJECT "${p.name}" | ${p.settings.aspect} ${p.settings.width}x${p.settings.height} ${p.settings.fps}fps | duration ${dur.toFixed(1)}s | style pack: ${p.stylePackId}`);
  lines.push(`TRACKS: ${p.tracks.map((t) => `${t.name}(${t.kind}${t.muted ? ',muted' : ''}${t.hidden ? ',hidden' : ''})`).join(', ')}`);
  lines.push(`CLIPS (${p.clips.length}):`);
  for (const c of [...p.clips].sort((a, b) => a.start - b.start).slice(0, 60)) {
    const track = p.tracks.find((t) => t.id === c.trackId);
    const media = getMedia(p, c.mediaId);
    const what = c.kind === 'text' ? `text "${(c.text?.text ?? '').slice(0, 40)}"` : c.kind === 'motif' ? `motif ${c.motif?.type}` : media?.name ?? 'media';
    lines.push(`  [${tc(c.start)}-${tc(c.start + c.duration)}] ${track?.name ?? '?'} ${what}${c.speed !== 1 ? ` @${c.speed}x` : ''}${c.transitionIn ? ` +${c.transitionIn.type}` : ''}`);
  }
  if (p.clips.length > 60) lines.push(`  ... ${p.clips.length - 60} more clips`);

  for (const m of p.media) {
    const ma = p.analysis?.byMedia[m.id];
    if (!ma) continue;
    lines.push(`\nMEDIA "${m.name}" (${m.type}, ${m.duration.toFixed(1)}s${m.width ? `, ${m.width}x${m.height}` : ''}):`);
    if (ma.scenes.length) lines.push(`  SHOT CHANGES at: ${ma.scenes.slice(0, 30).map(tc).join(', ')}${ma.scenes.length > 30 ? '...' : ''}`);
    if (ma.transcript?.words.length) {
      lines.push(`  TRANSCRIPT (${ma.transcript.model}${ma.transcript.complete ? '' : ', PARTIAL'}):`);
      for (const seg of ma.transcript.segments.slice(0, 80)) {
        lines.push(`    [${tc(seg.start)}-${tc(seg.end)}] ${seg.text}`);
      }
      if (ma.transcript.segments.length > 80) lines.push(`    ... ${ma.transcript.segments.length - 80} more segments`);
    }
    if (ma.silences.length) lines.push(`  SILENCES (>threshold): ${ma.silences.slice(0, 25).map((s) => `${tc(s.start)}-${tc(s.end)} (${(s.end - s.start).toFixed(1)}s)`).join('; ')}`);
    if (ma.fillers.length) lines.push(`  FILLERS: ${ma.fillers.slice(0, 25).map((f) => `"${f.text}" @${tc(f.start)}`).join('; ')}`);
    if (ma.retakes.length) lines.push(`  RETAKES: ${ma.retakes.map((r) => `${r.attempts.length} attempts @${tc(r.start)}, best is #${r.bestIndex + 1} @${tc(r.attempts[r.bestIndex].start)}`).join('; ')}`);
    if (ma.faces.length) {
      const avgX = ma.faces.reduce((a, f) => a + f.x, 0) / ma.faces.length;
      const present = ma.faces.filter((f) => f.conf > 0.15).length / ma.faces.length;
      lines.push(`  FACE/SUBJECT: present ${(present * 100).toFixed(0)}% of time, avg x=${avgX.toFixed(2)} (0=left,1=right), method=${ma.faceMethod}`);
    }
    lines.push(`  AUDIO: loudness ${ma.integratedLoudness} LUFS, peak ${ma.truePeak.toFixed(2)}, ${ma.isMusic ? `MUSIC ~${ma.bpm} BPM (${ma.beats.length} beats)` : `speech ratio ${ma.speechRatio}`}`);
    if (ma.keywords.length) lines.push(`  KEYWORDS: ${ma.keywords.join(', ')}`);
    if (ma.flags.length) lines.push(`  NOTES: ${ma.flags.join('; ')}`);
  }
  const openTacks = p.tacks.filter((t) => !t.resolved);
  if (openTacks.length) lines.push(`\nOPEN TACKS: ${openTacks.map((t) => `@${tc(t.time)} ${t.author}: ${t.text}`).join(' | ')}`);
  let text = lines.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars - 20) + '\n...[truncated]';
  return text;
}

export function analysisSummary(p: Project): string {
  const parts: string[] = [];
  for (const m of p.media) {
    const ma = p.analysis?.byMedia[m.id];
    if (!ma) { parts.push(`${m.name}: not analyzed yet`); continue; }
    parts.push(`${m.name}: ${ma.transcript?.words.length ?? 0} words, ${ma.silences.length} silences (${ma.silences.reduce((a, s) => a + s.end - s.start, 0).toFixed(1)}s), ${ma.fillers.length} fillers, ${ma.retakes.length} retake groups, ${ma.scenes.length} shot changes, ${ma.integratedLoudness} LUFS${ma.isMusic ? `, music ${ma.bpm}bpm` : ''}`);
  }
  return parts.join('\n') || 'No media analyzed yet.';
}