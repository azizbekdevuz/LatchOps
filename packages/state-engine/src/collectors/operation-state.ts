import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RebaseState } from '@latchops/schema';
import { gitPath, type RepositoryContext } from '../discovery.js';

/**
 * In-progress git operations, detected via `rev-parse --git-path` so that
 * paths resolve correctly for linked worktrees and subdirectory invocation.
 *
 * Phase 1 classification only consumes `rebase` and `merge`, but cherry-pick,
 * revert, and bisect are detected here as well for forward compatibility and
 * to keep detection in one deterministic place.
 */
export interface OperationState {
  rebase: RebaseState;
  merge: {
    inProgress: boolean;
    /** MERGE_HEAD commit if a merge is in progress. */
    head?: string;
    /** Default merge commit message (MERGE_MSG), if present. */
    message?: string;
  };
  cherryPick: boolean;
  revert: boolean;
  bisect: boolean;
}

async function pathExists(name: string, ctx: RepositoryContext): Promise<string | null> {
  const abs = await gitPath(name, ctx);
  return existsSync(abs) ? abs : null;
}

function readTrimmed(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n').trim();
  } catch {
    return undefined;
  }
}

export async function detectOperationState(ctx: RepositoryContext): Promise<OperationState> {
  const rebaseMergeDir = await pathExists('rebase-merge', ctx);
  const rebaseApplyDir = await pathExists('rebase-apply', ctx);

  let rebase: RebaseState;
  if (rebaseMergeDir) {
    rebase = parseRebaseDir(rebaseMergeDir, 'merge');
  } else if (rebaseApplyDir) {
    rebase = parseRebaseDir(rebaseApplyDir, 'apply');
  } else {
    rebase = { inProgress: false, type: 'none' };
  }

  const mergeHeadPath = await pathExists('MERGE_HEAD', ctx);
  const merge: OperationState['merge'] = { inProgress: mergeHeadPath !== null };
  if (mergeHeadPath) {
    merge.head = readTrimmed(mergeHeadPath);
    const mergeMsgPath = await gitPath('MERGE_MSG', ctx);
    const msg = readTrimmed(mergeMsgPath);
    if (msg) merge.message = msg;
  }

  return {
    rebase,
    merge,
    cherryPick: (await pathExists('CHERRY_PICK_HEAD', ctx)) !== null,
    revert: (await pathExists('REVERT_HEAD', ctx)) !== null,
    bisect: (await pathExists('BISECT_LOG', ctx)) !== null,
  };
}

function parseRebaseDir(dir: string, type: 'merge' | 'apply'): RebaseState {
  const state: RebaseState = { inProgress: true, type };

  const headName = readTrimmed(resolve(dir, 'head-name'));
  if (headName) state.headName = headName.replace(/^refs\/heads\//, '');

  const onto = readTrimmed(resolve(dir, 'onto'));
  if (onto) state.onto = onto;

  const msgnum = readTrimmed(resolve(dir, 'msgnum'));
  if (msgnum) {
    const n = Number.parseInt(msgnum, 10);
    if (!Number.isNaN(n)) state.currentStep = n;
  }

  const end = readTrimmed(resolve(dir, 'end'));
  if (end) {
    const n = Number.parseInt(end, 10);
    if (!Number.isNaN(n)) state.totalSteps = n;
  }

  return state;
}
