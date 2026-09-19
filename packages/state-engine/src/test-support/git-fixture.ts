import { mkdtempSync, writeFileSync, rmSync, mkdirSync, closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, runGitStrict } from '../git-runner/index';

/**
 * Test-only helpers for building throwaway git repositories.
 *
 * All git invocations run with an isolated configuration environment so that
 * the developer's global/system git config cannot influence test outcomes.
 */

let emptyConfigFile: string | undefined;

function isolatedEnv(): NodeJS.ProcessEnv {
  if (!emptyConfigFile) {
    const dir = mkdtempSync(join(tmpdir(), 'latchops-gitcfg-'));
    emptyConfigFile = join(dir, 'empty');
    closeSync(openSync(emptyConfigFile, 'w'));
  }
  return {
    GIT_CONFIG_GLOBAL: emptyConfigFile,
    GIT_CONFIG_SYSTEM: emptyConfigFile,
    GIT_AUTHOR_NAME: 'LatchOps Test',
    GIT_AUTHOR_EMAIL: 'test@latchops.dev',
    GIT_COMMITTER_NAME: 'LatchOps Test',
    GIT_COMMITTER_EMAIL: 'test@latchops.dev',
  };
}

export interface TempRepo {
  dir: string;
  git: (args: string[]) => Promise<string>;
  gitAllowFail: (args: string[]) => Promise<{ stdout: string; ok: boolean }>;
  writeFile: (relPath: string, content: string) => void;
  cleanup: () => void;
}

/** Create a directory under the OS temp dir; `suffix` may contain spaces/Unicode. */
export function makeTempDir(suffix = ''): string {
  const base = mkdtempSync(join(tmpdir(), 'latchops-repo-'));
  if (!suffix) return base;
  const nested = join(base, suffix);
  mkdirSync(nested, { recursive: true });
  return nested;
}

export async function createRepo(dirSuffix = ''): Promise<TempRepo> {
  const dir = makeTempDir(dirSuffix);
  const env = isolatedEnv();

  const git = async (args: string[]): Promise<string> => {
    const result = await runGitStrict(args, { cwd: dir, env, timeoutMs: 20_000 });
    return result.stdout;
  };
  const gitAllowFail = async (args: string[]): Promise<{ stdout: string; ok: boolean }> => {
    const result = await runGit(args, { cwd: dir, env, timeoutMs: 20_000 });
    return { stdout: result.stdout, ok: result.ok };
  };
  const writeFile = (relPath: string, content: string): void => {
    const full = join(dir, relPath);
    const parent = full.slice(0, Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\')));
    if (parent && parent !== dir) mkdirSync(parent, { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  await git(['init', '-b', 'main']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'tag.gpgsign', 'false']);
  await git(['config', 'core.autocrlf', 'false']);

  const cleanup = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  return { dir, git, gitAllowFail, writeFile, cleanup };
}

/** Commit a single file with given content; returns the commit sha. */
export async function commitFile(
  repo: TempRepo,
  relPath: string,
  content: string,
  message: string,
): Promise<string> {
  repo.writeFile(relPath, content);
  await repo.git(['add', '--', relPath]);
  await repo.git(['commit', '-m', message]);
  return (await repo.git(['rev-parse', 'HEAD'])).trim();
}

/** Isolated env for direct runGit calls in tests that need repo-scoped config. */
export function testEnv(): NodeJS.ProcessEnv {
  return isolatedEnv();
}
