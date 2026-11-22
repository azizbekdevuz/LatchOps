import { closeSync, mkdtempSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDisplay } from '@latchops/recovery-engine';
import { boundText } from './text';
import type { ExecEvidence } from './types';

const MAX_CAPTURE = 8_000;

let emptyGitConfig: string | undefined;

/** Git environment that ignores the developer’s global and system config. */
export function isolatedGitEnv(): NodeJS.ProcessEnv {
  if (!emptyGitConfig) {
    const dir = mkdtempSync(join(tmpdir(), 'latchops-git-cfg-'));
    emptyGitConfig = join(dir, 'empty');
    closeSync(openSync(emptyGitConfig, 'w'));
  }
  return {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: process.env.NODE_ENV,
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_CONFIG_SYSTEM: emptyGitConfig,
    GIT_AUTHOR_NAME: 'LatchOps Demo',
    GIT_AUTHOR_EMAIL: 'demo@latchops.dev',
    GIT_COMMITTER_NAME: 'LatchOps Demo',
    GIT_COMMITTER_EMAIL: 'demo@latchops.dev',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function toEvidence(
  executable: string,
  args: readonly string[],
  result: { exitCode: number; stdout: string; stderr: string; durationMs: number },
  source: ExecEvidence['source'],
): ExecEvidence {
  return {
    display: renderDisplay(executable, [...args]),
    executable,
    args: [...args],
    exitCode: result.exitCode,
    stdout: boundText(result.stdout, MAX_CAPTURE),
    stderr: boundText(result.stderr, 2_000),
    durationMs: result.durationMs,
    source,
  };
}
