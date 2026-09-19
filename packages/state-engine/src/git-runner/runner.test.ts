import { describe, expect, it } from 'vitest';
import {
  runGit,
  runGitStrict,
  GitCommandError,
  GitOutputLimitError,
  GitAbortError,
  GitTimeoutError,
  GitNotInstalledError,
} from './index';

describe('runGit safety and error handling', () => {
  it('runs git with an argument array and returns normalized output', async () => {
    const result = await runGit(['--version']);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/git version/);
    expect(result.stdout).not.toMatch(/\r/);
  });

  it('returns ok:false (does not throw) on a non-zero exit', async () => {
    // `git config --get <missing>` exits 1 and needs no repository.
    const result = await runGit(['config', '--get', 'latchops.nonexistent.key']);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('runGitStrict throws a structured GitCommandError on non-zero exit', async () => {
    await expect(runGitStrict(['config', '--get', 'latchops.nonexistent.key'])).rejects.toSatisfy(
      (err: unknown) => err instanceof GitCommandError && err.exitCode !== 0,
    );
  });

  it('enforces the maximum output size', async () => {
    await expect(runGit(['--version'], { maxOutputBytes: 1 })).rejects.toBeInstanceOf(
      GitOutputLimitError,
    );
  });

  it('rejects immediately when the abort signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runGit(['--version'], { signal: controller.signal })).rejects.toBeInstanceOf(
      GitAbortError,
    );
  });

  it('times out and terminates a slow command', async () => {
    // A 1ms budget cannot cover process spawn + a large log walk, so the
    // watchdog reliably terminates the child before it closes.
    await expect(
      runGit(['log', '--format=%H'], { timeoutMs: 1, cwd: process.cwd() }),
    ).rejects.toBeInstanceOf(GitTimeoutError);
  });

  it('maps a missing git binary to GitNotInstalledError', async () => {
    // Clear PATH (both case variants for Windows) so `git` cannot be resolved.
    await expect(
      runGit(['--version'], { env: { PATH: '', Path: '' } }),
    ).rejects.toBeInstanceOf(GitNotInstalledError);
  });
});
