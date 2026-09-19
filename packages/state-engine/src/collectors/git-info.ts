import { runGit, runGitStrict, type GitRunOptions } from '../git-runner/index.js';
import type { RepositoryContext } from '../discovery.js';
import { LOG_FORMAT } from '../parsers/log-parser.js';
import { REFLOG_FORMAT } from '../parsers/reflog-parser.js';

const DEFAULT_HISTORY = 30;

export interface CollectOptions {
  timeoutMs?: number;
  /** Number of log/reflog entries to capture. */
  historyLimit?: number;
}

/** Raw, unparsed git command outputs captured for a single snapshot. */
export interface GitOutputs {
  status: string;
  branches: string;
  log: string;
  reflog: string;
  commitGraph: string;
  diffNumstat: string;
}

/**
 * Collect all git command outputs needed to build a snapshot, using the safe
 * runner with an explicit working directory (the repository root) and custom,
 * separator-delimited formats for robust parsing.
 *
 * Read-only: every command inspects state and none mutate the repository.
 */
export async function collectGitOutputs(
  ctx: RepositoryContext,
  options: CollectOptions = {},
): Promise<GitOutputs> {
  const history = String(options.historyLimit ?? DEFAULT_HISTORY);
  const run = (args: string[]): Promise<{ stdout: string; ok: boolean }> =>
    runGit(args, baseOpts(ctx, options));

  // Status must succeed (drives everything); the rest degrade gracefully.
  const status = (
    await runGitStrict(['status', '--porcelain=v2', '--branch', '-z'], baseOpts(ctx, options))
  ).stdout;

  const [branches, log, reflog, commitGraph, diffNumstat] = await Promise.all([
    run(['branch', '-vv']).then((r) => r.stdout),
    run(['log', '-n', history, '--decorate=short', `--format=${LOG_FORMAT}`]).then((r) => r.stdout),
    run(['reflog', '-n', history, `--format=${REFLOG_FORMAT}`]).then((r) => r.stdout),
    run(['log', '--graph', '--oneline', '--decorate', '--all', '-n', history]).then((r) => r.stdout),
    run(['diff', '--numstat', '-z']).then((r) => r.stdout),
  ]);

  return { status, branches, log, reflog, commitGraph, diffNumstat };
}

function baseOpts(ctx: RepositoryContext, options: CollectOptions): GitRunOptions {
  return {
    cwd: ctx.repoRoot,
    timeoutMs: options.timeoutMs,
    // Keep newlines in text outputs normalized; status uses -z (NUL) so
    // newline normalization does not affect its record boundaries.
    normalizeNewlines: true,
  };
}
