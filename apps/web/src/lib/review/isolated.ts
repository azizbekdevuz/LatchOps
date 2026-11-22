import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { RecoveryPlanV1, RepoSignalsV1, SnapshotV1, VerificationResultV1 } from '@latchops/schema';
import { generateRecoveryPlan, verifyRecovery } from '@latchops/recovery-engine';
import { computeRepoSignals, runGit } from '@latchops/state-engine';
import { captureSnapshotFromWorkspace } from '@/lib/hacksprint/capture';
import { decideVerdict } from '@/lib/hacksprint/verdict';
import type { ExecEvidence } from '@/lib/hacksprint/types';
import { isolatedGitEnv, toEvidence, type ProofWorkspace } from '@/lib/hacksprint/workspace';
import type { AuthorizationResult } from './authorize';
import type { RepoSpec } from './scenarios';
import type { ExecutionVerdict } from './types';

const FIXED_DATE = '2026-01-05T09:00:00+0900';

/**
 * Temporary repository outside the LatchOps checkout. Commit dates are fixed
 * so rebuilding the same scenario yields the same object ids and evidence hash.
 */
export function createReviewWorkspace(): ProofWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'latchops-review-'));
  const env = { ...isolatedGitEnv(), GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE };
  const inside = (relPath: string) => {
    const full = resolve(dir, relPath);
    if (full !== dir && !full.startsWith(dir + sep)) throw new Error(`path escapes workspace: ${relPath}`);
    return full;
  };
  return {
    kind: 'local',
    repoRoot: dir,
    async execGit(args, opts = {}) {
      const started = Date.now();
      const result = await runGit([...args], { cwd: dir, env, timeoutMs: opts.timeoutMs ?? 20_000 });
      const evidence = toEvidence(
        'git',
        args,
        { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - started },
        opts.source ?? 'inspect',
      );
      if (!opts.allowFail && !result.ok) {
        throw new Error(`git ${args.join(' ')} failed (${evidence.exitCode}): ${evidence.stderr || evidence.stdout}`);
      }
      return evidence;
    },
    async writeFile(relPath, content) {
      const full = inside(relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf8');
    },
    async readFile(relPath) {
      return readFileSync(inside(relPath), 'utf8');
    },
    async exists(relPath) {
      return existsSync(inside(relPath));
    },
    async dispose() {
      try {
        rmSync(dir, { recursive: true, force: true });
        return { cleanedUp: true };
      } catch (error) {
        return { cleanedUp: false, error: error instanceof Error ? error.message : 'cleanup failed' };
      }
    },
  };
}

async function applyFiles(ws: ProofWorkspace, files: Record<string, string | null>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) await ws.execGit(['rm', '-q', '--', path], { source: 'setup' });
    else await ws.writeFile(path, content);
  }
}

/** Rebuild the scenario's conflicted merge from scratch in `ws`. */
export async function materializeRepo(ws: ProofWorkspace, spec: RepoSpec, opts: { drift?: boolean } = {}): Promise<void> {
  const git = (args: string[], allowFail = false) => ws.execGit(args, { allowFail, source: 'setup' });
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.name', 'LatchOps Review Fixture']);
  await git(['config', 'user.email', 'fixture@latchops.local']);
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'core.autocrlf', 'false']);
  await git(['config', 'core.quotepath', 'false']);
  await git(['config', 'merge.conflictStyle', 'merge']);

  await applyFiles(ws, spec.base);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', spec.messages.base]);

  await git(['switch', '-q', '-c', spec.releaseBranch]);
  await applyFiles(ws, spec.theirs);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', spec.messages.theirs]);

  await git(['switch', '-q', 'main']);
  for (let i = 1; i <= (spec.fillerCommits ?? 0); i++) {
    await ws.writeFile('CHANGELOG.md', `${Array.from({ length: i }, (_, n) => `- change ${n + 1}`).join('\n')}\n`);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', `chore: changelog entry ${i}`]);
  }
  await applyFiles(ws, spec.ours);
  await git(['add', '-A']);
  await git(['commit', '-q', '-m', spec.messages.ours]);

  if (opts.drift && spec.drift) {
    await ws.writeFile(spec.drift.path, spec.drift.content);
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', spec.drift.message]);
  }

  const merge = await git(['merge', '--no-edit', spec.releaseBranch], true);
  if (merge.exitCode === 0) throw new Error('fixture expected a merge conflict but the merge succeeded');
}

export interface CapturedState {
  snapshot: SnapshotV1;
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
}

export async function captureState(ws: ProofWorkspace): Promise<CapturedState> {
  const snapshot = await captureSnapshotFromWorkspace(ws);
  const signals = computeRepoSignals(snapshot);
  const plan = generateRecoveryPlan({ snapshot, signals });
  return { snapshot, signals, plan };
}

const MARKER_RE = /^(<{7}|={7}|>{7})(\s|$)/m;

export interface IsolatedRunResult {
  verdict: ExecutionVerdict;
  reasons: string[];
  execution: ExecEvidence[];
  verification: VerificationResultV1 | null;
  signalsAfter: RepoSignalsV1 | null;
  markerGuard: { checked: string[]; blocked: string[] };
  remotes: string;
}

/**
 * Run the authorized commands, in plan order, inside `ws`. The only
 * non-command action is writing the human resolution fixture.
 */
export async function executeAuthorized(input: {
  ws: ProofWorkspace;
  plan: RecoveryPlanV1;
  alternativeId: string;
  auth: AuthorizationResult;
  before: RepoSignalsV1;
  resolution: Record<string, string>;
  markerGuard?: boolean;
}): Promise<IsolatedRunResult> {
  const { ws, plan, auth } = input;
  const execution: ExecEvidence[] = [];
  const guard = { checked: [] as string[], blocked: [] as string[] };
  const remotes = (await ws.execGit(['remote', '-v'], { allowFail: true })).stdout.trim();
  const allowedDisplays = new Set(auth.commands.map((cmd) => cmd.display));
  const alternative = plan.alternatives.find((alt) => alt.id === input.alternativeId);
  const fail = (reason: string): IsolatedRunResult => ({
    verdict: 'FAILED',
    reasons: [reason],
    execution,
    verification: null,
    signalsAfter: null,
    markerGuard: guard,
    remotes,
  });

  if (!auth.allowed || !alternative) {
    return { ...fail('not authorized'), verdict: 'BLOCKED', reasons: auth.reasons };
  }
  if (remotes) return fail('isolated workspace unexpectedly has a remote configured');

  for (const step of [...plan.steps, ...alternative.steps]) {
    if (step.id === 'resolve-conflicts') {
      for (const [path, content] of Object.entries(input.resolution)) {
        await ws.writeFile(path, content);
        execution.push({
          display: `write ${path}  # human resolution fixture (not model output)`,
          executable: 'write',
          args: [path],
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 0,
          source: 'demo_orchestration',
        });
      }
    }
    if (step.id === 'mark-resolved' && input.markerGuard !== false) {
      for (const path of input.before.worktree.conflictedPaths) {
        guard.checked.push(path);
        if ((await ws.exists(path)) && MARKER_RE.test(await ws.readFile(path))) guard.blocked.push(path);
      }
      if (guard.blocked.length > 0) {
        return fail(`conflict markers remain in ${guard.blocked.join(', ')}; refusing to mark resolved`);
      }
    }
    for (const cmd of step.commands) {
      if (!allowedDisplays.has(cmd.display)) continue;
      const inspect = cmd.readOnly;
      const row = await ws.execGit(cmd.args, { allowFail: true, source: inspect ? 'inspect' : 'plan' });
      execution.push(row);
      if (!inspect && row.exitCode !== 0) return fail(`${cmd.display} exited ${row.exitCode}`);
    }
  }

  const after = await captureState(ws);
  const verification = verifyRecovery({
    incidentType: plan.incidentType,
    before: input.before,
    after: after.signals,
    plan,
    selectedAlternativeId: input.alternativeId,
  });
  const decision = decideVerdict({ verification, executionFailed: false });
  return {
    verdict: decision.verdict,
    reasons: decision.reasons,
    execution,
    verification,
    signalsAfter: after.signals,
    markerGuard: guard,
    remotes,
  };
}
