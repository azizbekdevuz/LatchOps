/**
 * Deterministic, human-readable explanation derived from canonical signals and
 * plan. This is NOT an LLM. It renders the structured, deterministic data into
 * prose. A real natural-language explanation layer (Anthropic) is Phase 8 and
 * is intentionally not implemented here.
 */

import type { RecoveryPlanV1, RepoSignalsV1 } from '@latchops/schema';

export interface DeterministicExplanation {
  source: 'deterministic';
  incidentType: RepoSignalsV1['state'];
  risk: RecoveryPlanV1['risk'];
  headline: string;
  summary: string;
  reasons: string[];
  warnings: string[];
  manualReviewRequired: boolean;
  recommendedAction: string | null;
}

const HEADLINES: Record<RepoSignalsV1['state'], string> = {
  clean: 'Repository is clean',
  dirty_worktree: 'Uncommitted changes in the working tree',
  merge_conflict: 'Merge conflicts need resolution',
  detached_head: 'HEAD is detached',
  rebase_in_progress: 'A rebase is in progress',
  unknown: 'Repository state needs manual review',
};

export function deterministicExplanation(
  signals: RepoSignalsV1,
  plan: RecoveryPlanV1,
): DeterministicExplanation {
  const recommended =
    plan.alternatives.find((a) => a.recommended) ?? plan.alternatives[0] ?? null;

  return {
    source: 'deterministic',
    incidentType: signals.state,
    risk: plan.risk,
    headline: HEADLINES[signals.state] ?? HEADLINES.unknown,
    summary: plan.summary,
    reasons: signals.reasons,
    warnings: plan.warnings,
    manualReviewRequired: plan.manualReviewRequired,
    recommendedAction: recommended ? recommended.title : plan.steps[0]?.title ?? null,
  };
}
