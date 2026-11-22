/**
 * Caption layout + drawing. Deterministic given the same fonts.
 * Handles: clean subtitles, karaoke word highlight, bold keywords, word-pop.
 * Max 2 lines, safe-zone aware, outline + shadow for mobile readability.
 */
import type { CaptionWord, TextStyle } from './types';
import { ease } from './easing';

export interface LayoutWord { w: string; width: number; keyword: boolean; filler: boolean; active: boolean; sung: boolean; start?: number; end?: number }
export interface LayoutLine { words: LayoutWord[]; width: number }
export interface CaptionLayout { lines: LayoutLine[]; fontSize: number; lineHeight: number; blockW: number; blockH: number }

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function fontString(style: TextStyle, fontSize: number): string {
  return `${style.fontWeight} ${fontSize}px "${style.fontFamily}", "Inter Variable", system-ui, sans-serif`;
}

export function wrapWords(words: { w: string; keyword?: boolean; filler?: boolean; start?: number; end?: number }[], maxW: number, maxLines: number, measure: (s: string) => number, spaceW: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
  let cur: LayoutWord[] = [];
  let curW = 0;
  for (const word of words) {
    const width = measure(word.w);
    const add = cur.length ? spaceW + width : width;
    if (cur.length && curW + add > maxW) {
      lines.push({ words: cur, width: curW });
      cur = []; curW = 0;
      if (lines.length >= maxLines) break;
    }
    cur.push({ w: word.w, width, keyword: !!word.keyword, filler: !!word.filler, active: false, sung: false, start: word.start, end: word.end });
    curW += cur.length > 1 ? spaceW + width : width;
  }
  if (cur.length && lines.length < maxLines) lines.push({ words: cur, width: curW });

  // Orphan control: a two-line caption should not leave one lonely word on
  // line two while line one is packed. Move the last word of line one down
  // when it still fits — reading order is preserved.
  if (lines.length === 2 && lines[1].words.length === 1 && lines[0].words.length >= 3) {
    const moved = lines[0].words[lines[0].words.length - 1];
    const firstW = lines[0].width - spaceW - moved.width;
    const secondW = lines[1].width + spaceW + moved.width;
    if (firstW > 0 && secondW <= maxW) {
      lines[0].words.pop();
      lines[0].width = firstW;
      lines[1].words.unshift(moved);
      lines[1].width = secondW;
    }
  }
  return lines;
}

export function layoutCaption(
  ctx: Ctx2D, text: string, style: TextStyle, W: number, H: number,
  localT: number, words?: CaptionWord[]
): CaptionLayout {
  let fontSize = Math.max(8, style.fontSize * H);
  const maxW = style.maxWidth * W;

  let source: { w: string; keyword?: boolean; start?: number; end?: number }[];
  if (style.preset === 'word-pop' && words?.length) {
    const active = words.find((w) => localT >= w.start && localT < w.end) ?? (localT < words[0].start ? words[0] : words[words.length - 1]);
    const idx = words.indexOf(active);
    const chunk = words.slice(Math.max(0, idx - (active.w.length <= 2 ? 1 : 0)), idx + 1);
    source = chunk.map((w) => ({ w: w.w, keyword: w.keyword, start: w.start, end: w.end }));
  } else {
    source = (words?.length ? words.map((w) => ({ w: w.w, keyword: w.keyword, start: w.start, end: w.end })) : text.split(/\s+/).filter(Boolean).map((w) => ({ w })));
  }
  if (style.uppercase) source = source.map((s) => ({ ...s, w: s.w.toUpperCase() }));

  // Fit guarantee: if the wrapped text would lose words to maxLines, shrink
  // the font (up to ~35%) until every word fits. Dropped caption words are
  // worse than slightly smaller text — especially on 9:16.
  let lines: LayoutLine[] = [];
  let lineHeight = fontSize * 1.22;
  let spaceW = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = fontString(style, fontSize);
    spaceW = ctx.measureText(' ').width;
    lineHeight = fontSize * 1.22;
    lines = wrapWords(source, maxW, style.maxLines, (s) => ctx.measureText(s).width, spaceW);
    const laidOut = lines.reduce((n, l) => n + l.words.length, 0);
    if (laidOut >= source.length || attempt === 4) break;
    fontSize = Math.max(8, fontSize * 0.9);
  }

  for (const line of lines) {
    for (const lw of line.words) {
      if (lw.start != null && lw.end != null) {
        lw.active = localT >= lw.start && localT < lw.end;
        lw.sung = localT >= lw.start;
      }
    }
  }
  const blockW = Math.max(0, ...lines.map((l) => l.width));
  return { lines, fontSize, lineHeight, blockW, blockH: lines.length * lineHeight };
}

export function drawCaption(
  ctx: Ctx2D, layout: CaptionLayout, style: TextStyle, W: number, H: number,
  localT: number, duration: number
) {
  const { lines, fontSize, lineHeight, blockW, blockH } = layout;
  if (!lines.length) return;
  let alpha = 1;
  let scale = 1;
  let dy = 0;
  const anim = style.animation;
  if (anim === 'fade') alpha = Math.min(1, localT / 0.15, (duration - localT) / 0.15);
  if (anim === 'pop') { scale = 0.6 + 0.4 * ease('easeOutBack', localT / 0.22); alpha = Math.min(1, localT / 0.08); }
  if (anim === 'rise') { dy = (1 - ease('easeOutExpo', localT / 0.3)) * fontSize * 0.8; alpha = Math.min(1, localT / 0.12); }
  alpha = Math.max(0, Math.min(1, alpha));
  if (alpha <= 0.01) return;

  const cx = style.x * W;
  const cy = style.y * H + dy;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.font = fontString(style, fontSize);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (style.bgColor && style.bgColor !== 'transparent') {
    const pad = fontSize * style.bgPadding;
    const bw = blockW + pad * 2, bh = blockH + pad * 1.2;
    ctx.fillStyle = style.bgColor;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, fontSize * 0.22);
    ctx.fill();
  }

  const spaceW = ctx.measureText(' ').width;
  let y = -blockH / 2 + lineHeight / 2;
  for (const line of lines) {
    let x = style.align === 'left' ? -blockW / 2 : style.align === 'right' ? blockW / 2 - line.width : -line.width / 2;
    for (const lw of line.words) {
      let color = style.color;
      let wScale = 1;
      if (style.preset === 'karaoke' && lw.sung) color = style.highlightColor;
      if (style.preset === 'karaoke' && lw.active) wScale = 1.06;
      if (style.preset === 'bold-keywords' && lw.keyword) { color = style.highlightColor; wScale = 1.04; }
      if (style.preset === 'word-pop' && lw.active) { color = style.highlightColor; wScale = 1.0 + 0.08 * (1 - ease('easeOutExpo', Math.min(1, (localT - (lw.start ?? 0)) / 0.18))); }
      ctx.save();
      ctx.translate(x + lw.width / 2, y);
      ctx.scale(wScale, wScale);
      if (style.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = fontSize * 0.12; ctx.shadowOffsetY = fontSize * 0.04; }
      if (style.outlineWidth > 0) {
        ctx.strokeStyle = style.outlineColor;
        ctx.lineWidth = fontSize * style.outlineWidth * 2;
        ctx.strokeText(lw.w, -lw.width / 2, 0);
      }
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = color;
      ctx.fillText(lw.w, -lw.width / 2, 0);
      ctx.restore();
      x += lw.width + spaceW;
    }
    y += lineHeight;
  }
  ctx.restore();
}

export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Split a transcript into caption cues: max chars/line, max 2 lines, natural breaks. */
export interface CueBuildOptions {
  /** Split any cue longer than this many seconds. Default 7. */
  maxCueSec?: number;
  /** Reading-speed ceiling in characters per second. Default 17. */
  targetCps?: number;
  /** Break after sentence-ending punctuation. Default true. */
  sentenceBreak?: boolean;
  /** Drop hesitation sounds (um, uh, hmm…). Default false. */
  removeFillers?: boolean;
}

const HESITATIONS = new Set(['uh', 'uhh', 'uhm', 'um', 'umm', 'erm', 'er', 'ah', 'ahh', 'eh', 'hmm', 'hm', 'mm', 'mhm', 'uhhuh']);

const isHesitation = (w: string) => HESITATIONS.has(w.toLowerCase().replace(/[^a-z]/g, ''));

export function buildCues(
  words: { word: string; start: number; end: number }[],
  maxCharsPerLine: number,
  maxLines = 2,
  maxGapSec = 0.7,
  opts: CueBuildOptions = {}
): { text: string; start: number; end: number; words: CaptionWord[] }[] {
  const maxCueSec = opts.maxCueSec ?? 7;
  const targetCps = opts.targetCps ?? 17;
  const sentenceBreak = opts.sentenceBreak !== false;
  const cues: { text: string; start: number; end: number; words: CaptionWord[] }[] = [];
  let cur: CaptionWord[] = [];
  let lines = 1, lineChars = 0;
  const cueChars = () => cur.reduce((n, w) => n + w.w.length, 0) + Math.max(0, cur.length - 1);
  const flush = () => {
    if (!cur.length) return;
    cues.push({
      text: cur.map((w) => w.w).join(' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur,
    });
    cur = []; lines = 1; lineChars = 0;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const clean = w.word.trim();
    if (!clean) continue;
    if (opts.removeFillers && isHesitation(clean) && !/[.!?]$/.test(clean)) continue;
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0;
    const prev = cur.length ? cur[cur.length - 1].w : '';
    const endsSentence = sentenceBreak && /[.!?]$/.test(prev);
    const span = cur.length ? w.end - cur[0].start : 0;
    const chars = cueChars() + (cur.length ? 1 : 0) + clean.length;
    const cps = span > 0 ? chars / span : 0;
    if (cur.length && (
      gap > maxGapSec ||
      (endsSentence && lineChars > maxCharsPerLine * 0.4) ||
      span > maxCueSec ||
      (cur.length >= 3 && cps > targetCps)
    )) flush();
    if (lineChars + clean.length + 1 > maxCharsPerLine) {
      if (lines >= maxLines) flush();
      else { lines++; lineChars = 0; }
    }
    cur.push({ w: clean, start: w.start, end: w.end });
    lineChars += clean.length + 1;
  }
  flush();
  // pad cue timing slightly for readability
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    c.start = Math.max(0, c.start - 0.04);
    const nextStart = i + 1 < cues.length ? cues[i + 1].start : Infinity;
    c.end = Math.min(c.end + 0.12, nextStart - 0.02);
    if (c.end <= c.start) c.end = c.start + 0.1;
    c.words = c.words.map((w) => ({ ...w, start: w.start - c.start, end: w.end - c.start }));
  }
  return cues;
}

/** Characters per second for a cue — the readability number editors care about. */
export function cueCps(text: string, start: number, end: number): number {
  const chars = text.replace(/\s+/g, ' ').trim().length;
  return end > start ? chars / (end - start) : 0;
}

export interface ParsedCue { start: number; end: number; text: string }

const parseTimestamp = (raw: string): number | null => {
  const m = raw.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss) + Number(ms.padEnd(3, '0')) / 1000;
};

const decodeEntities = (s: string) => s
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

/** Parse SRT or WebVTT text into cues. Styling tags are stripped. */
export function parseSRT(input: string): ParsedCue[] {
  const text = String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: ParsedCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const arrow = lines.findIndex((l) => l.includes('-->'));
    if (arrow < 0) continue;
    const [rawStart, rawEnd] = lines[arrow].split('-->');
    const start = parseTimestamp(rawStart ?? '');
    const end = parseTimestamp((rawEnd ?? '').trim().split(/\s+/)[0] ?? '');
    if (start == null || end == null || end <= start) continue;
    const body = lines.slice(arrow + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]+\}/g, '')
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: decodeEntities(body) });
  }
  return cues.sort((a, b) => a.start - b.start);
}

const KEYWORD_SET = new Set(['free', 'new', 'secret', 'best', 'never', 'always', 'stop', 'wait', 'how', 'why', 'what', 'money', 'easy', 'fast', 'proven', 'warning', 'hack', 'mistake', 'truth', 'love', 'win', 'lose', 'big', 'huge', 'crazy', 'insane', 'important', 'remember', 'tip', 'tips', 'step', 'steps', 'result', 'results', 'guarantee', 'today', 'now', 'you', 'your']);

export function markKeywords(words: CaptionWord[]): CaptionWord[] {
  return words.map((w) => ({ ...w, keyword: KEYWORD_SET.has(w.w.toLowerCase().replace(/[^a-z']/g, '')) || /^\d/.test(w.w) }));
}