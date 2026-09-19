import type { RecoveryPlanV1 } from '@latchops/schema';
import { RecoveryPlanV1Schema } from '@latchops/schema';
import { ENGINE_VERSION } from '../version.js';
import { planClean } from './clean.js';
import { planDetachedHead } from './detached-head.js';
import { planDirtyWorktree } from './dirty-worktree.js';
import { planMergeConflict } from './merge-conflict.js';
import { planRebaseInProgress } from './rebase-in-progress.js';
import { planSequencerOperation } from './sequencer-operation.js';
import { planUnknown } from './unknown.js';
import type { PlanBody, PlanInput } from './helpers.js';

export type { PlanInput, PlanBody } from './helpers.js';

/** Options controlling plan generation. */
export interface GeneratePlanOptions {
  /** Fixed timestamp (for deterministic output/testing). Defaults to now. */
  now?: Date;
}

const TEMPLATES: Record<PlanInput['signals']['state'], (input: PlanInput) => PlanBody> = {
  clean: planClean,
  dirty_worktree: planDirtyWorktree,
  merge_conflict: planMergeConflict,
  detached_head: planDetachedHead,
  rebase_in_progress: planRebaseInProgress,
  unknown: planUnknown,
};

/**
 * Choose the incident to plan for from the operation signals rather than the
 * primary display state. The state engine ranks `merge_conflict` above
 * `rebase_in_progress` for display, so a conflicted rebase surfaces as
 * `merge_conflict` (primary) with `rebase_in_progress` as a secondary. Recovery
 * for a conflicted rebase is the rebase plan (continue/abort/skip), never a
 * merge plan — so route on `operations.rebase` first.
 */
export function selectIncidentType(signals: PlanInput['signals']): PlanInput['signals']['state'] {
  if (signals.operations.rebase) return 'rebase_in_progress';
  return signals.state;
}

/**
 * Route to the correct plan generator. Operation signals take precedence over
 * the primary display `state` so we never emit a command for the wrong Git
 * operation:
 *   1. rebase          → rebase plan (continue/abort/skip)
 *   2. cherry-pick / revert / bisect → sequencer plan (operation-correct only)
 *   3. conflicts with no active merge → manual-review (no `git merge --abort`)
 *   4. otherwise the primary state's template.
 */
function selectPlanGenerator(signals: PlanInput['signals']): (input: PlanInput) => PlanBody {
  const ops = signals.operations;
  if (ops.rebase) return planRebaseInProgress;
  if (ops.cherryPick || ops.revert || ops.bisect) return planSequencerOperation;
  if (signals.state === 'merge_conflict' && !ops.merge) return planSequencerOperation;
  return TEMPLATES[signals.state];
}

/**
 * Deterministically generate a recovery plan from canonical repository signals
 * plus the snapshot they were derived from. Never executes anything; never
 * calls an LLM. Output is validated against `RecoveryPlanV1Schema`.
 */
export function generateRecoveryPlan(
  input: PlanInput,
  options: GeneratePlanOptions = {},
): RecoveryPlanV1 {
  const generator = selectPlanGenerator(input.signals);
  const body = generator(input);
  const generatedAt = (options.now ?? new Date()).toISOString();

  const plan: RecoveryPlanV1 = {
    version: 1,
    generatedAt,
    generatedBy: 'deterministic_engine',
    engineVersion: ENGINE_VERSION,
    ...body,
  };

  return RecoveryPlanV1Schema.parse(plan);
}
