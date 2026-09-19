import { spawn } from 'node:child_process';
import {
  GitAbortError,
  GitCommandError,
  GitNotInstalledError,
  GitOutputLimitError,
  GitTimeoutError,
} from './errors.js';

export * from './errors.js';

/** Default wall-clock timeout for a single git invocation. */
export const DEFAULT_TIMEOUT_MS = 15_000;
/** Default combined stdout+stderr cap (bytes) before the process is killed. */
export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024; // 32 MiB
/** Grace period between SIGTERM and SIGKILL when terminating a run. */
const KILL_GRACE_MS = 2_000;

export interface GitRunOptions {
  /** Working directory. Defaults to `process.cwd()`. Always passed explicitly to git. */
  cwd?: string;
  /** Wall-clock timeout in ms. */
  timeoutMs?: number;
  /** Maximum combined stdout+stderr size in bytes before termination. */
  maxOutputBytes?: number;
  /** Extra environment variables merged over a sanitized base env. */
  env?: NodeJS.ProcessEnv;
  /** Optional stdin payload (e.g. for `git hash-object --stdin`). */
  input?: string;
  /** External cancellation. */
  signal?: AbortSignal;
  /** Normalize CRLF/CR to LF in decoded stdout/stderr. Defaults to true. */
  normalizeNewlines?: boolean;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** True when the process exited with code 0 and no terminating signal. */
  ok: boolean;
}

/**
 * Build a deterministic, minimal environment for git so that user locale,
 * pagers, prompts, and editors cannot alter machine-readable output.
 */
function buildGitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    // Stable, parseable output regardless of the caller's locale.
    LC_ALL: 'C',
    LANG: 'C',
    // Never block on interactive prompts (credentials, host keys, etc.).
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    // Disable pager; we always capture output directly.
    GIT_PAGER: 'cat',
    PAGER: 'cat',
  };
  return extra ? { ...base, ...extra } : base;
}

/**
 * Execute a git command using an argument array (never a shell string).
 *
 * This is the single choke point for all git process execution in LatchOps.
 * It provides explicit cwd, timeout, output-size limiting, abort handling,
 * normalized stdout/stderr, exit code + signal, and structured errors.
 *
 * A non-zero exit code is returned as `{ ok: false }` rather than thrown, so
 * callers can decide how to interpret expected failures (e.g. `rev-parse`
 * probes). Use {@link runGitStrict} when any non-zero exit is a hard error.
 *
 * Thrown errors are limited to environmental failures:
 * - {@link GitNotInstalledError} when the binary is missing,
 * - {@link GitTimeoutError} on timeout,
 * - {@link GitOutputLimitError} when output is too large,
 * - {@link GitAbortError} when cancelled.
 */
export function runGit(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const normalizeNewlines = options.normalizeNewlines ?? true;
  const context = { args, cwd } as const;

  return new Promise<GitResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new GitAbortError(context));
      return;
    }

    const child = spawn('git', args, {
      cwd,
      env: buildGitEnv(options.env),
      windowsHide: true,
      // Never use a shell: arguments are passed verbatim to the OS.
      shell: false,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let limitExceeded = false;
    let aborted = false;

    let killTimer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      clearTimeout(timeoutHandle);
      if (killTimer) clearTimeout(killTimer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    };

    /** Escalating termination: SIGTERM, then SIGKILL after a grace period. */
    const terminate = (): void => {
      if (child.killed) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, KILL_GRACE_MS);
      killTimer.unref?.();
    };

    const onAbort = (): void => {
      aborted = true;
      terminate();
    };

    if (options.signal) options.signal.addEventListener('abort', onAbort, { once: true });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeoutHandle.unref?.();

    const trackOutput = (chunk: Buffer, sink: Buffer[]): void => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        limitExceeded = true;
        terminate();
        return;
      }
      sink.push(chunk);
    };

    child.stdout.on('data', (chunk: Buffer) => trackOutput(chunk, stdoutChunks));
    child.stderr.on('data', (chunk: Buffer) => trackOutput(chunk, stderrChunks));

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err.code === 'ENOENT') {
        reject(new GitNotInstalledError(context, { cause: err }));
      } else {
        // Unexpected spawn failure (e.g. EACCES); surface as an abort-style error.
        reject(new GitAbortError(context, { cause: err }));
      }
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (limitExceeded) {
        reject(new GitOutputLimitError(context, maxOutputBytes));
        return;
      }
      if (timedOut) {
        reject(new GitTimeoutError(context, timeoutMs));
        return;
      }
      if (aborted) {
        reject(new GitAbortError(context));
        return;
      }

      let stdout = Buffer.concat(stdoutChunks).toString('utf8');
      let stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (normalizeNewlines) {
        stdout = stdout.replace(/\r\n?/g, '\n');
        stderr = stderr.replace(/\r\n?/g, '\n');
      }

      resolve({
        stdout,
        stderr,
        exitCode: code,
        signal: signal as NodeJS.Signals | null,
        ok: code === 0 && signal == null,
      });
    });

    if (options.input != null) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Like {@link runGit} but throws {@link GitCommandError} on any non-zero exit.
 * Use for commands whose failure indicates a real problem.
 */
export async function runGitStrict(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  const result = await runGit(args, options);
  if (!result.ok) {
    throw new GitCommandError(
      { args, cwd: options.cwd ?? process.cwd() },
      {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    );
  }
  return result;
}
