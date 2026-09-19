import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { captureRepoState, discoverRepository } from './index';
import {
  commitFile,
  createRepo,
  makeTempDir,
  type TempRepo,
} from './test-support/git-fixture';

const repos: TempRepo[] = [];
async function repo(suffix = ''): Promise<TempRepo> {
  const r = await createRepo(suffix);
  repos.push(r);
  return r;
}

afterAll(() => {
  for (const r of repos) r.cleanup();
});

/** Normalize a path for cross-platform comparison (slashes + realpath + case). */
function norm(p: string): string {
  return realpathSync(p).replace(/\\/g, '/').toLowerCase();
}

describe('state-engine integration (real temp repositories)', () => {
  it('classifies a clean repository', async () => {
    const r = await repo();
    await commitFile(r, 'README.md', '# hello\n', 'initial');
    const { signals, snapshot } = await captureRepoState({ cwd: r.dir });
    expect(signals.state).toBe('clean');
    expect(snapshot.branch.head).toBe('main');
    expect(snapshot.recentLog.length).toBeGreaterThanOrEqual(1);
  });

  it('classifies a dirty worktree', async () => {
    const r = await repo();
    await commitFile(r, 'a.txt', 'one\n', 'c1');
    r.writeFile('a.txt', 'one\ntwo\n');
    r.writeFile('untracked.txt', 'new\n');
    const { signals } = await captureRepoState({ cwd: r.dir });
    expect(signals.state).toBe('dirty_worktree');
    expect(signals.worktree.modified).toBeGreaterThanOrEqual(1);
    expect(signals.worktree.untracked).toBeGreaterThanOrEqual(1);
  });

  it('handles repository paths with spaces and filenames with spaces/Unicode', async () => {
    const r = await repo('my repo dir');
    r.writeFile('a file with spaces.txt', 'x\n');
    r.writeFile('юникод файл.txt', 'y\n');
    await r.git(['add', '-A']);
    const { snapshot } = await captureRepoState({ cwd: r.dir });
    expect(snapshot.stagedFiles).toContain('a file with spaces.txt');
    expect(snapshot.stagedFiles).toContain('юникод файл.txt');
  });

  it('detects a detached HEAD', async () => {
    const r = await repo();
    const first = await commitFile(r, 'a.txt', '1\n', 'c1');
    await commitFile(r, 'a.txt', '2\n', 'c2');
    await r.git(['checkout', first]);
    const { signals } = await captureRepoState({ cwd: r.dir });
    expect(signals.state).toBe('detached_head');
    expect(signals.branch.isDetached).toBe(true);
    expect(signals.branch.name).toBeNull();
  });

  it('detects a merge conflict', async () => {
    const r = await repo();
    await commitFile(r, 'file.txt', 'base\n', 'base');
    await r.git(['checkout', '-b', 'feature']);
    await commitFile(r, 'file.txt', 'feature change\n', 'feature');
    await r.git(['checkout', 'main']);
    await commitFile(r, 'file.txt', 'main change\n', 'main');
    const merge = await r.gitAllowFail(['merge', 'feature']);
    expect(merge.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: r.dir });
    expect(signals.state).toBe('merge_conflict');
    expect(signals.worktree.conflicted).toBeGreaterThanOrEqual(1);
    expect(snapshot.mergeHead).toBeTruthy();
    // Conflict blocks should have been extracted from the working file.
    expect(snapshot.unmergedFiles[0]?.conflictBlocks.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('detects an in-progress rebase (with conflict) as rebase_in_progress secondary state', async () => {
    const r = await repo();
    await commitFile(r, 'f.txt', 'base\n', 'base');
    await r.git(['checkout', '-b', 'feature']);
    await commitFile(r, 'f.txt', 'feature\n', 'feat');
    await r.git(['checkout', 'main']);
    await commitFile(r, 'f.txt', 'main\n', 'main2');
    await r.git(['checkout', 'feature']);
    const rebase = await r.gitAllowFail(['rebase', 'main']);
    expect(rebase.ok).toBe(false);

    const { signals, snapshot } = await captureRepoState({ cwd: r.dir });
    expect(snapshot.rebaseState.inProgress).toBe(true);
    expect(signals.operations.rebase).toBe(true);
    // Conflicts take primary classification; rebase is recorded as secondary.
    expect(signals.state).toBe('merge_conflict');
    expect(signals.secondaryStates).toContain('rebase_in_progress');
  });

  it('discovers the repository root when invoked from a nested subdirectory', async () => {
    const r = await repo();
    await commitFile(r, 'a.txt', '1\n', 'c1');
    const deep = join(r.dir, 'sub', 'deep');
    mkdirSync(deep, { recursive: true });
    const ctx = await discoverRepository({ cwd: deep });
    expect(norm(ctx.repoRoot)).toBe(norm(r.dir));
    expect(ctx.isLinkedWorktree).toBe(false);

    // Capturing from the nested dir must reflect the whole repo.
    const { signals } = await captureRepoState({ cwd: deep });
    expect(signals.state).toBe('clean');
  });

  it('detects a linked worktree', async () => {
    const r = await repo();
    await commitFile(r, 'a.txt', '1\n', 'c1');
    const wtPath = join(makeTempDir(), 'linked-wt');
    await r.git(['worktree', 'add', wtPath, '-b', 'wt-branch']);

    const ctx = await discoverRepository({ cwd: wtPath });
    expect(ctx.isLinkedWorktree).toBe(true);
    expect(ctx.gitDir).not.toBe(ctx.commonDir);

    const { signals } = await captureRepoState({ cwd: wtPath });
    expect(signals.state).toBe('clean');
  });
});
