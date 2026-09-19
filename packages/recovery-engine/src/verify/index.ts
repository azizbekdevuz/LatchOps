import type {
  ChangedSignalV1,
  IncidentTypeV1,
  RecoveryPlanV1,
  RepoSignalsV1,
  VerificationResultV1,
  VerificationStatusV1,
} from '@latchops/schema';
import { VerificationResultV1Schema } from '@latchops/schema';
import { resolveSignalField } from './signal-checks.js';

export { evaluateSignalCheck, resolveSignalField } from './signal-checks.js';

export interface VerifyInput {
  incidentType: IncidentTypeV1;
  before: RepoSignalsV1;
  after: RepoSignalsV1;
  plan: RecoveryPlanV1;
  selectedAlternativeId?: string | null;
  now?: Date;
}

/** Signal fields compared to describe what changed between before and after. */
const TRACKED_FIELDS = [
  'state',
  'branch.isDetached',
  'branch.name',
  'branch.oid',
  'worktree.isDirty',
  'worktree.staged',
  'worktree.modified',
  'worktree.untracked',
  'worktree.conflicted',
  'operations.merge',
  'operations.rebase',
  'operations.cherryPick',
  'operations.revert',
  'operations.bisect',
] as const;

interface Assessment {
  status: VerificationStatusV1;
  reasons: string[];
  remainingIssues: string[];
}

/**
 * Deterministically verify recovery progress by comparing before/after signals
 * against the selected plan/alternative. No LLM narratives; reasons are derived
 * from concrete signal transitions.
 */
export function verifyRecovery(input: VerifyInput): VerificationResultV1 {
  const { before, after, plan } = input;
  const selectedAlternativeId = input.selectedAlternativeId ?? null;
  const changedSignals = diffSignals(before, after);

  const assessment = assess(input, changedSignals.length === 0);

  const result: VerificationResultV1 = {
    version: 1,
    status: assessment.status,
    incidentType: plan.incidentType,
    selectedAlternativeId,
    beforeState: before.state,
    afterState: after.state,
    reasons: assessment.reasons,
    changedSignals,
    remainingIssues: assessment.remainingIssues,
    checkedAt: (input.now ?? new Date()).toISOString(),
  };

  return VerificationResultV1Schema.parse(result);
}

function diffSignals(before: RepoSignalsV1, after: RepoSignalsV1): ChangedSignalV1[] {
  const changed: ChangedSignalV1[] = [];
  for (const field of TRACKED_FIELDS) {
    const b = resolveSignalField(before, field);
    const a = resolveSignalField(after, field);
    if (!Object.is(b, a)) {
      changed.push({ field, before: b, after: a });
    }
  }
  return changed;
}

function assess(input: VerifyInput, noChange: boolean): Assessment {
  const { after, plan } = input;
  const alt = input.selectedAlternativeId ?? null;

  switch (plan.incidentType) {
    case 'clean': {
      if (after.state === 'clean') {
        return { status: 'succeeded', reasons: ['Repository remains clean.'], remainingIssues: [] };
      }
      return {
        status: 'failed',
        reasons: ['Repository is no longer clean; unexpected changes appeared.'],
        remainingIssues: after.reasons,
      };
    }

    case 'dirty_worktree': {
      if (noChange) {
        return {
          status: 'not_started',
          reasons: ['No signal changes since the plan was generated.'],
          remainingIssues: ['Working tree still has pending changes.'],
        };
      }
      if (alt === 'patch' || alt === 'review') {
        return {
          status: 'manual_review',
          reasons: [
            'Patch/review preservation is not observable from repository signals. Confirm the patch file exists on disk.',
          ],
          remainingIssues: [],
        };
      }
      if (after.worktree.isDirty === false) {
        return {
          status: 'succeeded',
          reasons: ['Working tree is clean; pending work was preserved (stash/commit) or resolved.'],
          remainingIssues: [],
        };
      }
      return {
        status: 'in_progress',
        reasons: ['Working tree changed but still has pending changes.'],
        remainingIssues: describeDirty(after),
      };
    }

    case 'merge_conflict': {
      if (noChange) {
        return {
          status: 'not_started',
          reasons: ['No signal changes since the plan was generated; merge still in progress.'],
          remainingIssues: ['Merge is still active with unresolved conflicts.'],
        };
      }
      const mergeGone = after.operations.merge === false;
      const noConflicts = after.worktree.conflicted === 0;
      if (mergeGone && noConflicts) {
        return {
          status: 'succeeded',
          reasons: ['MERGE_HEAD removed and no unmerged paths remain.'],
          remainingIssues: [],
        };
      }
      if (mergeGone && !noConflicts) {
        return {
          status: 'manual_review',
          reasons: ['Merge is no longer active but conflicted paths remain — unexpected state.'],
          remainingIssues: [`${after.worktree.conflicted} conflicted path(s) remain.`],
        };
      }
      return {
        status: 'in_progress',
        reasons: ['Merge is still active; conflicts are being resolved.'],
        remainingIssues: [`${after.worktree.conflicted} conflicted path(s) remain.`],
      };
    }

    case 'detached_head': {
      if (noChange) {
        return {
          status: 'not_started',
          reasons: ['No signal changes since the plan was generated; HEAD still detached.'],
          remainingIssues: ['HEAD is still detached.'],
        };
      }
      if (after.branch.isDetached === false) {
        const oid = input.before.branch.oid;
        return {
          status: 'succeeded',
          reasons: [
            `HEAD is attached${after.branch.name ? ` to ${after.branch.name}` : ''}.`,
          ],
          // Reachability is not derivable from signals alone; surface it as a
          // read-only confirmation rather than over-claiming.
          remainingIssues: oid
            ? [`Confirm the original commit ${oid.slice(0, 8)} is still reachable (git branch --contains ${oid.slice(0, 8)}).`]
            : [],
        };
      }
      return {
        status: 'in_progress',
        reasons: ['HEAD is still detached.'],
        remainingIssues: ['HEAD is not yet attached to a branch.'],
      };
    }

    case 'rebase_in_progress': {
      if (noChange) {
        return {
          status: 'not_started',
          reasons: ['No signal changes since the plan was generated; rebase still in progress.'],
          remainingIssues: ['Rebase is still in progress.'],
        };
      }
      if (after.operations.rebase === false) {
        const note =
          alt === 'skip_commit'
            ? 'Rebase advanced; the skipped commit was intentionally omitted.'
            : 'Rebase metadata is gone (completed or aborted).';
        return { status: 'succeeded', reasons: [note], remainingIssues: [] };
      }
      return {
        status: 'in_progress',
        reasons: ['Rebase is still in progress.'],
        remainingIssues: after.worktree.conflicted > 0
          ? [`${after.worktree.conflicted} conflicted path(s) remain in the rebase.`]
          : ['Rebase has not completed yet.'],
      };
    }

    case 'unknown':
    default: {
      return {
        status: 'manual_review',
        reasons: ['Unknown incident type cannot be verified automatically; manual review required.'],
        remainingIssues: after.reasons,
      };
    }
  }
}

function describeDirty(signals: RepoSignalsV1): string[] {
  const out: string[] = [];
  const w = signals.worktree;
  if (w.staged > 0) out.push(`${w.staged} staged`);
  if (w.modified > 0) out.push(`${w.modified} modified`);
  if (w.untracked > 0) out.push(`${w.untracked} untracked`);
  if (w.conflicted > 0) out.push(`${w.conflicted} conflicted`);
  return out;
}
