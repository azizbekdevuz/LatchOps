/**
 * Utility functions for snapshot ingestion
 */

interface SnapshotForTitle {
  branch: { head: string };
  isDetachedHead: boolean;
  unmergedFiles: unknown[];
  rebaseState: { inProgress: boolean };
}

export interface AgentAnalysis {
  issueType: string;
  summary: string;
  repoGraph?: {
    nodes: Array<{ id: string; type: string; label: string; sha?: string; isCurrent?: boolean }>;
    edges: Array<{ from: string; to: string; type?: string }>;
  };
  conflicts?: Array<{
    path: string;
    highLevelSummary?: string;
    hunks: Array<{
      index: number;
      startLine?: number;
      endLine?: number;
      baseText: string;
      oursText: string;
      theirsText: string;
      explanation?: string;
      suggestedChoice?: string;
      suggestedContent?: string;
    }>;
  }>;
  plan: Array<{
    index: number;
    title: string;
    rationale?: string;
    commands: string[];
    verify: string[];
    undo: string[];
    dangerLevel: string;
  }>;
}

export function generateTitle(snapshot: SnapshotForTitle): string {
  const parts: string[] = [];

  if (snapshot.unmergedFiles.length > 0) {
    parts.push('Merge Conflict');
  } else if (snapshot.rebaseState.inProgress) {
    parts.push('Rebase');
  } else if (snapshot.isDetachedHead) {
    parts.push('Detached HEAD');
  }

  parts.push(`on ${snapshot.branch.head}`);

  return parts.join(' ') || 'Git Recovery Session';
}

export 
interface SnapshotForFallback {
  unmergedFiles: Array<{ path: string; conflictBlocks?: Array<{ oursContent: string; theirsContent: string; context?: string }> }>;
  isDetachedHead: boolean;
  rebaseState: { inProgress: boolean };
  branch: { head: string };
}

export function generateFallbackAnalysis(snapshot: SnapshotForFallback): { success: boolean; analysis: AgentAnalysis } {
  let issueType = 'unknown';
  let summary = 'Repository state analysis';

  if (snapshot.unmergedFiles.length > 0) {
    issueType = 'merge_conflict';
    summary = `Found ${snapshot.unmergedFiles.length} file(s) with merge conflicts. Review each conflict and choose how to resolve.`;
  } else if (snapshot.rebaseState.inProgress) {
    issueType = 'rebase_in_progress';
    summary = 'A rebase operation is in progress. You can continue, skip, or abort.';
  } else if (snapshot.isDetachedHead) {
    issueType = 'detached_head';
    summary = 'HEAD is detached. Consider creating a branch to save your work.';
  } else {
    issueType = 'clean';
    summary = 'Repository appears to be in a clean state.';
  }

  // Extract conflicts
  const conflicts = snapshot.unmergedFiles.map((file) => ({
    path: file.path,
    hunks: (file.conflictBlocks || []).map((block, i) => ({
      index: i,
      baseText: block.context || '',
      oursText: block.oursContent || '',
      theirsText: block.theirsContent || '',
    })),
  }));

  // Generate basic plan
  const plan: AgentAnalysis['plan'] = [];

  if (issueType === 'merge_conflict') {
    plan.push(
      {
        index: 0,
        title: 'Review conflicts',
        rationale: 'Understand what changes conflict before resolving',
        commands: ['git status', 'git diff --name-only --diff-filter=U'],
        verify: ['git status'],
        undo: [],
        dangerLevel: 'safe',
      },
      {
        index: 1,
        title: 'Resolve each conflict',
        rationale: 'Edit files to remove conflict markers and choose correct content',
        commands: ['# Edit files manually or use the Conflict Explorer'],
        verify: ['git diff <file>'],
        undo: ['git checkout --conflict=merge <file>'],
        dangerLevel: 'safe',
      },
      {
        index: 2,
        title: 'Stage resolved files',
        rationale: 'Mark conflicts as resolved',
        commands: ['git add <files>'],
        verify: ['git status'],
        undo: ['git reset HEAD <files>'],
        dangerLevel: 'safe',
      },
      {
        index: 3,
        title: 'Complete merge',
        rationale: 'Commit the merge',
        commands: ['git commit'],
        verify: ['git log -1'],
        undo: ['git reset --soft HEAD~1'],
        dangerLevel: 'caution',
      }
    );
  } else if (issueType === 'detached_head') {
    plan.push(
      {
        index: 0,
        title: 'Check current state',
        rationale: 'Understand where HEAD is pointing',
        commands: ['git log --oneline -5', 'git status'],
        verify: [],
        undo: [],
        dangerLevel: 'safe',
      },
      {
        index: 1,
        title: 'Create branch to save work',
        rationale: 'Preserve commits before switching',
        commands: ['git branch temp-save'],
        verify: ['git branch'],
        undo: ['git branch -d temp-save'],
        dangerLevel: 'safe',
      },
      {
        index: 2,
        title: 'Return to main branch',
        rationale: 'Switch back to your working branch',
        commands: [`git checkout ${snapshot.branch.head}`],
        verify: ['git status'],
        undo: [],
        dangerLevel: 'safe',
      }
    );
  } else if (issueType === 'rebase_in_progress') {
    plan.push(
      {
        index: 0,
        title: 'Check rebase status',
        rationale: 'Understand the current rebase state',
        commands: ['git status'],
        verify: [],
        undo: [],
        dangerLevel: 'safe',
      },
      {
        index: 1,
        title: 'Option A: Continue rebase',
        rationale: 'If conflicts are resolved, continue',
        commands: ['git add .', 'git rebase --continue'],
        verify: ['git status'],
        undo: ['git rebase --abort'],
        dangerLevel: 'caution',
      },
      {
        index: 2,
        title: 'Option B: Abort rebase',
        rationale: 'Cancel and return to previous state',
        commands: ['git rebase --abort'],
        verify: ['git log -3'],
        undo: [],
        dangerLevel: 'safe',
      }
    );
  }

  return {
    success: true,
    analysis: {
      issueType,
      summary,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      plan,
    },
  };
}

