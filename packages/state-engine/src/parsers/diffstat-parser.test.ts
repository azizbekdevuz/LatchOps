import { describe, expect, it } from 'vitest';
import { parseDiffStat } from './diffstat-parser';

/** Build a `--numstat -z` payload from pre-formatted NUL-less tokens. */
function z(...tokens: string[]): string {
  return tokens.map((t) => `${t}\0`).join('');
}

describe('parseDiffStat (--numstat -z)', () => {
  it('parses normal additions/deletions with spaced paths', () => {
    const raw = z('10\t2\tsrc/some file.ts');
    expect(parseDiffStat(raw)).toEqual([
      { path: 'src/some file.ts', additions: 10, deletions: 2 },
    ]);
  });

  it('marks binary files', () => {
    const raw = z('-\t-\tassets/logo.png');
    expect(parseDiffStat(raw)).toEqual([
      { path: 'assets/logo.png', additions: 0, deletions: 0, binary: true },
    ]);
  });

  it('parses rename entries where paths follow as separate tokens', () => {
    // Rename: `<add>\t<del>\t` then <oldPath> then <newPath>.
    const raw = z('3\t1\t', 'old name.ts', 'new name.ts') + z('5\t0\tunchanged.ts');
    const stats = parseDiffStat(raw);
    expect(stats).toEqual([
      { path: 'new name.ts', additions: 3, deletions: 1 },
      { path: 'unchanged.ts', additions: 5, deletions: 0 },
    ]);
  });

  it('returns empty for blank input', () => {
    expect(parseDiffStat('')).toEqual([]);
    expect(parseDiffStat('   ')).toEqual([]);
  });
});
