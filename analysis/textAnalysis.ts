/**
 * Transcript text analysis: filler words, retake/false-start detection,
 * keywords, sentence-start emphasis. Pure functions on word timestamps.
 */
import type { FillerHit, RetakeGroup, TranscriptWord } from '../engine/types';

const FILLER_SINGLE = new Set(['um', 'uh', 'erm', 'er', 'hmm', 'mm', 'ah']);
const FILLER_PHRASES = [['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of']];
const STOPWORDS = new Set('the a an and or but if then than so as of at by for with about into through during before after above below to from up down in out on off over under again further once here there all any both each few more most other some such no nor not only own same too very can will just should now i me my we our you your he him his she her it its they them their what which who whom this that these those am is are was were be been being have has had having do does did doing would could shall may might must'.split(' '));

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

export function detectFillers(words: TranscriptWord[]): FillerHit[] {
  const hits: FillerHit[] = [];
  for (let i = 0; i < words.length; i++) {
    const n = norm(words[i].word);
    if (FILLER_SINGLE.has(n)) {
      hits.push({ start: words[i].start, end: words[i].end, text: words[i].word.trim(), wordIndices: [i, i] });
      continue;
    }
    for (const phrase of FILLER_PHRASES) {
      if (i + phrase.length <= words.length && phrase.every((p, k) => norm(words[i + k].word) === p)) {
        // "you know" / "i mean" only count as fillers when surrounded by a pause or at clause edges
        const before = i > 0 ? words[i].start - words[i - 1].end : 1;
        const after = i + phrase.length < words.length ? words[i + phrase.length].start - words[i + phrase.length - 1].end : 1;
        if (before > 0.18 || after > 0.18) {
          hits.push({ start: words[i].start, end: words[i + phrase.length - 1].end, text: phrase.join(' '), wordIndices: [i, i + phrase.length - 1] });
        }
        i += phrase.length - 1;
        break;
      }
    }
  }
  return hits;
}

function similarity(a: string[], b: string[]): number {
  const setB = new Set(b);
  let hit = 0;
  for (const w of a) if (setB.has(w)) hit++;
  return hit / Math.max(1, Math.min(a.length, b.length));
}

/**
 * Retakes: repeated similar phrases close together. The LAST complete
 * attempt is marked as the best take; earlier attempts are removable.
 */
export function detectRetakes(words: TranscriptWord[], windowSec = 30): RetakeGroup[] {
  const groups: RetakeGroup[] = [];
  const normWords = words.map((w) => norm(w.word)).filter(Boolean);
  const n = words.length;
  const used = new Set<number>();
  for (let len = 5; len >= 3; len--) {
    for (let i = 0; i + len <= n; i++) {
      if (used.has(i)) continue;
      const phrase = normWords.slice(i, i + len);
      if (phrase.filter((w) => !STOPWORDS.has(w)).length < 2) continue;
      const attempts: { start: number; end: number; text: string; idx: number }[] = [
        { start: words[i].start, end: words[i + len - 1].end, text: words.slice(i, i + len).map((w) => w.word.trim()).join(' '), idx: i },
      ];
      for (let j = i + 1; j + len <= n && words[j].start - words[i].start < windowSec; j++) {
        if (used.has(j)) continue;
        const cand = normWords.slice(j, j + len);
        if (similarity(phrase, cand) >= 0.7) {
          // extend attempt to sentence end (punctuation or pause)
          let end = j + len - 1;
          while (end + 1 < n && words[end + 1].start - words[end].end < 0.6 && !/[.!?]$/.test(words[end].word)) end++;
          attempts.push({ start: words[j].start, end: words[end].end, text: words.slice(j, end + 1).map((w) => w.word.trim()).join(' '), idx: j });
          for (let k = j; k <= end; k++) used.add(k);
        }
      }
      if (attempts.length >= 2) {
        for (let k = i; k < i + len; k++) used.add(k);
        // best = last complete attempt (longest among the last two if similar length)
        let bestIndex = attempts.length - 1;
        const last = attempts[bestIndex], prev = attempts[bestIndex - 1];
        if (prev.text.length > last.text.length * 1.35) bestIndex = bestIndex - 1;
        groups.push({
          attempts: attempts.map(({ start, end, text }) => ({ start, end, text })),
          bestIndex,
          start: attempts[0].start,
          end: attempts[bestIndex].start,
        });
        i += len;
      }
    }
  }
  return groups.sort((a, b) => a.start - b.start);
}

export function extractKeywords(words: TranscriptWord[], max = 12): string[] {
  const freq = new Map<string, number>();
  for (const w of words) {
    const n = norm(w.word);
    if (n.length < 3 || STOPWORDS.has(n) || FILLER_SINGLE.has(n)) continue;
    freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

/** Sentence starts + numeric/exclamation emphasis, merged with audio emphasis. */
export function textEmphasis(words: TranscriptWord[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const prev = words[i - 1];
    const isStart = !prev || /[.!?]$/.test(prev.word) || words[i].start - prev.end > 0.6;
    if (isStart && i > 0) out.push(words[i].start);
    if (/^\d/.test(words[i].word) || /!$/.test(words[i].word)) out.push(words[i].start);
  }
  return out;
}

/** Group words into segments by pauses/punctuation; heuristic speaker turns. */
export function segmentWords(words: TranscriptWord[]): { start: number; end: number; text: string; words: TranscriptWord[]; speaker?: string }[] {
  const segments: { start: number; end: number; text: string; words: TranscriptWord[]; speaker?: string }[] = [];
  let cur: TranscriptWord[] = [];
  let speakerIdx = 0;
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      start: cur[0].start, end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word.trim()).join(' ').replace(/\s+([,.!?])/g, '$1'),
      words: cur, speaker: `Speaker ${String.fromCharCode(65 + (speakerIdx % 4))}`,
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0;
    if (cur.length && (gap > 1.4 || (gap > 0.7 && /[.!?]$/.test(cur[cur.length - 1].word)))) {
      if (gap > 1.4) speakerIdx++;
      flush();
    }
    cur.push(w);
    if (/[.!?]$/.test(w.word) && cur.length >= 6) flush();
  }
  flush();
  return segments;
}