import {
  RepoSignalsV1Schema,
  type RepoSignalsV1,
  type RepoState,
  type SnapshotV1,
} from '@latchops/schema';

/**
 * Deterministically compute canonical {@link RepoSignalsV1} from a snapshot.
 *
 * Pure function: no git calls, no I/O, no LLM. Given the same snapshot it
 * always returns the same classification, which makes it trivially testable
 * and reproducible from persisted snapshots. Every classification records the
 * `reasons` that produced it.
 *
 * Classification priority (only these six states are emitted in Phase 1):
 *   merge_conflict > rebase_in_progress > detached_head > dirty_worktree > clean,
 * with `unknown` as the fallback (e.g. an unborn branch with no commits yet).
 */
export function computeRepoSignals(snapshot: SnapshotV1): RepoSignalsV1 {
  const isUnborn = snapshot.branch.oid === '(initial)' || snapshot.branch.oid === '';
  const isDetached = snapshot.isDetachedHead;

  const conflictedPaths = snapshot.unmergedFiles.map((f) => f.path);
  const conflicted = conflictedPaths.length;
  const staged = snapshot.stagedFiles.length;
  const modified = snapshot.modifiedFiles.length;
  const untracked = snapshot.untrackedFiles.length;
  const isDirty = staged > 0 || modified > 0 || untracked > 0;

  const branch: RepoSignalsV1['branch'] = {
    name: isDetached ? null : snapshot.branch.head || null,
    oid: isUnborn ? null : snapshot.branch.oid || null,
    upstream: snapshot.branch.upstream ?? null,
    ahead: snapshot.branch.aheadBehind?.ahead ?? 0,
    behind: snapshot.branch.aheadBehind?.behind ?? 0,
    isDetached,
    isUnborn,
  };

  const worktree: RepoSignalsV1['worktree'] = {
    staged,
    modified,
    untracked,
    conflicted,
    conflictedPaths,
    isDirty,
  };

  const operations: RepoSignalsV1['operations'] = {
    merge: Boolean(snapshot.mergeHead),
    rebase: snapshot.rebaseState.inProgress,
    rebaseType: snapshot.rebaseState.type,
    cherryPick: snapshot.cherryPickInProgress ?? false,
    revert: snapshot.revertInProgress ?? false,
    bisect: snapshot.bisectInProgress ?? false,
  };

  const { state, secondaryStates, reasons } = classify({
    snapshot,
    isUnborn,
    isDetached,
    conflicted,
    staged,
    modified,
    untracked,
    isDirty,
  });

  const signals: RepoSignalsV1 = {
    version: 1,
    state,
    secondaryStates,
    reasons,
    branch,
    worktree,
    operations,
  };

  return RepoSignalsV1Schema.parse(signals);
}

interface ClassifyInput {
  snapshot: SnapshotV1;
  isUnborn: boolean;
  isDetached: boolean;
  conflicted: number;
  staged: number;
  modified: number;
  untracked: number;
  isDirty: boolean;
}

function classify(input: ClassifyInput): {
  state: RepoState;
  secondaryStates: RepoState[];
  reasons: string[];
} {
  const { snapshot } = input;
  const reasons: string[] = [];

  const checks: { state: RepoState; active: boolean; reason: string }[] = [
    {
      state: 'merge_conflict',
      active: input.conflicted > 0,
      reason: `${input.conflicted} unmerged path(s) with conflict markers`,
    },
    {
      state: 'rebase_in_progress',
      active: snapshot.rebaseState.inProgress,
      reason: rebaseReason(snapshot),
    },
    {
      state: 'detached_head',
      active: input.isDetached,
      reason: `HEAD is detached at ${short(snapshot.branch.oid)}`,
    },
    {
      state: 'dirty_worktree',
      active: input.isDirty,
      reason: dirtyReason(input),
    },
  ];

  const active = checks.filter((c) => c.active);

  if (active.length > 0) {
    for (const c of active) reasons.push(c.reason);
    if (snapshot.mergeHead) {
      reasons.push(`merge in progress (MERGE_HEAD ${short(snapshot.mergeHead)})`);
    }
    return {
      state: active[0].state,
      secondaryStates: active.slice(1).map((c) => c.state),
      reasons,
    };
  }

  if (input.isUnborn) {
    reasons.push('unborn branch: no commits yet');
    return { state: 'unknown', secondaryStates: [], reasons };
  }

  reasons.push(
    `working tree clean${snapshot.branch.head ? ` on branch ${snapshot.branch.head}` : ''}`,
  );
  return { state: 'clean', secondaryStates: [], reasons };
}

function rebaseReason(snapshot: SnapshotV1): string {
  const s = snapshot.rebaseState;
  const progress =
    s.currentStep != null && s.totalSteps != null ? ` (step ${s.currentStep}/${s.totalSteps})` : '';
  const onto = s.headName ? `, rebasing ${s.headName}` : '';
  return `rebase in progress [${s.type}]${progress}${onto}`;
}

function dirtyReason(input: ClassifyInput): string {
  const parts: string[] = [];
  if (input.staged > 0) parts.push(`${input.staged} staged`);
  if (input.modified > 0) parts.push(`${input.modified} modified`);
  if (input.untracked > 0) parts.push(`${input.untracked} untracked`);
  return `uncommitted changes: ${parts.join(', ')}`;
}

function short(oid: string): string {
  return oid ? oid.slice(0, 8) : '(unknown)';
}
