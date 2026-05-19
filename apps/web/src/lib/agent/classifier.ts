import type { Signals, IssueType, RiskLevel } from '@latchops/schema';
import { IssueTypeSchema, RiskLevelSchema } from '@latchops/schema';
import { callLLMWithJSON } from '../llm';
import { z } from 'zod';

const ClassificationResultSchema = z.object({
  primaryIssue: IssueTypeSchema,
  secondaryIssues: z.array(IssueTypeSchema),
  estimatedRisk: RiskLevelSchema,
  reasoning: z.string().optional(),
});

type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

/**
 * Classifier stage: Confirm/refine issue classification using LLM.
 * The collector already does basic classification, this refines it.
 */
export async function classifyIssue(signals: Signals): Promise<ClassificationResult> {
  // For simple cases, skip LLM and use collector's classification
  if (signals.primaryIssue !== 'unknown') {
    return {
      primaryIssue: signals.primaryIssue,
      secondaryIssues: signals.secondaryIssues,
      estimatedRisk: signals.estimatedRisk,
    };
  }

  // Use LLM for ambiguous cases
  const prompt = buildClassificationPrompt(signals);

  return callLLMWithJSON(prompt, (data) => ClassificationResultSchema.parse(data));
}

function buildClassificationPrompt(signals: Signals): string {
  return `You are a git recovery assistant. Classify the following git repository state.

Repository State:
- Has conflicts: ${signals.hasConflicts} (${signals.conflictCount} files)
- Is detached HEAD: ${signals.isDetachedHead}
- Rebase in progress: ${signals.isRebaseInProgress} (type: ${signals.rebaseType})
- Current branch: ${signals.currentBranch}
- Has staged changes: ${signals.hasStagedChanges}
- Has unstaged changes: ${signals.hasUnstagedChanges}
- Ahead/behind: +${signals.aheadCount}/-${signals.behindCount}

Respond with a JSON object:
{
  "primaryIssue": "merge_conflict" | "detached_head" | "rebase_in_progress" | "unknown",
  "secondaryIssues": [...],
  "estimatedRisk": "low" | "medium" | "high"
}

Risk levels:
- low: Simple resolution, low chance of data loss
- medium: Requires careful steps, moderate complexity
- high: Risk of losing uncommitted work, needs careful handling

Output only valid JSON.`;
}
