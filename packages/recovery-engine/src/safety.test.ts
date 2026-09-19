import { describe, expect, it } from 'vitest';
import { git } from './command.js';
import { aggregateSafety, classifyCommand, maxRisk } from './safety.js';

describe('classifyCommand — destructive operations', () => {
  it('marks git reset --hard destructive/high', () => {
    const s = classifyCommand(git(['reset', '--hard', 'HEAD~1']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git clean destructive/high', () => {
    const s = classifyCommand(git(['clean', '-fd']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git branch -D destructive/high', () => {
    const s = classifyCommand(git(['branch', '-D', 'feature']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git push --force destructive/critical', () => {
    const s = classifyCommand(git(['push', '--force']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('critical');
  });

  it('marks git push --force-with-lease destructive/high (less than --force)', () => {
    const s = classifyCommand(git(['push', '--force-with-lease']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git rebase --abort destructive/high', () => {
    const s = classifyCommand(git(['rebase', '--abort']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git merge --abort destructive/high', () => {
    const s = classifyCommand(git(['merge', '--abort']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git rebase --skip destructive/high', () => {
    const s = classifyCommand(git(['rebase', '--skip']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git commit --amend destructive/high (history rewrite)', () => {
    const s = classifyCommand(git(['commit', '--amend']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks git filter-branch destructive/critical', () => {
    const s = classifyCommand(git(['filter-branch', '--all']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('critical');
  });

  it('marks checkout of paths destructive/high', () => {
    const s = classifyCommand(git(['checkout', '--', 'file.txt']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });

  it('marks stash drop destructive/high', () => {
    const s = classifyCommand(git(['stash', 'drop']));
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });
});

describe('classifyCommand — non-destructive operations', () => {
  it('treats git status as read-only/none', () => {
    const s = classifyCommand(git(['status', '--porcelain=v2']));
    expect(s.destructive).toBe(false);
    expect(s.risk).toBe('none');
    expect(s.readOnly).toBe(true);
  });

  it('treats git log/diff/reflog as read-only', () => {
    for (const args of [['log', '--oneline'], ['diff', '--stat'], ['reflog', '-n', '5']]) {
      const s = classifyCommand(git(args));
      expect(s.readOnly).toBe(true);
      expect(s.destructive).toBe(false);
    }
  });

  it('treats git stash push as non-destructive/low', () => {
    const s = classifyCommand(git(['stash', 'push', '--include-untracked']));
    expect(s.destructive).toBe(false);
    expect(s.risk).toBe('low');
  });

  it('treats git switch -c as non-destructive', () => {
    const s = classifyCommand(git(['switch', '-c', 'rescue']));
    expect(s.destructive).toBe(false);
  });

  it('treats git reset --soft as non-destructive/medium', () => {
    const s = classifyCommand(git(['reset', '--soft', 'HEAD~1']));
    expect(s.destructive).toBe(false);
    expect(s.risk).toBe('medium');
  });

  it('treats git rebase --continue and merge --continue as non-destructive/medium', () => {
    expect(classifyCommand(git(['rebase', '--continue'])).destructive).toBe(false);
    expect(classifyCommand(git(['merge', '--continue'])).destructive).toBe(false);
  });

  it('treats git branch <name> creation as non-destructive', () => {
    const s = classifyCommand(git(['branch', 'rescue', 'abc1234']));
    expect(s.destructive).toBe(false);
  });
});

describe('risk aggregation', () => {
  it('maxRisk orders levels', () => {
    expect(maxRisk('none', 'low')).toBe('low');
    expect(maxRisk('high', 'medium')).toBe('high');
    expect(maxRisk('high', 'critical')).toBe('critical');
  });

  it('aggregateSafety takes the worst across commands', () => {
    const s = aggregateSafety([
      git(['status'], { readOnly: true }),
      git(['reset', '--hard', 'HEAD']),
    ]);
    expect(s.destructive).toBe(true);
    expect(s.risk).toBe('high');
  });
});
