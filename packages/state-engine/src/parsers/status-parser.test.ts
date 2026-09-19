import { describe, expect, it } from 'vitest';
import { parseStatus } from './status-parser';

/** Join porcelain-v2 `-z` records (NUL-terminated) into a single payload. */
function z(...records: string[]): string {
  return records.map((r) => `${r}\0`).join('');
}

describe('parseStatus (porcelain v2 -z)', () => {
  it('parses branch headers including ahead/behind and upstream', () => {
    const raw = z(
      '# branch.oid 1111111111111111111111111111111111111111',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -3',
    );
    const info = parseStatus(raw);
    expect(info.branch.oid).toBe('1111111111111111111111111111111111111111');
    expect(info.branch.head).toBe('main');
    expect(info.branch.upstream).toBe('origin/main');
    expect(info.branch.ahead).toBe(2);
    expect(info.branch.behind).toBe(3);
    expect(info.isDetachedHead).toBe(false);
    expect(info.isUnbornBranch).toBe(false);
  });

  it('detects detached HEAD', () => {
    const info = parseStatus(z('# branch.oid deadbeef', '# branch.head (detached)'));
    expect(info.isDetachedHead).toBe(true);
  });

  it('detects an unborn branch via (initial) oid', () => {
    const info = parseStatus(z('# branch.oid (initial)', '# branch.head main'));
    expect(info.isUnbornBranch).toBe(true);
  });

  it('preserves paths containing spaces and Unicode in ordinary entries', () => {
    // XY = "MM" (staged + worktree modified). Path contains a space and Cyrillic.
    const raw = z(
      '# branch.head main',
      '1 MM N... 100644 100644 100644 1111111 2222222 src/имя файл.ts',
    );
    const info = parseStatus(raw);
    expect(info.stagedFiles).toContain('src/имя файл.ts');
    expect(info.modifiedFiles).toContain('src/имя файл.ts');
  });

  it('distinguishes staged-only vs worktree-only via XY code', () => {
    const staged = parseStatus(z('1 M. N... 100644 100644 100644 a b staged.ts'));
    expect(staged.stagedFiles).toEqual(['staged.ts']);
    expect(staged.modifiedFiles).toEqual([]);

    const worktree = parseStatus(z('1 .M N... 100644 100644 100644 a b work.ts'));
    expect(worktree.stagedFiles).toEqual([]);
    expect(worktree.modifiedFiles).toEqual(['work.ts']);
  });

  it('parses untracked entries with spaces', () => {
    const info = parseStatus(z('? new file.txt', '? другой.md'));
    expect(info.untrackedFiles).toEqual(['new file.txt', 'другой.md']);
  });

  it('parses unmerged (conflicted) entries', () => {
    const raw = z(
      '# branch.head main',
      'u UU N... 100644 100644 100644 000000 aaaa bbbb cccc conflicted file.ts',
    );
    const info = parseStatus(raw);
    expect(info.unmergedPaths).toEqual(['conflicted file.ts']);
  });

  it('parses rename entries and consumes the origPath token', () => {
    const raw = z(
      '# branch.head main',
      '2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.ts',
      'old name.ts',
    );
    const info = parseStatus(raw);
    expect(info.renames).toEqual([{ path: 'new name.ts', origPath: 'old name.ts' }]);
    // Rename with X='R' is a staged change.
    expect(info.stagedFiles).toContain('new name.ts');
  });

  it('handles an empty payload', () => {
    const info = parseStatus('');
    expect(info.stagedFiles).toEqual([]);
    expect(info.unmergedPaths).toEqual([]);
    expect(info.branch.oid).toBe('');
  });

  it('does not confuse a rename origPath token with a new record', () => {
    // origPath "1 not a record.ts" must be consumed as the rename source,
    // not parsed as an ordinary entry.
    const raw = z(
      '2 R. N... 100644 100644 100644 aaaa bbbb R100 renamed.ts',
      '1 not a record.ts',
      '? real-untracked.ts',
    );
    const info = parseStatus(raw);
    expect(info.renames).toEqual([{ path: 'renamed.ts', origPath: '1 not a record.ts' }]);
    expect(info.untrackedFiles).toEqual(['real-untracked.ts']);
    // The fake "1 ..." token was consumed, so no stray staged file beyond the rename.
    expect(info.stagedFiles).toEqual(['renamed.ts']);
  });
});
