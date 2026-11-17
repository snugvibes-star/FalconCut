/** Plain-text subtitle interchange. No DOM, file I/O, model calls or style execution.
 * Cue times are timeline seconds; optional word times are ALWAYS cue-local seconds.
 * Parsers/serializers are atomic: errors mean no cues/output, never a partial import.
 */
import type { Action } from './actions';
import { defaultTextStyle, type CaptionStyleId, type CaptionWord, type Clip, type Project } from './types';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';
export interface SubtitleCue { start: number; end: number; text: string; words?: CaptionWord[] }
export interface SubtitleIssue { line?: number; message: string }
export interface SubtitleParseResult {
  format: SubtitleFormat | null;
  cues: SubtitleCue[];
  errors: SubtitleIssue[];
  warnings: string[];
}
export interface SubtitleSerializeResult { text: string; errors: SubtitleIssue[]; warnings: string[] }
export const ASS_PLAIN_TEXT_LIMITATION = 'ASS is plain text only: styles, fonts, positioning, effects and karaoke overrides are not preserved. Drawing events are unsupported.';
export const SUBTITLE_MIN_CLIP_DURATION = 0.04;
export const CAPTION_PRESETS: ReadonlyArray<{ id: CaptionStyleId; label: string }> = [
  { id: 'clean', label: 'Clean' }, { id: 'word-pop', label: 'TikTok' },
  { id: 'bold-keywords', label: 'Bold / Hormozi' }, { id: 'karaoke', label: 'Karaoke' },
];

const normalized = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const plain = (text: string) => normalized(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
const validFormat = (value: string): value is SubtitleFormat => ['srt', 'vtt', 'ass'].includes(value);
const issue = (message: string, line?: number): SubtitleIssue => ({ message, ...(line == null ? {} : { line }) });
const unique = (values: string[]) => [...new Set(values)];

/** Strict timestamp parsing. SRT also accepts the common dot-millisecond variant. */
export function parseSubtitleTime(value: string, format: SubtitleFormat = 'vtt'): number | null {
  if (!validFormat(format)) return null;
  const text = value.trim();
  let h = 0, m = 0, s = 0, fraction = 0;
  if (format === 'ass') {
    const match = /^(\d+):(\d{2}):(\d{2})\.(\d{2})$/.exec(text);
    if (!match) return null;
    h = Number(match[1]); m = Number(match[2]); s = Number(match[3]); fraction = Number(match[4]) / 100;
  } else {
    const match = (format === 'srt'
      ? /^(\d{2,}):(\d{2}):(\d{2})[,.](\d{3})$/
      : /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/).exec(text);
    if (!match) return null;
    h = Number(match[1] ?? 0); m = Number(match[2]); s = Number(match[3]); fraction = Number(match[4]) / 1000;
  }
  const result = h * 3600 + m * 60 + s + fraction;
  return m < 60 && s < 60 && Number.isSafeInteger(Math.round(result * 1000)) ? result : null;
}

/** Rounds BEFORE decomposing, so millisecond/centisecond carry is correct. */
export function formatSubtitleTime(time: number, format: SubtitleFormat = 'srt'): string {
  if (!validFormat(format) || !Number.isFinite(time) || time < 0 || !Number.isSafeInteger(Math.round(time * 1000))) {
    throw new Error('Subtitle time must be finite, nonnegative and safely representable.');
  }
  const rate = format === 'ass' ? 100 : 1000;
  const ticks = Math.round(time * rate);
  const hours = String(Math.floor(ticks / (3600 * rate))).padStart(format === 'ass' ? 1 : 2, '0');
  const minutes = String(Math.floor(ticks / (60 * rate)) % 60).padStart(2, '0');
  const seconds = String(Math.floor(ticks / rate) % 60).padStart(2, '0');
  const fraction = String(ticks % rate).padStart(format === 'ass' ? 2 : 3, '0');
  return `${hours}:${minutes}:${seconds}${format === 'srt' ? ',' : '.'}${fraction}`;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '\u200e', rlm: '\u200f' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi, (whole, name: string) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? whole;
    const hex = name[1]?.toLowerCase() === 'x';
    const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
  });
}

/** Subtitle markup -> inert text. Consumers must render it as text, never innerHTML. */
export function sanitizeSubtitleText(text: string, format: SubtitleFormat = 'srt'): string {
  let output = normalized(text);
  if (format === 'ass') output = output.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  // Discard script/style contents as well as their tags. Nothing is evaluated.
  output = output.replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<!--([\s\S]*?)(?:-->|$)/g, '').replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '').replace(/<\d{2,}:\d{2}(?::\d{2})?\.\d{3}>/g, '');
  return plain(decodeEntities(output));
}

function detectFormat(text: string): SubtitleFormat | null {
  if (/^WEBVTT(?:[ \t]|\n|$)/.test(text)) return 'vtt';
  if (/^\s*\[(?:Script Info|Events|V4\+? Styles)\]\s*$/im.test(text)) return 'ass';
  if (/^\s*\d{2,}:\d{2}:\d{2}[,.]\d{3}\s+-->/m.test(text)) return 'srt';
  return null;
}

/** A hint can be a format, extension, or filename. An unsupported hint is an error. */
export function parseSubtitles(source: string, formatHint?: string): SubtitleParseResult {
  const text = normalized(source);
  const hint = formatHint?.toLowerCase().split('.').pop();
  const format = hint ? (validFormat(hint) ? hint : null) : detectFormat(text);
  const result: SubtitleParseResult = { format, cues: [], errors: [], warnings: [] };
  if (!format) {
    result.errors.push(issue('Unsupported or unrecognized subtitle format. Use SRT, WebVTT or ASS.'));
    return result;
  }
  if (!text.trim()) { result.errors.push(issue('The subtitle file is empty.')); return result; }
  if (format === 'ass') parseASS(text, result); else parseTimedText(text, format, result);
  if (!result.cues.length && !result.errors.length) result.errors.push(issue('No subtitle cues found.'));
  result.warnings = unique(result.warnings);
  if (result.errors.length) result.cues = [];
  return result;
}

function appendCue(result: SubtitleParseResult, start: number | null, end: number | null, raw: string, line: number) {
  if (start == null || end == null) { result.errors.push(issue('Invalid subtitle timestamp.', line)); return; }
  if (end <= start) { result.errors.push(issue('Cue end must be later than its start.', line)); return; }
  const text = sanitizeSubtitleText(raw, result.format!);
  if (!text) { result.errors.push(issue('Cue has no plain text after removing markup.', line)); return; }
  result.cues.push({ start, end, text });
}

function parseTimedText(text: string, format: 'srt' | 'vtt', result: SubtitleParseResult) {
  const lines = text.split('\n');
  let i = 0;
  if (format === 'vtt') {
    if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0]) || lines[0].includes('-->')) {
      result.errors.push(issue('WebVTT must begin with a WEBVTT header.', 1)); return;
    }
    i = 1;
    while (i < lines.length && lines[i].trim()) {
      if (lines[i].includes('-->')) { result.errors.push(issue('Separate the WebVTT header and first cue with a blank line.', i + 1)); return; }
      if (/X-TIMESTAMP-MAP/i.test(lines[i])) result.errors.push(issue('WebVTT X-TIMESTAMP-MAP offsets are unsupported; use standalone cue times.', i + 1));
      else result.warnings.push('WebVTT header metadata is not preserved.');
      i++;
    }
  }
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const first = i;
    const block: string[] = [];
    while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
    if (format === 'vtt' && /^(NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(block[0].trim())) {
      if (!block[0].startsWith('NOTE')) result.warnings.push('WebVTT styles and regions are ignored; only plain text and cue times are imported.');
      continue;
    }
    let timeIndex = 0;
    if (!block[0].includes('-->')) {
      if (format === 'srt' && !/^\d+$/.test(block[0].trim())) {
        result.errors.push(issue('Expected an SRT cue number or timing line.', first + 1)); continue;
      }
      timeIndex = 1; // optional SRT index / WebVTT cue identifier
    }
    const timing = /^(\S+)\s+-->\s+(\S+)(?:[ \t]+(.*))?$/.exec((block[timeIndex] ?? '').trim());
    if (!timing) { result.errors.push(issue('Malformed cue timing line (expected start --> end).', first + timeIndex + 1)); continue; }
    if (timing[3]) {
      if (format === 'srt' && !/^(?:[XY][12]:\d+\s*)+$/.test(timing[3])) {
        result.errors.push(issue('Unsupported SRT timing suffix.', first + timeIndex + 1)); continue;
      }
      if (format === 'vtt' && !timing[3].split(/\s+/).every((s) => /^(?:vertical|line|position|size|align|region):\S+$/.test(s))) {
        result.errors.push(issue('Malformed or unsupported WebVTT cue setting.', first + timeIndex + 1)); continue;
      }
      result.warnings.push('Cue positioning/settings are not preserved.');
    }
    const body = block.slice(timeIndex + 1).join('\n');
    if (body.includes('-->')) { result.errors.push(issue('Unexpected timing arrow in cue text; separate cues with a blank line.', first + timeIndex + 2)); continue; }
    if (/<[^>]+>/.test(body)) result.warnings.push('Text markup and inline word timestamps are stripped; word timings are not inferred.');
    appendCue(result, parseSubtitleTime(timing[1], format), parseSubtitleTime(timing[2], format), body, first + timeIndex + 1);
  }
}

function parseASS(text: string, result: SubtitleParseResult) {
  result.warnings.push(ASS_PLAIN_TEXT_LIMITATION);
  let section = '';
  let fields: string[] | null = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { section = header[1].toLowerCase(); fields = null; continue; }
    if (section !== 'events' || !line || line.startsWith(';')) continue;
    if (/^Format\s*:/i.test(line)) {
      const names = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      fields = names;
      if (new Set(names).size !== names.length || names.some((f) => !f) || !['start', 'end', 'text'].every((name) => names.includes(name))) {
        result.errors.push(issue('ASS Events Format must contain unique Start, End and Text columns.', i + 1)); fields = null;
      }
      continue;
    }
    if (/^Comment\s*:/i.test(line)) continue;
    if (!/^Dialogue\s*:/i.test(line)) { result.errors.push(issue('Unsupported or malformed ASS event; expected Dialogue.', i + 1)); continue; }
    if (!fields) { result.errors.push(issue('ASS Dialogue requires an Events Format declaration first.', i + 1)); continue; }
    const parts = line.slice(line.indexOf(':') + 1).split(',');
    if (parts.length < fields.length) { result.errors.push(issue('ASS Dialogue has fewer columns than Events Format.', i + 1)); continue; }
    const textIndex = fields.indexOf('text');
    // Text can contain commas; consume declared columns from both ends.
    const trailing = fields.length - textIndex - 1;
    const values = [...parts.slice(0, textIndex), parts.slice(textIndex, parts.length - trailing).join(','), ...(trailing ? parts.slice(-trailing) : [])];
    const body = values[textIndex];
    if (/\{[^}]*\\p\s*[1-9]\d*/i.test(body)) { result.errors.push(issue('ASS vector drawing events are unsupported; export a plain-text subtitle file.', i + 1)); continue; }
    if (/\{[^}]*$/.test(body) || /^[^{]*\}/.test(body)) { result.errors.push(issue('Unbalanced ASS override braces.', i + 1)); continue; }
    appendCue(result, parseSubtitleTime(values[fields.indexOf('start')], 'ass'), parseSubtitleTime(values[fields.indexOf('end')], 'ass'), body, i + 1);
  }
}

export function validateCaptionWords(words: readonly CaptionWord[], duration: number): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(duration) || duration <= 0) return ['Cue duration must be positive and finite.'];
  words.forEach((word, index) => {
    if (!word.w.trim()) errors.push(`Word ${index + 1} needs text.`);
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || word.end > duration + 1e-9) {
      errors.push(`Word ${index + 1} must satisfy 0 ≤ start < end ≤ ${duration.toFixed(3)} seconds (clip-local).`);
    }
    if (index > 0 && word.start < words[index - 1].end - 1e-9) errors.push(`Word ${index + 1} overlaps or precedes the previous word.`);
  });
  return errors;
}

export function validateSubtitleCues(cues: readonly SubtitleCue[], minimumDuration = 0): string[] {
  const errors: string[] = [];
  if (!cues.length) return ['No subtitle cues supplied.'];
  cues.forEach((cue, index) => {
    const duration = cue.end - cue.start;
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || duration <= 0 || !Number.isSafeInteger(Math.round(cue.end * 1000))) {
      errors.push(`Cue ${index + 1} needs finite times with 0 ≤ start < end.`);
    } else if (duration < minimumDuration - 1e-9) errors.push(`Cue ${index + 1} is shorter than the editor minimum of ${minimumDuration} seconds.`);
    if (!plain(cue.text)) errors.push(`Cue ${index + 1} needs plain text.`);
    if (cue.words) errors.push(...validateCaptionWords(cue.words, duration).map((e) => `Cue ${index + 1}: ${e}`));
  });
  return errors;
}

/** Sidecar export is plain text, not a rendering of the caption style/word animation. */
export function serializeSubtitles(cues: readonly SubtitleCue[], format: SubtitleFormat): SubtitleSerializeResult {
  const warnings: string[] = [];
  if (!validFormat(format)) return { text: '', warnings, errors: [issue('Unsupported subtitle export format.')] };
  const errors = validateSubtitleCues(cues).map((message) => issue(message));
  if (format === 'ass') warnings.push(ASS_PLAIN_TEXT_LIMITATION, 'ASS timestamps are rounded to centiseconds.');
  if (cues.some((cue) => cue.words?.length)) warnings.push('Word timing and keyword flags are not included in sidecar exports.');
  const blocks: string[] = [];
  if (!errors.length) [...cues].sort((a, b) => a.start - b.start).forEach((cue, index) => {
    const start = formatSubtitleTime(cue.start, format), end = formatSubtitleTime(cue.end, format);
    if (start === end) { errors.push(issue(`Cue ${index + 1} collapses at ${format === 'ass' ? 'centisecond' : 'millisecond'} precision.`)); return; }
    let text = plain(cue.text);
    if (format === 'ass') {
      if (/[{}\\]/.test(text)) warnings.push('Literal braces/backslashes are replaced with fullwidth characters in ASS to prevent override execution.');
      text = text.replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\n/g, '\\N');
      blocks.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
    } else {
      if (/\n[ \t]*\n/.test(text)) { text = text.replace(/\n(?:[ \t]*\n)+/g, '\n'); warnings.push('Blank lines inside cues are collapsed for SRT/WebVTT block compatibility.'); }
      text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      blocks.push(`${index + 1}\n${start} --> ${end}\n${text}`);
    }
  });
  const header = format === 'vtt' ? 'WEBVTT\n\n' : format === 'ass'
    ? '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' : '';
  return { text: errors.length ? '' : header + blocks.join(format === 'ass' ? '\n' : '\n\n') + '\n', errors, warnings: unique(warnings) };
}

/** Explicit track selection, including hidden tracks; never mixes in titles/hooks. */
export function subtitleCuesFromProject(project: Project, trackId: string): SubtitleCue[] {
  return project.clips.filter((c) => c.trackId === trackId && c.kind === 'text' && c.text?.role === 'caption')
    .sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text!.text, ...(c.text!.words ? { words: c.text!.words.map((w) => ({ ...w })) } : {}) }));
}

export interface SubtitleImportOptions {
  /** Caller supplies a fresh uid. Keeping ID allocation outside makes this helper pure. */
  trackId: string;
  trackName: string;
  offset?: number;
  preset?: CaptionStyleId;
  y?: number;
}

/** Commit the returned add_track + add_text array ONCE. Throws before any mutation. */
export function buildSubtitleImportActions(project: Project, cues: readonly SubtitleCue[], options: SubtitleImportOptions): Action[] {
  if (!options.trackId.trim() || project.tracks.some((t) => t.id === options.trackId)) throw new Error('Import requires a new, unique text track ID.');
  if (!options.trackName.trim()) throw new Error('Name the subtitle track.');
  const offset = options.offset ?? 0;
  if (!Number.isFinite(offset)) throw new Error('Import offset must be finite.');
  if (options.y != null && (!Number.isFinite(options.y) || options.y < 0 || options.y > 1)) throw new Error('Caption vertical position must be between 0 and 1.');
  if (options.preset && !CAPTION_PRESETS.some((p) => p.id === options.preset)) throw new Error('Unsupported caption preset.');
  const shifted = cues.map((c) => ({ ...c, start: c.start + offset, end: c.end + offset }));
  const errors = validateSubtitleCues(shifted, SUBTITLE_MIN_CLIP_DURATION);
  if (errors.length) throw new Error(errors.join('\n'));
  return [
    { type: 'add_track', track: { id: options.trackId, name: options.trackName.trim(), kind: 'text' } },
    ...shifted.map((cue): Action => ({ type: 'add_text', trackId: options.trackId, start: cue.start, duration: cue.end - cue.start,
      text: plain(cue.text), role: 'caption', preset: options.preset ?? 'clean',
      ...(options.y == null ? {} : { style: { y: options.y } }),
      ...(cue.words ? { words: cue.words.map((w) => ({ ...w })) } : {}),
    })),
  ];
}

/** Full typography defaults, preserving bilingual track placement. No invented word times. */
export function buildCaptionPresetActions(project: Project, clipIds: readonly string[], preset: CaptionStyleId): Action[] {
  if (!CAPTION_PRESETS.some((p) => p.id === preset)) throw new Error('Unsupported caption preset.');
  return unique([...clipIds]).map((id): Action => {
    const clip = editableCaption(project, id);
    return { type: 'set_text_style', clipId: id, patch: { ...defaultTextStyle(preset), x: clip.text!.style.x, y: clip.text!.style.y } };
  });
}

function editableCaption(project: Project, clipId: string): Clip {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip || clip.kind !== 'text' || clip.text?.role !== 'caption') throw new Error('Select an existing caption cue.');
  if (clip.locked || project.tracks.find((t) => t.id === clip.trackId)?.locked) throw new Error('Unlock the caption and its track before editing.');
  return clip;
}

/** Text changes clear stale word timing unless replacement words are supplied explicitly.
 * Moving the cue keeps word times clip-local. Shortening cannot silently truncate words.
 */
export function buildCaptionEditActions(project: Project, clipId: string, cue: SubtitleCue): Action[] {
  const clip = editableCaption(project, clipId);
  const text = plain(cue.text);
  const words = cue.words ?? (text !== clip.text!.text ? [] : clip.text!.words ?? []);
  const errors = validateSubtitleCues([{ ...cue, text, words }], SUBTITLE_MIN_CLIP_DURATION);
  if (errors.length) throw new Error(errors.join('\n'));
  const actions: Action[] = [];
  if (text !== clip.text!.text || JSON.stringify(words) !== JSON.stringify(clip.text!.words ?? [])) actions.push({ type: 'set_text', clipId, text, words: words.map((w) => ({ ...w })) });
  if (cue.start !== clip.start || Math.abs(cue.end - cue.start - clip.duration) > 1e-9) actions.push({ type: 'trim_clip', clipId, start: cue.start, duration: cue.end - cue.start });
  return actions;
}

/** Deliberate, labeled approximation only; never used automatically on file import. */
export function evenlyTimeCaptionWords(text: string, duration: number): CaptionWord[] {
  const tokens = plain(text).split(/\s+/).filter(Boolean);
  if (!tokens.length || !Number.isFinite(duration) || duration <= 0) throw new Error('Add caption text and a positive duration first.');
  return tokens.map((w, i) => ({ w, start: duration * i / tokens.length, end: duration * (i + 1) / tokens.length }));
}

/** Tap successive word starts. The next tap closes the previous word; the final word
 * ends at the cue end until edited. This is manual timing, not speech recognition.
 */
export function tapCaptionWord(words: readonly CaptionWord[], index: number, localTime: number, duration: number): CaptionWord[] {
  if (!Number.isInteger(index) || index < 0 || index >= words.length) throw new Error('Choose a word to time.');
  if (!Number.isFinite(localTime) || localTime < 0 || localTime >= duration) throw new Error('Place the playhead inside the selected cue.');
  const next = words.map((w) => ({ ...w }));
  if (index && localTime <= next[index - 1].start) throw new Error('Tap after the previous word start.');
  // Redistribute only the unmarked remainder, which remains explicitly approximate.
  const remaining = duration - localTime;
  for (let i = index; i < next.length; i++) {
    next[i].start = localTime + remaining * (i - index) / (next.length - index);
    next[i].end = i === next.length - 1 ? duration : localTime + remaining * (i - index + 1) / (next.length - index);
  }
  if (index) next[index - 1].end = localTime;
  const errors = validateCaptionWords(next, duration);
  if (errors.length) throw new Error(errors.join('\n'));
  return next;
}
