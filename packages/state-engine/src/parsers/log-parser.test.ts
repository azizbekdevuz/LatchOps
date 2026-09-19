import { describe, expect, it } from 'vitest';
import { parseLog } from './log-parser';

const US = '\x1f';
const RS = '\x1e';

function rec(hash: string, decorations: string, subject: string): string {
  return `${hash}${US}${decorations}${US}${subject}${RS}`;
}

describe('parseLog', () => {
  it('parses hash, decorations, and subject', () => {
    const raw = rec('abc123', 'HEAD -> main, origin/main, tag: v1.0', 'first subject') +
      rec('def456', '', 'second subject');
    const entries = parseLog(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      hash: 'abc123',
      refs: ['HEAD', 'main', 'origin/main', 'v1.0'],
      message: 'first subject',
    });
    expect(entries[1]).toEqual({ hash: 'def456', refs: [], message: 'second subject' });
  });

  it('tolerates subjects containing separators-like text', () => {
    const raw = rec('c0ffee', '', 'fix: handle a -> b transition');
    const entries = parseLog(raw);
    expect(entries[0].message).toBe('fix: handle a -> b transition');
    expect(entries[0].refs).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseLog('')).toEqual([]);
  });
});
