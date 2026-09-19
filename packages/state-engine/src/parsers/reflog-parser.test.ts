import { describe, expect, it } from 'vitest';
import { parseReflog } from './reflog-parser';

const US = '\x1f';
const RS = '\x1e';

function rec(hash: string, selector: string, subject: string): string {
  return `${hash}${US}${selector}${US}${subject}${RS}`;
}

describe('parseReflog', () => {
  it('splits subject into action and message on the first colon', () => {
    const raw = rec('aaa', 'HEAD@{0}', 'commit: add validation');
    const [entry] = parseReflog(raw);
    expect(entry).toEqual({
      hash: 'aaa',
      selector: 'HEAD@{0}',
      action: 'commit',
      message: 'add validation',
    });
  });

  it('parses checkout entries used for reflog-based recovery hints', () => {
    const raw = rec('bbb', 'HEAD@{1}', 'checkout: moving from main to feature');
    const [entry] = parseReflog(raw);
    expect(entry.action).toBe('checkout');
    expect(entry.message).toBe('moving from main to feature');
  });

  it('handles subjects without a colon', () => {
    const raw = rec('ccc', 'HEAD@{2}', 'initial pull');
    const [entry] = parseReflog(raw);
    expect(entry.action).toBe('unknown');
    expect(entry.message).toBe('initial pull');
  });

  it('returns an empty array for empty input', () => {
    expect(parseReflog('')).toEqual([]);
  });
});
