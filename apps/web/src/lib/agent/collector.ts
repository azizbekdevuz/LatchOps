import type { SnapshotV1, Signals } from '@latchops/schema';
import { SignalsSchema } from '@latchops/schema';

/**
 * Collector stage: Normalize snapshot into signals.
 * This is deterministic - no LLM needed.
 */
export function collectSignals(snapshot: SnapshotV1): Signals {
  // Extract recent checkouts from reflog
  const recentCheckouts = snapshot.recentReflog
    .filter(entry => entry.action === 'checkout')
    .map(entry => {
      const match = entry.message.match(/moving from (\S+) to (\S+)/);
      return {
        from: match?.[1] || 'unknown',
        to: match?.[2] || 'unknown',
        reflogSelector: entry.selector,
      };
    })
    .slice(0, 5);

  // Extract recent resets from reflog
  const recentResets = snapshot.recentReflog
    .filter(entry => entry.action.includes('reset'))
    .map(entry => {
      const typeMatch = entry.action.match(/reset: moving to/);
      return {
        type: typeMatch ? 'mixed' : 'unknown',
        target: entry.hash,
        reflogSelector: entry.selector,
      };
    })
    .slice(0, 5);

  // Determine primary issue
  let primaryIssue: Signals['primaryIssue'] = 'unknown';
  const secondaryIssues: Signals['primaryIssue'][] = [];

  if (snapshot.unmergedFiles.length > 0) {
    primaryIssue = 'merge_conflict';
  } else if (snapshot.rebaseState.inProgress) {
    primaryIssue = 'rebase_in_progress';
  } else if (snapshot.isDetachedHead) {
    primaryIssue = 'detached_head';
  }

  // Check for secondary issues
  if (primaryIssue !== 'merge_conflict' && snapshot.unmergedFiles.length > 0) {
    secondaryIssues.push('merge_conflict');
  }
  if (primaryIssue !== 'rebase_in_progress' && snapshot.rebaseState.inProgress) {
    secondaryIssues.push('rebase_in_progress');
  }
  if (primaryIssue !== 'detached_head' && snapshot.isDetachedHead) {
    secondaryIssues.push('detached_head');
  }

  // Estimate risk
  let estimatedRisk: Signals['estimatedRisk'] = 'low';
  if (snapshot.unmergedFiles.length > 2 || snapshot.rebaseState.inProgress) {
    estimatedRisk = 'medium';
  }
  if (snapshot.isDetachedHead && snapshot.stagedFiles.length > 0) {
    estimatedRisk = 'high'; // Risk of losing uncommitted work
  }

  const signals: Signals = {
    hasConflicts: snapshot.unmergedFiles.length > 0,
    conflictCount: snapshot.unmergedFiles.length,
    conflictFiles: snapshot.unmergedFiles.map(f => f.path),

    isDetachedHead: snapshot.isDetachedHead,
    detachedAt: snapshot.isDetachedHead ? snapshot.branch.oid : undefined,

    isRebaseInProgress: snapshot.rebaseState.inProgress,
    rebaseType: snapshot.rebaseState.type,
    rebaseOnto: snapshot.rebaseState.onto,

    currentBranch: snapshot.branch.head,
    upstreamBranch: snapshot.branch.upstream,
    aheadCount: snapshot.branch.aheadBehind?.ahead || 0,
    behindCount: snapshot.branch.aheadBehind?.behind || 0,

    hasStagedChanges: snapshot.stagedFiles.length > 0,
    hasUnstagedChanges: snapshot.modifiedFiles.length > 0,
    hasUntrackedFiles: snapshot.untrackedFiles.length > 0,

    recentCheckouts,
    recentResets,

    primaryIssue,
    secondaryIssues,
    estimatedRisk,
  };

  // Validate with Zod
  return SignalsSchema.parse(signals);
}
