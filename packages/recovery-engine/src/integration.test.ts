import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanArtifactV1Schema } from '@latchops/schema';
import { captureRepoState } from '@latchops/state-engine';
import { generateRecoveryPlan } from './plan/index.js';
import { verifyRecovery } from './verify/index.js';
import { commitFile, createRepo, type TempRepo } from './test-support/git-fixture.js';

const NOW = { now: new Date('2026-01-01T00:00:00.000Z') };
const repos: TempRepo[] = [];

async function newRepo(suffix = ''): Promise<TempRepo> {
  const repo = await createRepo(suffix);
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) {
    repos.pop()?.cleanup();
  }
});

describe('integration: dirty worktree', () => {
  it('captures a dirty worktree and produces non-destructive preservation alternatives', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'base\n', 'init');
    repo.writeFile('a.txt', 'changed\n');
    repo.writeFile('new.txt', 'untracked\n');

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    expect(signals.state).toBe('dirty_worktree');

    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    expect(plan.alternatives.map((a) => a.id)).toEqual(
      expect.arrayContaining(['stash', 'patch', 'checkpoint-commit']),
    );
    // Never a blind reset --hard.
    const flat = [...plan.steps, ...plan.alternatives.flatMap((a) => a.steps)];
    expect(flat.some((s) => s.commands.some((c) => c.args.join(' ').includes('reset --hard')))).toBe(
      false,
    );
  });
});

describe('integration: merge conflict (unicode path, arg boundaries)', () => {
  it('generates complete/abort alternatives and stages the exact conflicted path', async () => {
    const repo = await newRepo();
    const path = 'wéird nàme.txt';
    await commitFile(repo, path, 'line1\nbase\nline3\n', 'init');
    await repo.git(['switch', '-c', 'feature']);
    repo.writeFile(path, 'line1\nfeature\nline3\n');
    await repo.git(['commit', '-am', 'feature change']);
    await repo.git(['switch', 'main']);
    repo.writeFile(path, 'line1\nmain\nline3\n');
    await repo.git(['commit', '-am', 'main change']);
    const merge = await repo.gitAllowFail(['merge', 'feature']);
    expect(merge.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    expect(signals.state).toBe('merge_conflict');
    expect(signals.worktree.conflictedPaths).toContain(path);

    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    expect(plan.alternatives.map((a) => a.id)).toEqual(['complete_merge', 'abort_merge']);

    const complete = plan.alternatives.find((a) => a.id === 'complete_merge')!;
    const markResolved = complete.steps.find((s) => s.id === 'mark-resolved')!;
    // Argument boundaries preserved: the unicode path is a single raw arg.
    expect(markResolved.commands[0].args).toEqual(['add', '--', path]);
  });
});

describe('integration: detached HEAD rescue + verification round-trip', () => {
  it('plans a rescue, then verifies success after reattaching', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'one\n', 'c1');
    const head = await commitFile(repo, 'a.txt', 'two\n', 'c2');
    await repo.git(['checkout', head]);

    const before = await captureRepoState({ cwd: repo.dir });
    expect(before.signals.state).toBe('detached_head');

    const plan = generateRecoveryPlan({ signals: before.signals, snapshot: before.snapshot }, NOW);
    expect(plan.manualReviewRequired).toBe(false);
    const safety = plan.steps.find((s) => s.id === 'create-safety-branch')!;
    expect(safety.commands[0].args).toEqual(['branch', expect.stringContaining('latchops/rescue-'), head]);

    // Execute the deterministic rescue to build a real "after" state.
    await repo.git(safety.commands[0].args);
    await repo.git(['switch', 'main']);

    const after = await captureRepoState({ cwd: repo.dir });
    const result = verifyRecovery({
      incidentType: 'detached_head',
      before: before.signals,
      after: after.signals,
      plan,
      now: NOW.now,
    });
    expect(result.status).toBe('succeeded');
    expect(result.changedSignals.some((c) => c.field === 'branch.isDetached')).toBe(true);
  });
});

describe('integration: conflicting rebase', () => {
  it('detects rebase-in-progress and offers continue/abort/skip', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'line1\nbase\nline3\n', 'init');
    await repo.git(['switch', '-c', 'feature']);
    repo.writeFile('a.txt', 'line1\nfeature\nline3\n');
    await repo.git(['commit', '-am', 'feature change']);
    await repo.git(['switch', 'main']);
    repo.writeFile('a.txt', 'line1\nmain\nline3\n');
    await repo.git(['commit', '-am', 'main change']);
    await repo.git(['switch', 'feature']);
    const rebase = await repo.gitAllowFail(['rebase', 'main']);
    expect(rebase.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    // A conflicted rebase surfaces primarily as merge_conflict (conflicts
    // outrank rebase for display) with rebase active in the operation signals.
    expect(signals.operations.rebase).toBe(true);
    expect(signals.secondaryStates).toContain('rebase_in_progress');

    // The engine routes on the rebase operation, producing a rebase plan.
    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    expect(plan.incidentType).toBe('rebase_in_progress');
    expect(plan.alternatives.map((a) => a.id)).toEqual([
      'continue_rebase',
      'abort_rebase',
      'skip_commit',
    ]);
    expect(plan.alternatives.find((a) => a.id === 'skip_commit')!.recommended).toBe(false);
  });
});

describe('integration: cherry-pick conflict (operation-routing safety)', () => {
  it('detects cherry-pick in progress and never emits git merge --abort', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'line1\nbase\nline3\n', 'init');
    await repo.git(['switch', '-c', 'feature']);
    const pick = await commitFile(repo, 'a.txt', 'line1\nfeature\nline3\n', 'feature change');
    await repo.git(['switch', 'main']);
    await commitFile(repo, 'a.txt', 'line1\nmain\nline3\n', 'main change');
    const cp = await repo.gitAllowFail(['cherry-pick', pick]);
    expect(cp.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    expect(signals.operations.cherryPick).toBe(true);
    expect(signals.operations.merge).toBe(false);

    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    const cmds = [...plan.steps, ...plan.alternatives.flatMap((a) => a.steps)].flatMap((s) =>
      s.commands.map((c) => c.args),
    );
    expect(cmds.some((a) => a[0] === 'merge' && (a.includes('--abort') || a.includes('--continue')))).toBe(
      false,
    );
    expect(cmds.some((a) => a[0] === 'cherry-pick' && a.includes('--abort'))).toBe(true);
    expect(plan.manualReviewRequired).toBe(true);
  });
});

describe('integration: revert conflict (operation-routing safety)', () => {
  it('detects revert in progress and only emits revert-specific commands', async () => {
    const repo = await newRepo();
    const first = await commitFile(repo, 'a.txt', 'line1\nbase\nline3\n', 'init');
    await commitFile(repo, 'a.txt', 'line1\nsecond\nline3\n', 'second');
    // Edit the same lines so reverting the first commit conflicts.
    repo.writeFile('a.txt', 'line1\nlocal-change\nline3\n');
    await repo.git(['commit', '-am', 'local change']);
    const rev = await repo.gitAllowFail(['revert', '--no-edit', first]);
    expect(rev.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    expect(signals.operations.revert).toBe(true);
    expect(signals.operations.merge).toBe(false);

    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    const cmds = [...plan.steps, ...plan.alternatives.flatMap((a) => a.steps)].flatMap((s) =>
      s.commands.map((c) => c.args),
    );
    expect(cmds.some((a) => a[0] === 'merge')).toBe(false);
    expect(cmds.some((a) => a[0] === 'revert' && a.includes('--abort'))).toBe(true);
  });
});

describe('integration: plan artifact JSON round-trip', () => {
  it('serializes and re-parses a plan artifact and verifies against a new state', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'base\n', 'init');
    repo.writeFile('a.txt', 'dirty\n');

    const before = await captureRepoState({ cwd: repo.dir });
    const plan = generateRecoveryPlan({ signals: before.signals, snapshot: before.snapshot }, NOW);

    const artifact = PlanArtifactV1Schema.parse({
      version: 1,
      kind: 'latchops-plan-artifact',
      generatedAt: plan.generatedAt,
      repoRoot: before.snapshot.repoRoot,
      incidentType: plan.incidentType,
      selectedAlternativeId: 'stash',
      plan,
      beforeSignals: before.signals,
    });

    const roundTripped = PlanArtifactV1Schema.parse(JSON.parse(JSON.stringify(artifact)));
    expect(roundTripped.plan.incidentType).toBe('dirty_worktree');

    // Preserve the work; the tree becomes clean.
    await repo.git(['stash', 'push', '--include-untracked', '-m', 'latchops-checkpoint']);
    const after = await captureRepoState({ cwd: repo.dir });

    const result = verifyRecovery({
      incidentType: roundTripped.incidentType,
      before: before.signals,
      after: after.signals,
      plan: roundTripped.plan,
      selectedAlternativeId: roundTripped.selectedAlternativeId,
      now: NOW.now,
    });
    expect(result.status).toBe('succeeded');
  });
});

describe('integration: nested-directory invocation', () => {
  it('classifies and plans correctly when invoked from a nested subdirectory', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'nested/deep/keep.txt', 'content\n', 'init');

    const { signals, snapshot } = await captureRepoState({
      cwd: join(repo.dir, 'nested', 'deep'),
    });
    expect(signals.state).toBe('clean');
    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    expect(plan.incidentType).toBe('clean');
  });
});

describe('integration: paths with spaces', () => {
  it('preserves spaced paths as raw args in generated commands', async () => {
    const repo = await newRepo();
    const path = 'dir with space/file name.txt';
    await commitFile(repo, path, 'line1\nbase\nline3\n', 'init');
    await repo.git(['switch', '-c', 'feature']);
    repo.writeFile(path, 'line1\nfeature\nline3\n');
    await repo.git(['commit', '-am', 'feature change']);
    await repo.git(['switch', 'main']);
    repo.writeFile(path, 'line1\nmain\nline3\n');
    await repo.git(['commit', '-am', 'main change']);
    await repo.gitAllowFail(['merge', 'feature']);

    const { signals, snapshot } = await captureRepoState({ cwd: repo.dir });
    expect(signals.state).toBe('merge_conflict');
    const plan = generateRecoveryPlan({ signals, snapshot }, NOW);
    const complete = plan.alternatives.find((a) => a.id === 'complete_merge')!;
    const markResolved = complete.steps.find((s) => s.id === 'mark-resolved')!;
    expect(markResolved.commands[0].args).toContain(path);
    // Display quotes the spaced path but the raw arg stays intact.
    expect(markResolved.commands[0].display).toContain("'dir with space/file name.txt'");
  });
});
