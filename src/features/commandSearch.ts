/** Small pure helpers behind the command palette: ranking and recent-item
 * bookkeeping. Kept out of the component so they can be tested without a DOM. */

export interface CommandFields {
  name: string;
  detail?: string;
  group?: string;
  keywords?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Score one query token against one field. Higher is better; -1 = no match. */
function fieldScore(text: string, token: string): number {
  if (!text) return -1;
  if (text === token) return 1000;
  if (text.startsWith(token)) return 700 - Math.min(200, text.length);
  const at = text.indexOf(token);
  if (at >= 0) return 520 - at * 2 - Math.min(120, text.length * 0.5);
  // Ordered subsequence ("rmvdr" → "remove dead air"): cheap fuzzy matching
  // without pulling in a search dependency.
  let cursor = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of token) {
    const next = text.indexOf(ch, cursor);
    if (next < 0) return -1;
    if (last >= 0) gaps += Math.max(0, next - last - 1);
    last = next;
    cursor = next + 1;
  }
  return Math.max(40, 220 - gaps * 3 - Math.min(80, text.length * 0.4));
}

/**
 * Match all space-separated tokens against the name first, then the supporting
 * fields at a lower weight. Returns -1 when any token cannot be matched.
 */
export function commandScore(query: string, fields: CommandFields): number {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(fields.name);
  const detail = norm(fields.detail ?? '');
  const group = norm(fields.group ?? '');
  const keywords = norm(fields.keywords ?? '');
  let total = 0;
  for (const token of q.split(' ')) {
    const score = Math.max(
      fieldScore(name, token),
      fieldScore(keywords, token) * 0.72,
      fieldScore(detail, token) * 0.55,
      fieldScore(group, token) * 0.45,
    );
    if (score < 0) return -1;
    total += score;
  }
  return total;
}

/** Pure recency update: newest first, de-duplicated, capped. */
export function nextRecent(current: readonly string[], id: string, max = 6): string[] {
  return [id, ...current.filter((x) => x !== id)].slice(0, max);
}
