import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runGit } from '@latchops/state-engine';
import { renderDisplay } from '@latchops/recovery-engine';
import { boundText, toPosixCommand } from './quote';
import type { ExecEvidence, IsolationKind } from './types';

const MAX_CAPTURE = 8_000;
const GIT_TIMEOUT_MS = 20_000;

export interface ExecOptions {
  allowFail?: boolean;
  source?: ExecEvidence['source'];
  timeoutMs?: number;
}

export interface ProofWorkspace {
  kind: IsolationKind;
  sandboxId?: string;
  repoRoot: string;
  execGit(args: readonly string[], opts?: ExecOptions): Promise<ExecEvidence>;
  writeFile(relPath: string, content: string): Promise<void>;
  readFile(relPath: string): Promise<string>;
  exists(relPath: string): Promise<boolean>;
  dispose(): Promise<{ cleanedUp: boolean; error?: string }>;
}

let emptyGitConfig: string | undefined;

export function isolatedGitEnv(): NodeJS.ProcessEnv {
  if (!emptyGitConfig) {
    const dir = mkdtempSync(join(tmpdir(), 'latchops-hacksprint-cfg-'));
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

export function createLocalWorkspace(): ProofWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'latchops-hacksprint-'));
  const env = isolatedGitEnv();

  return {
    kind: 'local',
    repoRoot: dir,
    async execGit(args, opts = {}) {
      const started = Date.now();
      const result = await runGit([...args], {
        cwd: dir,
        env,
        timeoutMs: opts.timeoutMs ?? GIT_TIMEOUT_MS,
      });
      const evidence = toEvidence(
        'git',
        args,
        {
          exitCode: result.exitCode ?? 1,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: Date.now() - started,
        },
        opts.source ?? 'inspect',
      );
      if (!opts.allowFail && !result.ok) {
        throw new Error(`git ${args.join(' ')} failed (${evidence.exitCode}): ${evidence.stderr || evidence.stdout}`);
      }
      return evidence;
    },
    async writeFile(relPath, content) {
      const full = join(dir, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    },
    async readFile(relPath) {
      return readFileSync(join(dir, relPath), 'utf8');
    },
    async exists(relPath) {
      return existsSync(join(dir, relPath));
    },
    async dispose() {
      try {
        rmSync(dir, { recursive: true, force: true });
        return { cleanedUp: true };
      } catch (error) {
        return {
          cleanedUp: false,
          error: error instanceof Error ? error.message : 'local cleanup failed',
        };
      }
    },
  };
}

export interface DaytonaProcessLike {
  executeCommand(
    command: string,
    cwd?: string,
    env?: Record<string, string>,
    timeout?: number,
  ): Promise<{ exitCode?: number; result?: string; artifacts?: { stdout?: string } }>;
}

export interface DaytonaFsLike {
  uploadFile(data: Buffer, remotePath: string): Promise<unknown>;
  downloadFile(remotePath: string): Promise<Buffer | Uint8Array | string>;
}

export interface DaytonaSandboxLike {
  id: string;
  process: DaytonaProcessLike;
  fs: DaytonaFsLike;
  delete?: (timeout?: number, wait?: boolean) => Promise<unknown>;
}

export function createDaytonaWorkspace(
  sandbox: DaytonaSandboxLike,
  repoRoot: string,
  deleteSandbox: () => Promise<void>,
): ProofWorkspace {
  const posixJoin = (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/');

  return {
    kind: 'daytona',
    sandboxId: sandbox.id,
    repoRoot,
    async execGit(args, opts = {}) {
      const started = Date.now();
      const command = toPosixCommand('git', args);
      const timeoutSec = Math.max(5, Math.ceil((opts.timeoutMs ?? GIT_TIMEOUT_MS) / 1000));
      const response = await sandbox.process.executeCommand(command, repoRoot, undefined, timeoutSec);
      const stdout = response.artifacts?.stdout ?? response.result ?? '';
      const evidence = toEvidence(
        'git',
        args,
        {
          exitCode: response.exitCode ?? 1,
          stdout,
          stderr: '',
          durationMs: Date.now() - started,
        },
        opts.source ?? 'inspect',
      );
      if (!opts.allowFail && evidence.exitCode !== 0) {
        throw new Error(`git ${args.join(' ')} failed in Daytona (${evidence.exitCode}): ${evidence.stdout}`);
      }
      return evidence;
    },
    async writeFile(relPath, content) {
      const remote = posixJoin(repoRoot, relPath);
      const parent = remote.slice(0, remote.lastIndexOf('/'));
      if (parent && parent !== repoRoot) {
        await sandbox.process.executeCommand(toPosixCommand('mkdir', ['-p', parent]), repoRoot, undefined, 10);
      }
      await sandbox.fs.uploadFile(Buffer.from(content, 'utf8'), remote);
    },
    async readFile(relPath) {
      const data = await sandbox.fs.downloadFile(posixJoin(repoRoot, relPath));
      if (typeof data === 'string') return data;
      return Buffer.from(data).toString('utf8');
    },
    async exists(relPath) {
      const response = await sandbox.process.executeCommand(
        toPosixCommand('test', ['-e', posixJoin(repoRoot, relPath)]),
        repoRoot,
        undefined,
        10,
      );
      return (response.exitCode ?? 1) === 0;
    },
    async dispose() {
      try {
        await deleteSandbox();
        return { cleanedUp: true };
      } catch (error) {
        return {
          cleanedUp: false,
          error: error instanceof Error ? error.message : 'Daytona cleanup failed',
        };
      }
    },
  };
}
