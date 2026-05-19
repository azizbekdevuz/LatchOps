import { execGit } from '../utils/exec.js';

export interface GitInfo {
  repoRoot: string;
  gitDir: string;
  status: string;
  branches: string;
  log: string;
  reflog: string;
  commitGraph: string;
  diffStat: string;
  mergeHead: string | null;
  mergeMessage: string | null;
}

/**
 * Collect all git information needed for snapshot.
 * Uses only git commands - no direct file system access to .git
 */
export async function collectGitInfo(): Promise<GitInfo> {
  // Get repo root
  const repoRootResult = execGit(['rev-parse', '--show-toplevel']);
  if (!repoRootResult.success) {
    throw new Error('Not a git repository (or any of the parent directories)');
  }
  const repoRoot = repoRootResult.stdout.trim();

  // Get git directory (handles worktrees correctly)
  const gitDirResult = execGit(['rev-parse', '--git-dir']);
  if (!gitDirResult.success) {
    throw new Error('Could not determine git directory');
  }
  const gitDir = gitDirResult.stdout.trim();

  // Get status with porcelain v2 format
  const statusResult = execGit(['status', '--porcelain=v2', '--branch']);
  const status = statusResult.stdout;

  // Get branches with verbose info
  const branchesResult = execGit(['branch', '-vv']);
  const branches = branchesResult.stdout;

  // Get recent log
  const logResult = execGit(['log', '--oneline', '--decorate', '-n', '30']);
  const log = logResult.stdout;

  // Get reflog
  const reflogResult = execGit(['reflog', '-n', '30']);
  const reflog = reflogResult.stdout;

  // NEW: Get commit graph for visualization
  const graphResult = execGit(['log', '--graph', '--oneline', '--decorate', '--all', '-n', '30']);
  const commitGraph = graphResult.stdout;

  // NEW: Get diff stat for file summary
  const diffStatResult = execGit(['diff', '--stat', '--numstat']);
  const diffStat = diffStatResult.stdout;

  // NEW: Check for MERGE_HEAD (indicates we're in a merge)
  const mergeHeadResult = execGit(['rev-parse', 'MERGE_HEAD']);
  const mergeHead = mergeHeadResult.success ? mergeHeadResult.stdout.trim() : null;

  // NEW: Get merge message if available
  let mergeMessage: string | null = null;
  if (mergeHead) {
    const msgResult = execGit(['log', '-1', '--format=%B', 'MERGE_HEAD']);
    mergeMessage = msgResult.success ? msgResult.stdout.trim() : null;
  }

  return {
    repoRoot,
    gitDir,
    status,
    branches,
    log,
    reflog,
    commitGraph,
    diffStat,
    mergeHead,
    mergeMessage,
  };
}
