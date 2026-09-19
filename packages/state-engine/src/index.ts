/**
 * @latchops/state-engine
 *
 * The single deterministic repository-state engine for LatchOps. It captures
 * read-only git snapshots and classifies repository state using rule-based code
 * only (no LLM, no GitHub, no recovery planning — those arrive in later phases).
 *
 * Public API surface:
 * - High-level capture: `captureSnapshot`, `captureRepoState`.
 * - Classification: `computeRepoSignals`.
 * - Discovery: `discoverRepository`, `getGitVersion`, `versionAtLeast`, `gitPath`.
 * - Git runner: `runGit`, `runGitStrict`, and the structured error classes.
 * - Pure parsers and collectors, exported for direct/unit use.
 */

// High-level capture + classification.
export {
  captureSnapshot,
  captureRepoState,
  type CaptureOptions,
  type RepoStateResult,
} from './capture.js';
export { computeRepoSignals } from './classifiers/classify.js';
export {
  collectRepositoryIdentity,
  type RepositoryIdentity,
} from './collectors/repository-identity.js';

// Discovery.
export {
  discoverRepository,
  getGitVersion,
  versionAtLeast,
  gitPath,
  resolveFromCwd,
  type RepositoryContext,
  type GitVersion,
} from './discovery.js';

// Safe git runner + structured errors.
export {
  runGit,
  runGitStrict,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  type GitRunOptions,
  type GitResult,
} from './git-runner/index.js';
export {
  GitError,
  GitNotInstalledError,
  GitCommandError,
  GitTimeoutError,
  GitOutputLimitError,
  GitAbortError,
  NotARepositoryError,
  type GitErrorContext,
} from './git-runner/errors.js';

// Collectors.
export {
  collectGitOutputs,
  type CollectOptions,
  type GitOutputs,
} from './collectors/git-info.js';
export {
  detectOperationState,
  type OperationState,
} from './collectors/operation-state.js';
export {
  extractConflicts,
  extractConflictBlocks,
  type ExtractConflictsOptions,
} from './collectors/conflict-extractor.js';

// Parsers (pure).
export {
  parseStatus,
  type StatusInfo,
  type StatusBranch,
  type RenameEntry,
} from './parsers/status-parser.js';
export { parseLog, LOG_FORMAT } from './parsers/log-parser.js';
export { parseReflog, REFLOG_FORMAT } from './parsers/reflog-parser.js';
export { parseDiffStat } from './parsers/diffstat-parser.js';

// Normalizers.
export { toBranchInfo } from './normalizers/branch.js';

// Re-export the canonical signals contract for convenience.
export {
  RepoSignalsV1Schema,
  RepoStateSchema,
  type RepoSignalsV1,
  type RepoState,
} from '@latchops/schema';
