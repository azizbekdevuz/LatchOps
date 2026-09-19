import type { RepoSignalsV1, SnapshotV1 } from '@latchops/schema';

const FORTY = 'a'.repeat(40);

export function makeSnapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    version: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
    platform: 'linux',
    repoRoot: '/repo',
    gitDir: '/repo/.git',
    branch: { head: 'main', oid: FORTY },
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

export function makeSignals(overrides: Partial<RepoSignalsV1> = {}): RepoSignalsV1 {
  return {
    version: 1,
    state: 'clean',
    secondaryStates: [],
    reasons: [],
    branch: {
      name: 'main',
      oid: FORTY,
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      isUnborn: false,
    },
    worktree: {
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicted: 0,
      conflictedPaths: [],
      isDirty: false,
    },
    operations: {
      merge: false,
      rebase: false,
      rebaseType: 'none',
      cherryPick: false,
      revert: false,
      bisect: false,
    },
    ...overrides,
  };
}
