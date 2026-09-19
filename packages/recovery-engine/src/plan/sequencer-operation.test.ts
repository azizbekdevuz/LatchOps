import { describe, expect, it } from 'vitest';
import type { RecoveryPlanV1, RecoveryStepV1 } from '@latchops/schema';
import { generateRecoveryPlan } from './index.js';
import { makeSignals, makeSnapshot } from '../test-support/fixtures.js';

const NOW = { now: new Date('2026-01-01T00:00:00.000Z') };

function allCommands(plan: RecoveryPlanV1): string[][] {
  const steps: RecoveryStepV1[] = [...plan.steps, ...plan.alternatives.flatMap((a) => a.steps)];
  return steps.flatMap((s) => s.commands.map((c) => c.args));
}

function emitsMergeAbortOrContinue(plan: RecoveryPlanV1): boolean {
  return allCommands(plan).some(
    (args) => args[0] === 'merge' && (args.includes('--abort') || args.includes('--continue')),
  );
}

const conflictOps = (over: Record<string, boolean>) => ({
  merge: false,
  rebase: false,
  rebaseType: 'none' as const,
  cherryPick: false,
  revert: false,
  bisect: false,
  ...over,
});

describe('operation-routing safety correction', () => {
  it('cherry-pick conflict never emits git merge --abort/--continue', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({ cherryPickInProgress: true }),
        signals: makeSignals({
          state: 'merge_conflict',
          operations: conflictOps({ cherryPick: true }),
          worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 1, conflictedPaths: ['x.txt'], isDirty: true },
        }),
      },
      NOW,
    );
    expect(emitsMergeAbortOrContinue(plan)).toBe(false);
    expect(plan.manualReviewRequired).toBe(true);
    // Emits the correct cherry-pick commands instead.
    expect(allCommands(plan).some((a) => a[0] === 'cherry-pick' && a.includes('--abort'))).toBe(true);
    expect(allCommands(plan).some((a) => a[0] === 'cherry-pick' && a.includes('--continue'))).toBe(
      true,
    );
  });

  it('revert conflict never emits merge-specific commands', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({ revertInProgress: true }),
        signals: makeSignals({
          state: 'merge_conflict',
          operations: conflictOps({ revert: true }),
          worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 1, conflictedPaths: ['y.txt'], isDirty: true },
        }),
      },
      NOW,
    );
    expect(emitsMergeAbortOrContinue(plan)).toBe(false);
    expect(allCommands(plan).some((a) => a[0] === 'revert' && a.includes('--abort'))).toBe(true);
  });

  it('bisect state never emits invalid (merge/cherry-pick) recovery commands', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({ bisectInProgress: true }),
        signals: makeSignals({
          // bisect typically detaches HEAD; routing must ignore that.
          state: 'detached_head',
          operations: conflictOps({ bisect: true }),
          branch: { name: null, oid: 'a'.repeat(40), upstream: null, ahead: 0, behind: 0, isDetached: true, isUnborn: false },
        }),
      },
      NOW,
    );
    expect(emitsMergeAbortOrContinue(plan)).toBe(false);
    expect(allCommands(plan).some((a) => a[0] === 'cherry-pick')).toBe(false);
    // Only a bisect-correct command is offered.
    expect(allCommands(plan).some((a) => a[0] === 'bisect' && a.includes('reset'))).toBe(true);
    expect(plan.manualReviewRequired).toBe(true);
  });

  it('conflicts with no active merge and no known operation → safe manual review, no merge commands', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot(),
        signals: makeSignals({
          state: 'merge_conflict',
          operations: conflictOps({}),
          worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 1, conflictedPaths: ['z.txt'], isDirty: true },
        }),
      },
      NOW,
    );
    expect(emitsMergeAbortOrContinue(plan)).toBe(false);
    expect(plan.manualReviewRequired).toBe(true);
    expect(plan.incomplete).toBe(true);
    // Diagnostics are read-only only.
    expect(plan.steps.every((s) => s.commands.every((c) => c.readOnly))).toBe(true);
  });

  it('regression: an actual merge (MERGE_HEAD present) still gets the merge plan', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({ mergeHead: 'deadbeef', branch: { head: 'main', oid: 'a'.repeat(40) } }),
        signals: makeSignals({
          state: 'merge_conflict',
          operations: conflictOps({ merge: true }),
          worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 1, conflictedPaths: ['m.txt'], isDirty: true },
        }),
      },
      NOW,
    );
    expect(plan.incidentType).toBe('merge_conflict');
    expect(plan.alternatives.map((a) => a.id)).toEqual(['complete_merge', 'abort_merge']);
    expect(allCommands(plan).some((a) => a[0] === 'merge' && a.includes('--abort'))).toBe(true);
  });
});
