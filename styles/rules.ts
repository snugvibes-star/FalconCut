/**
 * Plain-words rules: users write notes like "captions always yellow, never
 * zoom more than 110 percent". We parse them into structured rules that
 * override the active style pack for EVERY future edit. Unparseable notes
 * are kept as 'note' rules and passed to the AI verbatim.
 */
import type { Rule, StylePack } from '../engine/types';
import { uid } from '../engine/types';

const COLOR_NAMES: Record<string, string> = {
  yellow: '#FFD400', gold: '#FFC53D', red: '#FF4D4F', green: '#3DDC84', lime: '#C6F24E',
  blue: '#38BDF8', cyan: '#22D3EE', white: '#FFFFFF', black: '#000000', orange: '#FF8A3D',
  purple: '#C084FC', violet: '#A78BFA', pink: '#F472B6', magenta: '#E879F9', teal: '#2DD4BF',
};

export function parseNote(text: string): Omit<Rule, 'id' | 'createdAt' | 'origin'>[] {
  const t = text.toLowerCase();
  const out: Omit<Rule, 'id' | 'createdAt' | 'origin'>[] = [];
  const push = (kind: Rule['kind'], value?: string | number) => out.push({ text, kind, value, enabled: true });

  // zoom limits
  const zoomPct = t.match(/(?:zoom|scale|punch)[^0-9]{0,24}(\d{2,3})\s*(?:%|percent)/);
  if (zoomPct && /never|not|max|no more|limit|only|up to|more than/.test(t)) push('max-zoom', parseInt(zoomPct[1]) / 100);
  if (/(no|never|without|disable|stop)\s+(?:any\s+)?zoom/.test(t)) push('no-zoom');
  // transitions
  if (/(no|never|without|disable|stop)\s+(?:any\s+)?transitions?/.test(t)) push('no-transitions');
  // captions
  if (/(no|never|without|disable|remove)\s+(?:any\s+)?(captions|subtitles|text)/.test(t)) push('no-captions');
  for (const [name, hex] of Object.entries(COLOR_NAMES)) {
    if (new RegExp(`captions?\\s+(?:always\\s+|in\\s+|are\\s+|color\\s+)?${name}`).test(t) || new RegExp(`${name}\\s+captions?`).test(t)) { push('caption-color', hex); break; }
  }
  if (/captions?\s+(?:always\s+)?higher|move captions? up|captions? up/.test(t)) push('caption-y', 0.68);
  if (/captions?\s+(?:always\s+)?lower|move captions? down|captions? down/.test(t)) push('caption-y', 0.86);
  if (/captions?\s+(?:always\s+)?bigger|larger captions?|bigger captions?/.test(t)) push('caption-size', 0.06);
  if (/captions?\s+(?:always\s+)?smaller|smaller captions?/.test(t)) push('caption-size', 0.038);
  if (/karaoke/.test(t)) push('caption-style', 'karaoke');
  if (/word[- ]by[- ]word|word pop|one word/.test(t)) push('caption-style', 'word-pop');
  if (/clean (subtitles|captions)|simple captions/.test(t)) push('caption-style', 'clean');
  if (/bold keyword/.test(t)) push('caption-style', 'bold-keywords');
  // music
  const musicPct = t.match(/music[^0-9]{0,20}(\d{1,3})\s*(?:%|percent)/);
  if (musicPct) push('music-level', parseInt(musicPct[1]) / 100);
  if (/music (quieter|softer|lower)/.test(t)) push('music-level', 0.08);
  if (/music louder/.test(t)) push('music-level', 0.28);
  if (/(no|never|without|remove)\s+(?:any\s+)?music/.test(t)) push('music-level', 0);
  // color look
  for (const preset of ['cinematic', 'warm', 'cool', 'natural', 'vibrant', 'black and white', 'black & white']) {
    if (t.includes(preset)) { push('color-preset', preset.startsWith('black') ? 'black-white' : preset); break; }
  }
  // dead air
  const pauseMs = t.match(/(?:pause|silence|dead air|gap)[^0-9]{0,24}(\d{2,4})\s*(ms|milliseconds|s\b|sec)/);
  if (pauseMs) push('dead-air', pauseMs[2].startsWith('m') ? parseInt(pauseMs[1]) : parseInt(pauseMs[1]) * 1000);

  if (!out.length) push('note');
  return out;
}

export function rulesFromNote(text: string, origin: 'user' | 'learned' = 'user'): Rule[] {
  return parseNote(text).map((r) => ({ ...r, id: uid('rule'), createdAt: Date.now(), origin }));
}

/** Apply enabled rules on top of a pack. Returns the effective pack. */
export function effectivePack(pack: StylePack, rules: Rule[]): StylePack {
  const p: StylePack = JSON.parse(JSON.stringify(pack));
  for (const r of rules) {
    if (!r.enabled) continue;
    switch (r.kind) {
      case 'caption-color': p.captions.color = String(r.value); p.captions.highlightColor = String(r.value); break;
      case 'caption-y': p.captions.y = Number(r.value); break;
      case 'caption-size': p.captions.fontSize = Number(r.value); break;
      case 'caption-style': p.captions.style = r.value as StylePack['captions']['style']; break;
      case 'no-captions': p.captions.enabled = false; break;
      case 'max-zoom': p.zoom.maxScale = Math.min(p.zoom.maxScale, Number(r.value)); break;
      case 'no-zoom': p.zoom.enabled = false; break;
      case 'no-transitions': p.transitions.enabled = false; break;
      case 'music-level': p.music.level = Number(r.value); p.music.duckLevel = Number(r.value) * 0.45; break;
      case 'color-preset': p.color = String(r.value); break;
      case 'dead-air': p.pacing.deadAirMaxMs = Number(r.value); break;
    }
  }
  return p;
}

export function ruleNotes(rules: Rule[]): string {
  return rules.filter((r) => r.enabled && r.kind === 'note').map((r) => `- ${r.text}`).join('\n');
}