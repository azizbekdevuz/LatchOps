import { describe, expect, it } from 'vitest';
import type { SnapshotV1 } from '@latchops/schema';
import { computeRepoSignals } from './classify';

function makeSnapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    platform: 'linux',
    repoRoot: '/repo',
    gitDir: '/repo/.git',
    branch: { head: 'main', oid: '1234567890abcdef' },
    isDetachedHead: false,
    rebaseState: { inProgress: false, type: 'none' },
    unmergedFiles: [],
    stagedFiles: [],
    modifiedFiles: [],
    untrackedFiles: [],
    recentLog: [],
    recentReflog: [],
    rawStatus: '',
    rawBranches: '',
    ...overrides,
  };
}

describe('computeRepoSignals classification', () => {
  it('classifies a clean repository', () => {
    const s = computeRepoSignals(makeSnapshot());
    expect(s.state).toBe('clean');
    expect(s.secondaryStates).toEqual([]);
    expect(s.reasons.length).toBeGreaterThan(0);
    expect(s.worktree.isDirty).toBe(false);
  });

  it('classifies a dirty worktree', () => {
    const s = computeRepoSignals(makeSnapshot({ modifiedFiles: ['a.ts'], untrackedFiles: ['b.ts'] }));
    expect(s.state).toBe('dirty_worktree');
    expect(s.worktree.modified).toBe(1);
    expect(s.worktree.untracked).toBe(1);
    expect(s.worktree.isDirty).toBe(true);
  });

  it('classifies merge conflict with highest priority', () => {
    const s = computeRepoSignals(
      makeSnapshot({
        unmergedFiles: [{ path: 'x.ts', conflictBlocks: [] }],
        modifiedFiles: ['x.ts'],
      }),
    );
    expect(s.state).toBe('merge_conflict');
    expect(s.worktree.conflicted).toBe(1);
    expect(s.worktree.conflictedPaths).toEqual(['x.ts']);
    // dirty is still an applicable secondary state.
    expect(s.secondaryStates).toContain('dirty_worktree');
  });

  it('classifies detached HEAD, with dirty as a secondary state', () => {
    const s = computeRepoSignals(
      makeSnapshot({ isDetachedHead: true, modifiedFiles: ['a.ts'] }),
    );
    expect(s.state).toBe('detached_head');
    expect(s.branch.isDetached).toBe(true);
    expect(s.branch.name).toBeNull();
    expect(s.secondaryStates).toContain('dirty_worktree');
  });

  it('classifies rebase in progress', () => {
    const s = computeRepoSignals(
      makeSnapshot({
        rebaseState: { inProgress: true, type: 'merge', headName: 'feature', currentStep: 1, totalSteps: 3 },
      }),
    );
    expect(s.state).toBe('rebase_in_progress');
    expect(s.operations.rebase).toBe(true);
    expect(s.operations.rebaseType).toBe('merge');
  });

  it('prioritizes conflict over rebase when both are present', () => {
    const s = computeRepoSignals(
      makeSnapshot({
        rebaseState: { inProgress: true, type: 'merge' },
        unmergedFiles: [{ path: 'x.ts', conflictBlocks: [] }],
      }),
    );
    expect(s.state).toBe('merge_conflict');
    expect(s.secondaryStates).toContain('rebase_in_progress');
  });

  it('reports merge-in-progress in reasons when MERGE_HEAD is present', () => {
    const s = computeRepoSignals(
      makeSnapshot({
        mergeHead: 'abcdef1234',
        unmergedFiles: [{ path: 'x.ts', conflictBlocks: [] }],
      }),
    );
    expect(s.operations.merge).toBe(true);
    expect(s.reasons.some((r) => r.includes('merge in progress'))).toBe(true);
  });

  it('classifies an unborn branch as unknown', () => {
    const s = computeRepoSignals(makeSnapshot({ branch: { head: 'main', oid: '(initial)' } }));
    expect(s.state).toBe('unknown');
    expect(s.branch.isUnborn).toBe(true);
    expect(s.branch.oid).toBeNull();
  });

  it('maps ahead/behind and upstream', () => {
    const s = computeRepoSignals(
      makeSnapshot({
        branch: { head: 'main', oid: 'abc', upstream: 'origin/main', aheadBehind: { ahead: 4, behind: 1 } },
      }),
    );
    expect(s.branch.upstream).toBe('origin/main');
    expect(s.branch.ahead).toBe(4);
    expect(s.branch.behind).toBe(1);
  });
});
