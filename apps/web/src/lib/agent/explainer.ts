import type { SnapshotV1, ConflictBlock, UnmergedFile } from '@latchops/schema';
import { callLLM } from '../llm';

export interface ConflictExplanation {
  filePath: string;
  blockIndex: number;
  whatOursChanged: string;
  whatTheirsChanged: string;
  whyConflict: string;
  conflictType: 'logic' | 'config' | 'formatting' | 'structural' | 'dependency' | 'mixed';
  suggestedStrategy: string;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface StateExplanation {
  currentState: string;
  whyStopped: string;
  continueImplications: string;
  abortImplications: string;
  safeActions: string[];
  unsafeActions: string[];
}

/**
 * Visual Explainer stage: Generate contextual explanation for a specific conflict.
 */
export async function explainConflict(
  file: UnmergedFile,
  block: ConflictBlock,
  blockIndex: number,
  snapshot: SnapshotV1
): Promise<ConflictExplanation> {
  const prompt = buildConflictExplainerPrompt(file, block, snapshot);

  try {
    const response = await callLLM(prompt);
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const jsonStr = jsonMatch[1]?.trim() || response.trim();
    const parsed = JSON.parse(jsonStr);

    return {
      filePath: file.path,
      blockIndex,
      whatOursChanged: parsed.whatOursChanged || 'Unable to determine',
      whatTheirsChanged: parsed.whatTheirsChanged || 'Unable to determine',
      whyConflict: parsed.whyConflict || 'Git could not automatically merge these changes',
      conflictType: parsed.conflictType || 'mixed',
      suggestedStrategy: parsed.suggestedStrategy || 'Review both changes carefully and combine manually',
      complexity: parsed.complexity || 'moderate',
    };
  } catch {
    return {
      filePath: file.path,
      blockIndex,
      whatOursChanged: 'Analysis unavailable',
      whatTheirsChanged: 'Analysis unavailable',
      whyConflict: 'Unable to analyze conflict automatically',
      conflictType: 'mixed',
      suggestedStrategy: 'Review both changes manually',
      complexity: 'moderate',
    };
  }
}

/**
 * Visual Explainer stage: Generate explanation for repo state (detached HEAD, rebase).
 */
export async function explainState(snapshot: SnapshotV1): Promise<StateExplanation> {
  const prompt = buildStateExplainerPrompt(snapshot);

  try {
    const response = await callLLM(prompt);
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, response];
    const jsonStr = jsonMatch[1]?.trim() || response.trim();
    const parsed = JSON.parse(jsonStr);

    return {
      currentState: parsed.currentState || 'Unknown state',
      whyStopped: parsed.whyStopped || 'Unable to determine',
      continueImplications: parsed.continueImplications || 'Continue with current operation',
      abortImplications: parsed.abortImplications || 'Abort and return to previous state',
      safeActions: parsed.safeActions || [],
      unsafeActions: parsed.unsafeActions || [],
    };
  } catch {
    return {
      currentState: getBasicStateDescription(snapshot),
      whyStopped: 'Unable to analyze state automatically',
      continueImplications: 'Analysis unavailable',
      abortImplications: 'Analysis unavailable',
      safeActions: ['Review current state with git status'],
      unsafeActions: [],
    };
  }
}

function buildConflictExplainerPrompt(
  file: UnmergedFile,
  block: ConflictBlock,
  snapshot: SnapshotV1
): string {
  return `You are LatchOps, analyzing a specific Git merge conflict to help the user understand it.

FILE: ${file.path}
CONFLICT LOCATION: Lines ${block.startLine}-${block.endLine}

=== OURS (Current branch: ${snapshot.branch.head}) ===
${block.oursContent}

=== THEIRS (Incoming changes${snapshot.mergeHead ? ' from ' + snapshot.mergeHead.slice(0, 8) : ''}) ===
${block.theirsContent}

=== CONTEXT ===
${block.context}

Analyze this specific conflict and provide a contextual explanation.
DO NOT give generic Git theory - explain THIS specific conflict.

Return JSON:
{
  "whatOursChanged": "<what the current branch's version does/contains>",
  "whatTheirsChanged": "<what the incoming version does/contains>",
  "whyConflict": "<why Git couldn't merge automatically - be specific>",
  "conflictType": "<one of: logic|config|formatting|structural|dependency|mixed>",
  "suggestedStrategy": "<specific strategy to resolve THIS conflict>",
  "complexity": "<simple|moderate|complex>"
}

Output only valid JSON.`;
}

function buildStateExplainerPrompt(snapshot: SnapshotV1): string {
  const rebaseInfo = snapshot.rebaseState.inProgress
    ? `Rebase Type: ${snapshot.rebaseState.type}
Original Branch: ${snapshot.rebaseState.headName || 'unknown'}
Onto: ${snapshot.rebaseState.onto || 'unknown'}
Progress: ${snapshot.rebaseState.currentStep || '?'}/${snapshot.rebaseState.totalSteps || '?'}`
    : 'No rebase in progress';

  const detachedInfo = snapshot.isDetachedHead
    ? `Detached at: ${snapshot.branch.oid}
Has staged changes: ${snapshot.stagedFiles.length > 0}
Has unstaged changes: ${snapshot.modifiedFiles.length > 0}`
    : 'Not in detached HEAD state';

  const recentActions = snapshot.recentReflog
    .slice(0, 5)
    .map(e => `${e.selector}: ${e.action} - ${e.message}`)
    .join('\n');

  return `You are LatchOps, analyzing a Git repository state to help the user understand where they are and what's safe to do.

CURRENT STATE:
Branch: ${snapshot.branch.head}
Detached HEAD: ${snapshot.isDetachedHead}
${detachedInfo}

REBASE STATE:
${rebaseInfo}

CONFLICTS: ${snapshot.unmergedFiles.length} file(s)

RECENT ACTIONS:
${recentActions}

COMMIT GRAPH:
${snapshot.commitGraph || 'Not available'}

Analyze this state and explain what's happening.
Be specific to THIS situation, not generic Git theory.

Return JSON:
{
  "currentState": "<one sentence describing where the user is>",
  "whyStopped": "<why Git is in this state, what triggered it>",
  "continueImplications": "<what happens if user continues/completes current operation>",
  "abortImplications": "<what happens if user aborts current operation>",
  "safeActions": ["<list of safe things to do now>"],
  "unsafeActions": ["<list of actions that could cause problems>"]
}

Output only valid JSON.`;
}

function getBasicStateDescription(snapshot: SnapshotV1): string {
  if (snapshot.rebaseState.inProgress) {
    return `Rebase in progress (${snapshot.rebaseState.currentStep || '?'}/${snapshot.rebaseState.totalSteps || '?'} steps)`;
  }
  if (snapshot.isDetachedHead) {
    return `Detached HEAD at ${snapshot.branch.oid.slice(0, 8)}`;
  }
  if (snapshot.unmergedFiles.length > 0) {
    return `Merge conflict with ${snapshot.unmergedFiles.length} file(s)`;
  }
  return `On branch ${snapshot.branch.head}`;
}
