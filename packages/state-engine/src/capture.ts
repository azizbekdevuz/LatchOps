import { SnapshotV1Schema, type RepoSignalsV1, type SnapshotV1 } from '@latchops/schema';
import { discoverRepository, type RepositoryContext } from './discovery.js';
import { collectGitOutputs } from './collectors/git-info.js';
import { detectOperationState } from './collectors/operation-state.js';
import { extractConflicts } from './collectors/conflict-extractor.js';
import { parseStatus } from './parsers/status-parser.js';
import { parseLog } from './parsers/log-parser.js';
import { parseReflog } from './parsers/reflog-parser.js';
import { parseDiffStat } from './parsers/diffstat-parser.js';
import { toBranchInfo } from './normalizers/branch.js';
import { computeRepoSignals } from './classifiers/classify.js';
import { collectRemotes } from './collectors/remotes.js';
import { collectRootCommitOid } from './collectors/root-commit.js';

/** Snapshot schema caps history arrays at 30 entries. */
const MAX_HISTORY = 30;
const DEFAULT_MAX_CONFLICT_FILES = 5;

export interface CaptureOptions {
  /** Directory to inspect. May be a nested subdirectory or a linked worktree. */
  cwd?: string;
  /** Per-command timeout in ms. */
  timeoutMs?: number;
  /** How many log/reflog entries to request (still capped at 30 in the snapshot). */
  historyLimit?: number;
  /** Maximum number of unmerged files to extract conflict blocks from. */
  maxConflictFiles?: number;
}

export interface RepoStateResult {
  context: RepositoryContext;
  snapshot: SnapshotV1;
  signals: RepoSignalsV1;
}

function toPlatform(): SnapshotV1['platform'] {
  const p = process.platform;
  if (p === 'win32' || p === 'darwin' || p === 'linux') return p;
  // Snapshot schema only models the three primary desktop/server platforms.
  // Treat other POSIX platforms as linux for classification purposes.
  return 'linux';
}

/**
 * Capture a validated, read-only {@link SnapshotV1} of the repository at
 * `options.cwd`. This is the single entry point the CLI uses; it replaces the
 * previously CLI-local collect/parse/build logic.
 */
export async function captureSnapshot(options: CaptureOptions = {}): Promise<SnapshotV1> {
  const context = await discoverRepository({ cwd: options.cwd });
  return buildSnapshot(context, options);
}

/**
 * Capture a snapshot and its deterministic classification in one call.
 * Useful for `diagnose`-style consumers (added in a later phase) and tests.
 */
export async function captureRepoState(options: CaptureOptions = {}): Promise<RepoStateResult> {
  const context = await discoverRepository({ cwd: options.cwd });
  const snapshot = await buildSnapshot(context, options);
  const signals = computeRepoSignals(snapshot);
  return { context, snapshot, signals };
}

async function buildSnapshot(
  context: RepositoryContext,
  options: CaptureOptions,
): Promise<SnapshotV1> {
  const outputs = await collectGitOutputs(context, {
    timeoutMs: options.timeoutMs,
    historyLimit: options.historyLimit,
  });

  const status = parseStatus(outputs.status);
  const operations = await detectOperationState(context);

  const branch = toBranchInfo(status);
  const recentLog = parseLog(outputs.log).slice(0, MAX_HISTORY);
  const recentReflog = parseReflog(outputs.reflog).slice(0, MAX_HISTORY);
  const diffStats = parseDiffStat(outputs.diffNumstat);
  const [remotes, rootCommitOid] = await Promise.all([
    collectRemotes(context),
    collectRootCommitOid(context),
  ]);

  const unmergedFiles = extractConflicts({
    repoRoot: context.repoRoot,
    unmergedPaths: status.unmergedPaths.slice(0, options.maxConflictFiles ?? DEFAULT_MAX_CONFLICT_FILES),
  });

  const snapshot: SnapshotV1 = {
    version: 1,
    timestamp: new Date().toISOString(),
    platform: toPlatform(),
    repoRoot: context.repoRoot,
    gitDir: context.gitDir,

    branch,
    isDetachedHead: status.isDetachedHead,

    rebaseState: operations.rebase,

    unmergedFiles,
    stagedFiles: status.stagedFiles,
    modifiedFiles: status.modifiedFiles,
    untrackedFiles: status.untrackedFiles,

    recentLog,
    recentReflog,

    commitGraph: outputs.commitGraph || undefined,
    diffStats: diffStats.length > 0 ? diffStats : undefined,

    mergeHead: operations.merge.head || undefined,
    mergeMessage: operations.merge.message || undefined,

    cherryPickInProgress: operations.cherryPick,
    revertInProgress: operations.revert,
    bisectInProgress: operations.bisect,

    // rawStatus is a debug field; the wire format is NUL-delimited, so convert
    // record separators to newlines for human readability without losing paths.
    rawStatus: outputs.status.replace(/\0/g, '\n'),
    rawBranches: outputs.branches,

    remotes: remotes.length > 0 ? remotes : undefined,
    rootCommitOid,
  };

  return SnapshotV1Schema.parse(snapshot);
}
