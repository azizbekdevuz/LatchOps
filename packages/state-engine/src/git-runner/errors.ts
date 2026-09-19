/**
 * Structured error hierarchy for git process execution.
 *
 * Every error carries the invoked argument vector (never a shell string) plus
 * enough context to diagnose failures deterministically. No error message ever
 * embeds untrusted content in a way that could be re-interpreted as a command.
 */

export interface GitErrorContext {
  args: readonly string[];
  cwd: string;
}

/** Base class for all git-runner errors. */
export class GitError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;

  constructor(message: string, context: GitErrorContext, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.args = context.args;
    this.cwd = context.cwd;
    // Maintain a proper prototype chain when compiled to older targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** The command as a human-readable string (for logs only, never executed). */
  get commandLine(): string {
    return ['git', ...this.args].join(' ');
  }
}

/** `git` binary not found on PATH (spawn ENOENT). */
export class GitNotInstalledError extends GitError {
  constructor(context: GitErrorContext, options?: { cause?: unknown }) {
    super(
      'git executable was not found. Ensure Git is installed and available on PATH.',
      context,
      options,
    );
  }
}

/** git exited with a non-zero status (only thrown by the strict helper). */
export class GitCommandError extends GitError {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    context: GitErrorContext,
    details: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    },
  ) {
    const reason =
      details.signal != null
        ? `terminated by signal ${details.signal}`
        : `exited with code ${details.exitCode ?? 'unknown'}`;
    const stderrSnippet = details.stderr.trim().split('\n').slice(0, 3).join(' ');
    super(
      `git ${reason}${stderrSnippet ? `: ${stderrSnippet}` : ''}`,
      context,
    );
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
  }
}

/** The command exceeded the configured wall-clock timeout and was killed. */
export class GitTimeoutError extends GitError {
  readonly timeoutMs: number;

  constructor(context: GitErrorContext, timeoutMs: number) {
    super(`git timed out after ${timeoutMs}ms`, context);
    this.timeoutMs = timeoutMs;
  }
}

/** The combined output exceeded the configured maximum and the process was killed. */
export class GitOutputLimitError extends GitError {
  readonly maxOutputBytes: number;

  constructor(context: GitErrorContext, maxOutputBytes: number) {
    super(`git output exceeded the maximum of ${maxOutputBytes} bytes`, context);
    this.maxOutputBytes = maxOutputBytes;
  }
}

/** Execution was cancelled via an AbortSignal. */
export class GitAbortError extends GitError {
  constructor(context: GitErrorContext, options?: { cause?: unknown }) {
    super('git execution was aborted', context, options);
  }
}

/** The working directory is not inside a git repository. */
export class NotARepositoryError extends GitError {
  constructor(context: GitErrorContext, options?: { cause?: unknown }) {
    super(
      'Not a git repository (or any parent directory). Run inside a git working tree.',
      context,
      options,
    );
  }
}
