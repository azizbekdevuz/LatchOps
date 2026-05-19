import type { SnapshotV1, PlanV1, VerificationResult, Signals } from '@latchops/schema';
import { VerificationResultSchema } from '@latchops/schema';
import { collectSignals } from './collector';
import { callLLMWithJSON } from '../llm';

/**
 * Verifier stage: Compare new snapshot against plan to determine progress.
 */
export async function verifyProgress(
  newSnapshot: SnapshotV1,
  originalSignals: Signals,
  plan: PlanV1
): Promise<VerificationResult> {
  const newSignals = collectSignals(newSnapshot);

  // Quick check: is the issue resolved?
  const issueResolved = checkIssueResolved(originalSignals, newSignals);

  if (issueResolved) {
    return {
      stepsCompleted: plan.steps.map(s => s.id),
      issueResolved: true,
      remainingIssues: [],
      guidance: 'The issue has been resolved. Your repository is in a clean state.',
    };
  }

  // Use LLM to provide more detailed guidance
  const prompt = buildVerifierPrompt(originalSignals, newSignals, plan);

  return callLLMWithJSON(prompt, (data) => VerificationResultSchema.parse(data));
}

function checkIssueResolved(original: Signals, current: Signals): boolean {
  switch (original.primaryIssue) {
    case 'merge_conflict':
      return !current.hasConflicts;

    case 'detached_head':
      return !current.isDetachedHead;

    case 'rebase_in_progress':
      return !current.isRebaseInProgress;

    default:
      return false;
  }
}

function buildVerifierPrompt(
  original: Signals,
  current: Signals,
  plan: PlanV1
): string {
  return `You are LatchOps, verifying recovery progress.

Original Issue: ${original.primaryIssue}
Original State:
- Conflicts: ${original.conflictCount}
- Detached HEAD: ${original.isDetachedHead}
- Rebase in progress: ${original.isRebaseInProgress}

Current State:
- Conflicts: ${current.conflictCount}
- Detached HEAD: ${current.isDetachedHead}
- Rebase in progress: ${current.isRebaseInProgress}
- Has staged changes: ${current.hasStagedChanges}
- Has unstaged changes: ${current.hasUnstagedChanges}

Plan Steps:
${plan.steps.map((s, i) => `${i + 1}. ${s.id}: ${s.title}`).join('\n')}

Analyze the progress and respond with JSON:
{
  "stepsCompleted": ["step-1", "step-2"],
  "issueResolved": false,
  "remainingIssues": ["description of remaining issues"],
  "nextStepId": "step-3",
  "guidance": "Clear guidance on what to do next"
}

Be specific about which steps appear completed based on state changes.
Output only valid JSON.`;
}
