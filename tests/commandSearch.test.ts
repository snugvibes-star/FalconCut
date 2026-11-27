import { describe, expect, it } from 'vitest';
import { commandScore, nextRecent } from '../src/features/commandSearch';

describe('command palette search', () => {
  const removeDeadAir = {
    name: 'Remove dead air',
    detail: 'Cut silent pauses and tighten the edit',
    group: 'AI tools',
  };

  it('ranks an exact name above a prefix above a loose match', () => {
    const exact = commandScore('remove dead air', removeDeadAir);
    const prefix = commandScore('remove', removeDeadAir);
    const detail = commandScore('pauses', removeDeadAir);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(detail);
    expect(detail).toBeGreaterThan(0);
  });

  it('matches ordered subsequences without a search dependency', () => {
    expect(commandScore('rmvdr', removeDeadAir)).toBeGreaterThan(0);
  });

  it('requires every token to match one of the fields', () => {
    expect(commandScore('remove pause', removeDeadAir)).toBeGreaterThan(0);
    expect(commandScore('remove unicorn', removeDeadAir)).toBe(-1);
  });

  it('returns 0 for an empty query so the caller can keep its curated order', () => {
    expect(commandScore('   ', removeDeadAir)).toBe(0);
  });
});

describe('recent palette items', () => {
  it('moves a repeated item to the front and de-duplicates', () => {
    expect(nextRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('caps the list', () => {
    expect(nextRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});
