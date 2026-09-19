import {
  discoverRepository,
  getGitVersion,
  runGit,
  versionAtLeast,
  GitNotInstalledError,
  NotARepositoryError,
  type RepositoryContext,
} from '@latchops/state-engine';
import { ExitCode } from '../exit-codes.js';
import { resolveApiToken, validateTokenFormat } from './send.js';

/** Minimum git version LatchOps relies on (porcelain v2 -z, absolute-git-dir). */
const MIN_GIT_MAJOR = 2;
const MIN_GIT_MINOR = 20;

type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface DoctorOptions {
  json?: boolean;
  apiUrl?: string;
  checkApi?: boolean;
}

/**
 * Local environment diagnostics. Requires no LLM, database, or web app for its
 * local checks. Optional API URL checks run only when explicitly requested.
 */
export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const checks: CheckResult[] = [];
  let invalidInput = false;

  // Runtime / platform info (always informational).
  checks.push({
    name: 'Runtime',
    status: 'info',
    detail: `node ${process.version}, platform ${process.platform} (${process.arch})`,
  });

  // 1) Git installed + supported version.
  let gitOk = false;
  try {
    const version = await getGitVersion();
    gitOk = true;
    const supported = versionAtLeast(version, MIN_GIT_MAJOR, MIN_GIT_MINOR);
    checks.push({
      name: 'Git installed',
      status: supported ? 'pass' : 'warn',
      detail: supported
        ? `${version.raw}`
        : `${version.raw} (below recommended ${MIN_GIT_MAJOR}.${MIN_GIT_MINOR})`,
    });
  } catch (error) {
    if (error instanceof GitNotInstalledError) {
      checks.push({ name: 'Git installed', status: 'fail', detail: 'git not found on PATH' });
    } else {
      checks.push({
        name: 'Git installed',
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 2) Repository discovery + worktree/git-dir readability.
  let context: RepositoryContext | null = null;
  if (gitOk) {
    try {
      context = await discoverRepository();
      checks.push({
        name: 'Inside a repository',
        status: 'pass',
        detail: context.isBare ? 'bare repository' : `worktree at ${context.repoRoot}`,
      });
      checks.push({
        name: 'Git directory',
        status: 'pass',
        detail: context.isLinkedWorktree
          ? `${context.gitDir} (linked worktree; common: ${context.commonDir})`
          : context.gitDir,
      });
    } catch (error) {
      if (error instanceof NotARepositoryError) {
        checks.push({
          name: 'Inside a repository',
          status: 'fail',
          detail: 'current directory is not inside a git repository',
        });
      } else {
        checks.push({
          name: 'Inside a repository',
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // 3) Read-only git commands.
  if (context) {
    const statusRun = await runGit(['status', '--porcelain=v2', '--branch'], {
      cwd: context.repoRoot,
    });
    checks.push({
      name: 'Read-only git commands',
      status: statusRun.ok ? 'pass' : 'fail',
      detail: statusRun.ok
        ? 'git status / rev-parse succeeded'
        : `git status failed (exit ${statusRun.exitCode})`,
    });
  }

  // 4) API token (LatchOps SaaS ingest).
  const token = resolveApiToken();
  if (!token) {
    checks.push({
      name: 'API token',
      status: 'warn',
      detail: 'LATCHOPS_API_TOKEN not set (required for latchops send)',
    });
  } else if (!validateTokenFormat(token)) {
    checks.push({
      name: 'API token',
      status: 'fail',
      detail: 'LATCHOPS_API_TOKEN format invalid (expected lops_live_<id>.<secret>)',
    });
  } else {
    checks.push({ name: 'API token', status: 'pass', detail: 'format valid' });
  }

  // 5) Optional API URL checks (only when provided).
  if (options.apiUrl !== undefined) {
    const parsedUrl = parseUrl(options.apiUrl);
    if (!parsedUrl) {
      invalidInput = true;
      checks.push({
        name: 'API URL',
        status: 'fail',
        detail: `invalid URL: ${options.apiUrl}`,
      });
    } else {
      checks.push({ name: 'API URL format', status: 'pass', detail: parsedUrl.origin });
      if (options.checkApi) {
        const reach = await checkReachable(parsedUrl);
        checks.push({
          name: 'API reachability',
          status: reach.ok ? 'pass' : 'warn',
          detail: reach.detail,
        });
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ checks }, null, 2));
  } else {
    console.log(renderChecks(checks));
  }

  if (invalidInput) {
    process.exit(ExitCode.INVALID_INPUT);
  }
  const hasFailure = checks.some((c) => c.status === 'fail');
  process.exit(hasFailure ? ExitCode.OPERATIONAL_FAILURE : ExitCode.SUCCESS);
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

async function checkReachable(url: URL): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: `unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function renderChecks(checks: CheckResult[]): string {
  const marker: Record<CheckStatus, string> = {
    pass: '[ ok ]',
    fail: '[fail]',
    warn: '[warn]',
    info: '[info]',
  };
  const lines: string[] = [];
  lines.push('LatchOps doctor');
  lines.push('-'.repeat(60));
  for (const c of checks) {
    lines.push(`${marker[c.status]} ${c.name}: ${c.detail}`);
  }
  return lines.join('\n');
}
