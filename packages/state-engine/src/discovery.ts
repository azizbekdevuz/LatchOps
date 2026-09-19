import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { runGit, runGitStrict, type GitRunOptions } from './git-runner/index.js';
import { NotARepositoryError } from './git-runner/errors.js';

export interface GitVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
}

export interface RepositoryContext {
  /** Absolute path to the working-tree root. */
  repoRoot: string;
  /** Absolute path to this working tree's `.git` directory (worktree-specific). */
  gitDir: string;
  /**
   * Absolute path to the common git directory shared across linked worktrees.
   * Equal to `gitDir` for the main working tree; differs for linked worktrees.
   */
  commonDir: string;
  /** True when invoked from within a linked worktree (gitDir != commonDir). */
  isLinkedWorktree: boolean;
  /** True when the repository is bare (no working tree). */
  isBare: boolean;
  /** Detected git version. */
  version: GitVersion;
}

const BASE_RUN_OPTS = (cwd: string): GitRunOptions => ({ cwd, timeoutMs: 10_000 });

/** Parse `git --version` output. Missing git surfaces as GitNotInstalledError. */
export async function getGitVersion(options: { cwd?: string } = {}): Promise<GitVersion> {
  const cwd = options.cwd ?? process.cwd();
  const result = await runGitStrict(['--version'], BASE_RUN_OPTS(cwd));
  const raw = result.stdout.trim();
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { raw, major: 0, minor: 0, patch: 0 };
  }
  return {
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Compare a detected version against a minimum. */
export function versionAtLeast(v: GitVersion, major: number, minor = 0, patch = 0): boolean {
  if (v.major !== major) return v.major > major;
  if (v.minor !== minor) return v.minor > minor;
  return v.patch >= patch;
}

/**
 * Resolve a git-relative path (as returned by `rev-parse --git-path`) to an
 * absolute path, anchored on the invocation cwd rather than `process.cwd()`.
 * This is what makes worktree/subdirectory invocation correct.
 */
export function resolveFromCwd(cwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

/**
 * Canonicalize a path for reliable equality checks across platforms: resolves
 * symlinks and normalizes slash direction and drive-letter casing on Windows.
 * Falls back to the input if the path cannot be resolved.
 */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * Discover the repository context for a given directory. Supports invocation
 * from a nested subdirectory and from linked worktrees.
 *
 * @throws NotARepositoryError when `cwd` is not inside a working tree.
 */
export async function discoverRepository(options: { cwd?: string } = {}): Promise<RepositoryContext> {
  const cwd = options.cwd ?? process.cwd();
  const runOpts = BASE_RUN_OPTS(cwd);

  // Establishes both "is this a repo" and version in one pass of cheap probes.
  const version = await getGitVersion({ cwd });

  const insideWorkTree = await runGit(['rev-parse', '--is-inside-work-tree'], runOpts);
  const isBareResult = await runGit(['rev-parse', '--is-bare-repository'], runOpts);
  const isBare = isBareResult.ok && isBareResult.stdout.trim() === 'true';

  if (!insideWorkTree.ok || insideWorkTree.stdout.trim() !== 'true') {
    // Could be a bare repo or simply not a repository at all.
    if (!isBare) {
      throw new NotARepositoryError({ args: ['rev-parse', '--is-inside-work-tree'], cwd });
    }
  }

  // `--absolute-git-dir` (git >= 2.13) gives an absolute, worktree-aware git dir.
  const gitDirResult = await runGitStrict(['rev-parse', '--absolute-git-dir'], runOpts);
  const gitDir = gitDirResult.stdout.trim();

  // `--git-common-dir` is relative to the invocation cwd; resolve it there.
  // It differs from gitDir only inside a linked worktree.
  const commonDirResult = await runGitStrict(['rev-parse', '--git-common-dir'], runOpts);
  const commonDir = resolveFromCwd(cwd, commonDirResult.stdout.trim());

  let repoRoot: string;
  if (isBare) {
    repoRoot = gitDir;
  } else {
    const topLevelResult = await runGitStrict(['rev-parse', '--show-toplevel'], runOpts);
    repoRoot = topLevelResult.stdout.trim();
  }

  return {
    repoRoot,
    gitDir,
    commonDir,
    isLinkedWorktree: canonical(gitDir) !== canonical(commonDir),
    isBare,
    version,
  };
}

/**
 * Resolve the absolute path of a special git file/dir (e.g. `MERGE_HEAD`,
 * `rebase-merge`) using `rev-parse --git-path`. This is worktree-safe: rebase
 * and merge state live in the per-worktree git dir, and git resolves it for us.
 */
export async function gitPath(name: string, ctx: RepositoryContext): Promise<string> {
  const result = await runGitStrict(['rev-parse', '--git-path', name], {
    cwd: ctx.repoRoot,
    timeoutMs: 10_000,
  });
  return resolveFromCwd(ctx.repoRoot, result.stdout.trim());
}
