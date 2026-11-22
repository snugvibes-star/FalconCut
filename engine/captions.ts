/**
 * Caption layout + drawing. Deterministic given the same fonts.
 * Handles: clean subtitles, karaoke word highlight, bold keywords, word-pop.
 * Max 2 lines, safe-zone aware, outline + shadow for mobile readability.
 */
import type { CaptionWord, TextStyle, WordStyle } from './types';
import { ease } from './easing';

export interface LayoutWord {
  w: string; width: number; keyword: boolean; filler: boolean; active: boolean; sung: boolean;
  start?: number; end?: number; style?: WordStyle; index: number;
}
export interface LayoutLine { words: LayoutWord[]; width: number }
export interface CaptionLayout { lines: LayoutLine[]; fontSize: number; lineHeight: number; blockW: number; blockH: number }

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function hexRgb(hex: string): [number, number, number] | null {
  if (!hex.startsWith('#')) return null;
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixColor(a: string, b: string, t: number): string {
  const ca = hexRgb(a), cb = hexRgb(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Support `linear-gradient(#a,#b)` as a text color in the shared renderer. */
function canvasFill(ctx: Ctx2D, color: string, x: number, width: number): string | CanvasGradient {
  if (typeof ctx.createLinearGradient !== 'function') return color;
  const m = /^linear-gradient\((.+)\)$/.exec(color);
  if (!m) return color;
  const stops = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (stops.length < 2) return color;
  const g = ctx.createLinearGradient(x, 0, x + Math.max(1, width), 0);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}

export function fontString(style: TextStyle, fontSize: number): string {
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${fontSize}px "${style.fontFamily}", "Inter Variable", system-ui, sans-serif`;
}

export function wrapWords(words: { w: string; keyword?: boolean; filler?: boolean; start?: number; end?: number; style?: WordStyle }[], maxW: number, maxLines: number, measure: (s: string) => number, spaceW: number): LayoutLine[] {
  const lines: LayoutLine[] = [];
  let cur: LayoutWord[] = [];
  let curW = 0;
  let index = 0;
  for (const word of words) {
    const width = measure(word.w);
    const gap = spaceW;
    const add = cur.length ? gap + width : width;
    if (cur.length && curW + add > maxW) {
      lines.push({ words: cur, width: curW });
      cur = []; curW = 0;
      if (lines.length >= maxLines) break;
    }
    cur.push({ w: word.w, width, keyword: !!word.keyword, filler: !!word.filler, active: false, sung: false, start: word.start, end: word.end, style: word.style, index: index++ });
    curW += cur.length > 1 ? gap + width : width;
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

  let source: { w: string; keyword?: boolean; start?: number; end?: number; style?: WordStyle }[];
  if (style.preset === 'word-pop' && words?.length && !style.revealWords) {
    const active = words.find((w) => localT >= w.start && localT < w.end) ?? (localT < words[0].start ? words[0] : words[words.length - 1]);
    const idx = words.indexOf(active);
    const chunk = words.slice(Math.max(0, idx - (active.w.length <= 2 ? 1 : 0)), idx + 1);
    source = chunk.map((w) => ({ w: w.w, keyword: w.keyword, start: w.start, end: w.end, style: w.style }));
  } else {
    source = (words?.length ? words.map((w) => ({ w: w.w, keyword: w.keyword, start: w.start, end: w.end, style: w.style })) : text.split(/\s+/).filter(Boolean).map((w) => ({ w })));
  }
  if (style.caseMode === 'upper' || (style.caseMode == null && style.uppercase)) source = source.map((s) => ({ ...s, w: s.w.toUpperCase() }));
  if (style.caseMode === 'lower') source = source.map((s) => ({ ...s, w: s.w.toLowerCase() }));

  // Fit guarantee: if the wrapped text would lose words to maxLines, shrink
  // the font (up to ~35%) until every word fits. Dropped caption words are
  // worse than slightly smaller text — especially on 9:16.
  let lines: LayoutLine[] = [];
  let lineHeight = fontSize * (style.lineSpacing || 1.22);
  let spaceW = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = fontString(style, fontSize);
    spaceW = ctx.measureText(' ').width * (style.wordSpacing || 1);
    lineHeight = fontSize * (style.lineSpacing || 1.22);
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
  let dx = 0;
  const anim = style.animation;
  if (anim === 'fade' || anim === 'fade-in') alpha = Math.min(1, localT / 0.15);
  if (anim === 'fade-out') alpha = Math.min(1, (duration - localT) / 0.15);
  if (anim === 'pop') { scale = 0.6 + 0.4 * ease('easeOutBack', localT / 0.22); alpha = Math.min(1, localT / 0.08); }
  if (anim === 'rise' || anim === 'slide') { dy = (1 - ease('easeOutExpo', localT / 0.3)) * fontSize * 0.8; alpha = Math.min(1, localT / 0.12); }
  if (anim === 'zoom') { scale = 0.5 + 0.5 * ease('easeOutExpo', localT / 0.3); alpha = Math.min(1, localT / 0.1); }
  if (anim === 'bounce') { scale = 0.4 + 0.6 * ease('easeOutBack', localT / 0.4); alpha = Math.min(1, localT / 0.06); }
  if (anim === 'blur') { alpha = Math.min(1, localT / 0.25); }
  if (anim === 'glitch') { dx = Math.sin(localT * 90) * fontSize * 0.06 * (1 - clamp01(localT / 0.4)); alpha = Math.min(1, localT / 0.05); }
  if (anim === 'wave') { dy = Math.sin(localT * 6) * fontSize * 0.05; }
  if (anim === 'shake') { dx = Math.sin(localT * 70) * fontSize * 0.03; dy = Math.cos(localT * 60) * fontSize * 0.02; }
  if (anim === 'pulse') { scale = 1 + Math.sin(localT * 4) * 0.03; }
  if (anim === 'typewriter') alpha = 1;
  alpha = clamp01(alpha) * (style.textOpacity ?? 1);
  if (alpha <= 0.01) return;

  const cx = style.x * W + dx;
  const cy = style.y * H + dy;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  if (style.bgColor && style.bgColor !== 'transparent') {
    const pad = fontSize * style.bgPadding;
    const bw = blockW + pad * 2, bh = blockH + pad * 1.2;
    ctx.save();
    if ((style.backgroundBlur ?? 0) > 0.001 && 'filter' in ctx) {
      try { (ctx as CanvasRenderingContext2D).filter = `blur(${(fontSize * style.backgroundBlur! * 0.6).toFixed(2)}px)`; } catch { /* filter unavailable */ }
    }
    ctx.fillStyle = style.bgColor;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, fontSize * 0.22);
    ctx.fill();
    ctx.restore();
  }

  const spaceW = ctx.measureText(' ').width * (style.wordSpacing || 1);
  // Place every word once so the highlight can interpolate between positions.
  const placed: { lw: LayoutWord; x: number; y: number }[] = [];
  let y = -blockH / 2 + lineHeight / 2;
  for (const line of lines) {
    let x = style.align === 'left' ? -blockW / 2 : style.align === 'right' ? blockW / 2 - line.width : -line.width / 2;
    for (const lw of line.words) {
      placed.push({ lw, x, y });
      x += lw.width + spaceW;
    }
    y += lineHeight;
  }

  const hl = style.highlight ?? {
    enabled: false, anim: 'instant' as const, bgColor: '#000000', textColor: '#FFFFFF',
    padding: 0.18, radius: 0.12, opacity: 0.9, speed: 0.12, glow: 0, shadow: 0,
  };
  // Hold the highlight on the last spoken word in the natural gaps between
  // words. Without this, the highlight blinks off on every micro-pause.
  const highlightT = localT + (hl.offset ?? 0);
  let activeIdx = placed.findIndex((p) => p.lw.start != null && highlightT >= p.lw.start && highlightT < (p.lw.end ?? 0));
  if (activeIdx < 0 && style.revealWords) {
    for (let i = placed.length - 1; i >= 0; i--) {
      const wStart = placed[i].lw.start;
      if (wStart != null && highlightT >= wStart) { activeIdx = i; break; }
    }
  }
  const activeWordIndex = activeIdx >= 0 ? placed[activeIdx].lw.index : -1;
  const prevIdx = activeIdx > 0 ? activeIdx - 1 : -1;
  const speed = Math.max(0.01, hl.speed || 0.12);
  const progress = activeIdx >= 0 ? clamp01((highlightT - (placed[activeIdx].lw.start ?? 0)) / speed) : 1;
  const eased = ease('easeOutExpo', progress);

  const rectFor = (idx: number) => {
    const p = placed[idx];
    const pad = fontSize * hl.padding;
    return { x: p.x - pad, y: p.y - fontSize * 0.62 - pad * 0.35, w: p.lw.width + pad * 2, h: fontSize * 1.24 + pad * 0.7 };
  };

  if (hl.enabled && activeIdx >= 0) {
    ctx.save();
    const target = rectFor(activeIdx);
    let r = { ...target };
    let hAlpha = hl.opacity;
    if (hl.anim === 'slide' || hl.anim === 'wipe') {
      const from = prevIdx >= 0 ? rectFor(prevIdx) : target;
      r = {
        x: lerp(from.x, target.x, eased),
        y: lerp(from.y, target.y, eased),
        w: hl.anim === 'wipe' ? lerp(from.w, target.w, eased) : lerp(from.w, target.w, eased),
        h: lerp(from.h, target.h, eased),
      };
      if (hl.anim === 'wipe') r.w = Math.max(1, target.w * eased);
    } else if (hl.anim === 'pop' || hl.anim === 'scale') {
      const k = hl.anim === 'pop' ? 0.6 + 0.4 * ease('easeOutBack', progress) : 0.85 + 0.15 * eased;
      r = { x: target.x + target.w * (1 - k) / 2, y: target.y + target.h * (1 - k) / 2, w: target.w * k, h: target.h * k };
    } else if (hl.anim === 'fade') {
      hAlpha *= progress;
    } else if (hl.anim === 'bar') {
      const p = placed[activeIdx];
      r = { x: p.x, y: p.y + fontSize * 0.55, w: p.lw.width * Math.max(0.05, eased), h: Math.max(2, fontSize * 0.1) };
    } else if (hl.anim === 'glitch') {
      const jitter = Math.sin(localT * 90) * fontSize * 0.09;
      r = { x: target.x + jitter, y: target.y, w: target.w, h: target.h };
    }
    if (hl.glow > 0) { ctx.shadowColor = hl.bgColor; ctx.shadowBlur = fontSize * hl.glow; }
    else if (hl.shadow > 0) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = fontSize * hl.shadow; ctx.shadowOffsetY = fontSize * 0.04; }
    ctx.fillStyle = hl.bgColor;
    ctx.globalAlpha *= hAlpha;
    roundRect(ctx, r.x, r.y, r.w, r.h, fontSize * hl.radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.restore();
  }

  for (const { lw, x, y } of placed) {
    if (style.revealWords && lw.start != null && localT < lw.start) continue;
    const isActive = lw.index === activeWordIndex;
    const isPrev = prevIdx >= 0 && placed[prevIdx].lw.index === lw.index;
    let color = style.color;
    if (style.preset === 'karaoke' && lw.sung) color = style.highlightColor;
    if (style.preset === 'bold-keywords' && lw.keyword) color = style.highlightColor;
    if (hl.enabled && isActive) color = hl.anim === 'color' ? mixColor(style.color, hl.textColor || style.highlightColor, eased) : (hl.textColor || style.highlightColor);
    if (hl.prevColor && isPrev) color = hl.prevColor;
    if (hl.nextColor && !isActive && !isPrev && lw.start != null && localT < lw.start) color = hl.nextColor;
    let wScale = 1;
    if (style.preset === 'karaoke' && lw.active) wScale = 1.06;
    if (style.preset === 'bold-keywords' && lw.keyword) wScale = 1.04;
    if (style.preset === 'word-pop' && lw.active) wScale = 1.0 + 0.08 * (1 - ease('easeOutExpo', Math.min(1, (localT - (lw.start ?? 0)) / 0.18)));
    if (hl.enabled && isActive && (hl.anim === 'pop' || hl.anim === 'scale')) wScale *= 0.85 + 0.15 * eased;
    const ws = lw.style;
    const fs = fontSize * (ws?.fontSize ?? 1);
    const weight = ws?.fontWeight ?? style.fontWeight;
    ctx.font = fontString({ ...style, fontFamily: ws?.fontFamily ?? style.fontFamily, fontWeight: weight, fontStyle: ws?.fontStyle === 'italic' ? 'italic' : style.fontStyle }, fs);
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D).letterSpacing = `${ws?.letterSpacing ?? style.letterSpacing ?? 0}em`;
    ctx.save();
    ctx.translate(x + lw.width / 2, y);
    ctx.scale(wScale, wScale);
    const revealAlpha = style.revealWords && lw.start != null ? clamp01((localT - lw.start) / Math.min(0.18, speed)) : 1;
    ctx.globalAlpha *= clamp01(ws?.opacity ?? 1) * revealAlpha;
    if (ws?.shadow ?? style.shadow) {
      ctx.shadowColor = ws?.outlineColor ?? 'rgba(0,0,0,0.75)';
      ctx.shadowBlur = fs * 0.12;
      ctx.shadowOffsetY = fs * 0.04;
    }
    if (style.glow?.enabled) {
      ctx.shadowColor = style.glow.color;
      ctx.shadowBlur = Math.max(0, fs * style.glow.radius * Math.max(0, style.glow.intensity) * 2);
      ctx.shadowOffsetY = 0;
    }
    // Keep outlines subtle. Older projects can carry very heavy stroke values;
    // clamp them so reopened captions stay legible instead of looking boxed in.
    const hlOpaque = hl.enabled && !!hl.bgColor && hl.bgColor !== 'transparent'
      && !/rgba\([^)]*,\s*0\s*\)/.test(hl.bgColor);
    const ow = isActive && hlOpaque ? 0 : Math.min(0.06, Math.max(0, ws?.outlineWidth ?? style.outlineWidth ?? 0));
    let visible = lw.w;
    if (anim === 'typewriter') {
      const wStart = lw.start ?? 0;
      const span = Math.max(0.1, (lw.end ?? duration) - wStart);
      const p = clamp01((localT - wStart) / span);
      visible = lw.w.slice(0, Math.ceil(lw.w.length * p));
    }
    if (!visible) { ctx.restore(); continue; }
    if (style.blur?.enabled && 'filter' in ctx) {
      const amount = Math.max(0, style.blur.amount * (1 - clamp01(style.sharpness ?? 1)) + style.blur.amount * 0.25);
      try {
        ctx.save();
        (ctx as CanvasRenderingContext2D).filter = `blur(${Math.max(0.4, fs * amount).toFixed(2)}px)`;
        ctx.globalAlpha *= 0.5;
        ctx.fillStyle = canvasFill(ctx, color, -lw.width / 2, lw.width);
        ctx.fillText(visible, -lw.width / 2, 0);
        ctx.restore();
      } catch { /* filter unsupported — the sharp text below still renders */ }
    }
    if (ow > 0.002) {
      ctx.strokeStyle = ws?.outlineColor ?? style.outlineColor;
      ctx.lineWidth = fs * ow * 2;
      ctx.strokeText(visible, -lw.width / 2, 0);
    }
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = canvasFill(ctx, color, -lw.width / 2, lw.width);
    ctx.fillText(visible, -lw.width / 2, 0);
    ctx.restore();
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
  words: { word: string; start: number; end: number; estimated?: boolean }[],
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
    cur.push({ w: clean, start: w.start, end: w.end, timingEstimated: w.estimated });
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