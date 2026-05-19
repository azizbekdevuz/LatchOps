import type { SnapshotV1, Signals, PlanV1 } from '@latchops/schema';
import { PlanV1Schema } from '@latchops/schema';
import { callLLMWithJSON } from '../llm';

/**
 * Planner stage: Generate recovery plan based on signals.
 */
export async function generatePlan(
  snapshot: SnapshotV1,
  signals: Signals,
  dangerousAllowed: boolean = false
): Promise<PlanV1> {
  const prompt = buildPlannerPrompt(snapshot, signals, dangerousAllowed);

  return callLLMWithJSON(prompt, (data) => PlanV1Schema.parse(data));
}

function buildPlannerPrompt(
  snapshot: SnapshotV1,
  signals: Signals,
  dangerousAllowed: boolean
): string {
  const issueContext = getIssueContext(snapshot, signals);

  return `You are LatchOps, a safe git recovery assistant. Generate a recovery plan.

CRITICAL RULES:
1. NEVER suggest destructive actions without explicit undo paths
2. Every step MUST have an undo option using reflog or other means
3. If dangerous operations are needed and dangerousAllowed is false, provide safer alternatives
4. Always include reflog recovery as a fallback

Issue Type: ${signals.primaryIssue}
Risk Level: ${signals.estimatedRisk}
Dangerous Operations Allowed: ${dangerousAllowed}

${issueContext}

Recent Reflog (for recovery reference):
${snapshot.recentReflog.slice(0, 10).map(e => `${e.selector}: ${e.action} - ${e.message}`).join('\n')}

Generate a JSON recovery plan with this structure:
{
  "version": 1,
  "timestamp": "<ISO timestamp>",
  "issueType": "${signals.primaryIssue}",
  "issueSummary": "<1-2 sentence description of the issue>",
  "risk": "${signals.estimatedRisk}",
  "steps": [
    {
      "id": "step-1",
      "title": "<short title>",
      "description": "<what this step does>",
      "commands": ["git command 1", "git command 2"],
      "expected": "<what should happen after>",
      "undo": {
        "possible": true,
        "commands": ["undo command"],
        "description": "<how to undo>"
      },
      "dangerous": false,
      "warning": "<optional warning for dangerous steps>",
      "requiresUserInput": false,
      "userInputHint": "<optional hint for user input>"
    }
  ],
  "saferAlternatives": [<optional array if dangerous steps are suggested>],
  "reflogRecovery": {
    "description": "<how to use reflog to recover>",
    "relevantEntries": ["HEAD@{N}"],
    "recoveryCommand": "git reset --hard HEAD@{N}"
  }
}

Output only valid JSON.`;
}

function getIssueContext(snapshot: SnapshotV1, signals: Signals): string {
  const parts: string[] = [];

  if (signals.primaryIssue === 'merge_conflict') {
    parts.push(`MERGE CONFLICT DETECTED`);
    parts.push(`Conflicting files (${signals.conflictCount}):`);
    for (const file of snapshot.unmergedFiles) {
      parts.push(`  - ${file.path} (${file.conflictBlocks.length} conflict blocks)`);
      if (file.conflictBlocks.length > 0) {
        const block = file.conflictBlocks[0];
        parts.push(`    Lines ${block.startLine}-${block.endLine}`);
      }
    }
  }

  if (signals.primaryIssue === 'detached_head') {
    parts.push(`DETACHED HEAD STATE`);
    parts.push(`Current commit: ${signals.detachedAt}`);
    parts.push(`Has uncommitted changes: ${signals.hasStagedChanges || signals.hasUnstagedChanges}`);

    if (signals.recentCheckouts.length > 0) {
      parts.push(`Recent checkouts:`);
      for (const checkout of signals.recentCheckouts.slice(0, 3)) {
        parts.push(`  ${checkout.reflogSelector}: ${checkout.from} -> ${checkout.to}`);
      }
    }
  }

  if (signals.primaryIssue === 'rebase_in_progress') {
    parts.push(`REBASE IN PROGRESS`);
    parts.push(`Rebase type: ${signals.rebaseType}`);
    if (snapshot.rebaseState.headName) {
      parts.push(`Original branch: ${snapshot.rebaseState.headName}`);
    }
    if (snapshot.rebaseState.onto) {
      parts.push(`Rebasing onto: ${snapshot.rebaseState.onto}`);
    }
    if (snapshot.rebaseState.currentStep && snapshot.rebaseState.totalSteps) {
      parts.push(`Progress: ${snapshot.rebaseState.currentStep}/${snapshot.rebaseState.totalSteps}`);
    }
  }

  parts.push('');
  parts.push(`Current branch: ${snapshot.branch.head}`);
  if (snapshot.branch.upstream) {
    parts.push(`Upstream: ${snapshot.branch.upstream}`);
  }

  return parts.join('\n');
}
