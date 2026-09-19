import { describe, expect, it } from 'vitest';
import type { RecoveryPlanV1, RecoveryStepV1 } from '@latchops/schema';
import { RecoveryPlanV1Schema } from '@latchops/schema';
import { generateRecoveryPlan } from './index.js';
import { makeSignals, makeSnapshot } from '../test-support/fixtures.js';

const NOW = { now: new Date('2026-01-01T00:00:00.000Z') };
const OID = 'abc1234def5678901234567890123456789012ab';

function allSteps(plan: RecoveryPlanV1): RecoveryStepV1[] {
  return [...plan.steps, ...plan.alternatives.flatMap((a) => a.steps)];
}

function hasHardReset(plan: RecoveryPlanV1): boolean {
  return allSteps(plan).some((s) =>
    s.commands.some((c) => c.args.includes('--hard') && c.args[0] === 'reset'),
  );
}

describe('generateRecoveryPlan — envelope + invariants', () => {
  it('always identifies as the deterministic engine and validates against the schema', () => {
    for (const state of [
      'clean',
      'dirty_worktree',
      'merge_conflict',
      'detached_head',
      'rebase_in_progress',
      'unknown',
    ] as const) {
      const plan = generateRecoveryPlan(
        { snapshot: makeSnapshot(), signals: makeSignals({ state }) },
        NOW,
      );
      expect(plan.generatedBy).toBe('deterministic_engine');
      expect(plan.version).toBe(1);
      expect(() => RecoveryPlanV1Schema.parse(plan)).not.toThrow();
    }
  });

  it('every destructive step requires confirmation, has prerequisites and an undo strategy', () => {
    for (const state of [
      'merge_conflict',
      'detached_head',
      'rebase_in_progress',
    ] as const) {
      const plan = generateRecoveryPlan(
        {
          snapshot: makeSnapshot({ branch: { head: 'main', oid: OID } }),
          signals: makeSignals({ state, operations: opsFor(state) }),
        },
        NOW,
      );
      for (const step of allSteps(plan)) {
        if (step.destructive) {
          expect(step.requiresConfirmation).toBe(true);
          expect(step.prerequisites.length).toBeGreaterThan(0);
          expect(step.undoStrategy).toBeDefined();
          // High-risk destructive undo must not over-claim reversibility.
          if (step.undoStrategy.reversibility !== 'reversible') {
            expect(step.undoStrategy.guaranteed).toBe(false);
          }
        }
      }
    }
  });
});

describe('clean plan', () => {
  it('requires no recovery and only read-only commands', () => {
    const plan = generateRecoveryPlan({ snapshot: makeSnapshot(), signals: makeSignals() }, NOW);
    expect(plan.incidentType).toBe('clean');
    expect(plan.risk).toBe('none');
    expect(plan.manualReviewRequired).toBe(false);
    expect(allSteps(plan).every((s) => s.commands.every((c) => c.readOnly))).toBe(true);
    expect(allSteps(plan).some((s) => s.destructive)).toBe(false);
  });
});

describe('dirty worktree plan', () => {
  const signals = makeSignals({
    state: 'dirty_worktree',
    worktree: { staged: 1, modified: 2, untracked: 1, conflicted: 0, conflictedPaths: [], isDirty: true },
  });

  it('offers non-destructive preservation alternatives and never blind reset --hard', () => {
    const plan = generateRecoveryPlan({ snapshot: makeSnapshot(), signals }, NOW);
    const ids = plan.alternatives.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['stash', 'patch', 'checkpoint-commit']));
    expect(hasHardReset(plan)).toBe(false);
  });

  it('recommends the stash alternative and marks it non-destructive', () => {
    const plan = generateRecoveryPlan({ snapshot: makeSnapshot(), signals }, NOW);
    const rec = plan.alternatives.find((a) => a.recommended);
    expect(rec?.id).toBe('stash');
    expect(rec?.steps.every((s) => !s.destructive)).toBe(true);
  });
});

describe('merge conflict plan', () => {
  const conflictedPaths = ['src/a.txt', 'src/b.txt'];
  const input = {
    snapshot: makeSnapshot({ branch: { head: 'main', oid: OID }, mergeHead: 'deadbeef' }),
    signals: makeSignals({
      state: 'merge_conflict',
      operations: { merge: true, rebase: false, rebaseType: 'none', cherryPick: false, revert: false, bisect: false },
      worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 2, conflictedPaths, isDirty: true },
    }),
  };

  it('offers complete and abort as explicit alternatives (not flattened)', () => {
    const plan = generateRecoveryPlan(input, NOW);
    expect(plan.alternatives.map((a) => a.id)).toEqual(['complete_merge', 'abort_merge']);
  });

  it('uses the real conflicted paths when staging resolved files', () => {
    const plan = generateRecoveryPlan(input, NOW);
    const complete = plan.alternatives.find((a) => a.id === 'complete_merge')!;
    const markResolved = complete.steps.find((s) => s.id === 'mark-resolved')!;
    expect(markResolved.commands[0].args).toEqual(['add', '--', ...conflictedPaths]);
  });

  it('marks merge --abort destructive with a backup step and non-guaranteed undo', () => {
    const plan = generateRecoveryPlan(input, NOW);
    const abort = plan.alternatives.find((a) => a.id === 'abort_merge')!;
    expect(abort.steps.some((s) => s.applicability.optional && s.id === 'preserve-before-abort')).toBe(
      true,
    );
    const abortStep = abort.steps.find((s) => s.id === 'merge-abort')!;
    expect(abortStep.destructive).toBe(true);
    expect(abortStep.risk).toBe('high');
    expect(abortStep.requiresConfirmation).toBe(true);
    expect(abortStep.undoStrategy.guaranteed).toBe(false);
  });
});

describe('detached HEAD plan', () => {
  it('preserves the commit on a concrete rescue branch and switches to the reflog branch', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({
          branch: { head: '(detached)', oid: OID },
          isDetachedHead: true,
          recentReflog: [
            { hash: OID, selector: 'HEAD@{0}', action: 'checkout', message: `moving from feature to ${OID}` },
          ],
        }),
        signals: makeSignals({
          state: 'detached_head',
          branch: { name: null, oid: OID, upstream: null, ahead: 0, behind: 0, isDetached: true, isUnborn: false },
        }),
      },
      NOW,
    );
    expect(plan.manualReviewRequired).toBe(false);
    const safety = plan.steps.find((s) => s.id === 'create-safety-branch')!;
    expect(safety.commands[0].args[0]).toBe('branch');
    expect(safety.commands[0].args).toContain(OID);
    const sw = plan.steps.find((s) => s.id === 'switch-to-branch')!;
    expect(sw.commands[0].args).toEqual(['switch', 'feature']);
    // No invented placeholders on the confident path.
    expect(allSteps(plan).every((s) => s.commands.every((c) => !c.containsPlaceholder))).toBe(true);
  });

  it('falls back to manual review with a labeled placeholder when the target is ambiguous', () => {
    const plan = generateRecoveryPlan(
      {
        snapshot: makeSnapshot({ branch: { head: '(detached)', oid: OID }, isDetachedHead: true }),
        signals: makeSignals({
          state: 'detached_head',
          branch: { name: null, oid: OID, upstream: null, ahead: 0, behind: 0, isDetached: true, isUnborn: false },
        }),
      },
      NOW,
    );
    expect(plan.manualReviewRequired).toBe(true);
    expect(plan.incomplete).toBe(true);
    // The commit is still preserved deterministically.
    expect(plan.steps.some((s) => s.id === 'create-safety-branch')).toBe(true);
    const placeholder = allSteps(plan).flatMap((s) => s.commands).find((c) => c.containsPlaceholder);
    expect(placeholder?.args).toContain('<branch-name>');
  });
});

describe('rebase in progress plan', () => {
  function rebaseInput(conflicted: number) {
    return {
      snapshot: makeSnapshot({
        branch: { head: 'main', oid: OID },
        rebaseState: { inProgress: true, type: 'merge' as const, headName: 'feature', onto: 'main' },
      }),
      signals: makeSignals({
        state: 'rebase_in_progress',
        operations: { merge: false, rebase: true, rebaseType: 'merge', cherryPick: false, revert: false, bisect: false },
        worktree: {
          staged: 0,
          modified: 0,
          untracked: 0,
          conflicted,
          conflictedPaths: conflicted > 0 ? ['x.txt'] : [],
          isDirty: conflicted > 0,
        },
      }),
    };
  }

  it('offers continue, abort, and skip as explicit alternatives; skip is not recommended', () => {
    const plan = generateRecoveryPlan(rebaseInput(1), NOW);
    expect(plan.alternatives.map((a) => a.id)).toEqual([
      'continue_rebase',
      'abort_rebase',
      'skip_commit',
    ]);
    const skip = plan.alternatives.find((a) => a.id === 'skip_commit')!;
    expect(skip.recommended).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/--skip/);
  });

  it('includes conflict-resolution steps only when conflicts are present', () => {
    const withConflicts = generateRecoveryPlan(rebaseInput(1), NOW);
    const cont1 = withConflicts.alternatives.find((a) => a.id === 'continue_rebase')!;
    expect(cont1.steps.some((s) => s.id === 'resolve-conflicts')).toBe(true);

    const noConflicts = generateRecoveryPlan(rebaseInput(0), NOW);
    const cont2 = noConflicts.alternatives.find((a) => a.id === 'continue_rebase')!;
    expect(cont2.steps.some((s) => s.id === 'resolve-conflicts')).toBe(false);
  });

  it('marks rebase --abort destructive and high risk', () => {
    const plan = generateRecoveryPlan(rebaseInput(1), NOW);
    const abort = plan.alternatives.find((a) => a.id === 'abort_rebase')!;
    const abortStep = abort.steps.find((s) => s.id === 'rebase-abort')!;
    expect(abortStep.destructive).toBe(true);
    expect(abortStep.risk).toBe('high');
  });
});

describe('unknown plan', () => {
  it('does not fabricate a solution; requires manual review with read-only commands', () => {
    const plan = generateRecoveryPlan(
      { snapshot: makeSnapshot(), signals: makeSignals({ state: 'unknown', reasons: ['weird state'] }) },
      NOW,
    );
    expect(plan.manualReviewRequired).toBe(true);
    expect(plan.incomplete).toBe(true);
    expect(allSteps(plan).every((s) => s.commands.every((c) => c.readOnly))).toBe(true);
    expect(allSteps(plan).some((s) => s.destructive)).toBe(false);
  });
});

function opsFor(state: string) {
  return {
    merge: state === 'merge_conflict',
    rebase: state === 'rebase_in_progress',
    rebaseType: (state === 'rebase_in_progress' ? 'merge' : 'none') as 'merge' | 'apply' | 'none',
    cherryPick: false,
    revert: false,
    bisect: false,
  };
}
