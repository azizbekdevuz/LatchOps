import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RebaseState } from '@latchops/schema';
import { execGit } from '../utils/exec.js';

/**
 * Detect if a rebase is in progress and gather state info.
 * Uses git rev-parse --git-path to locate rebase directories cross-platform.
 */
export async function detectRebaseState(gitDir: string): Promise<RebaseState> {
  // Check for rebase-merge (interactive rebase)
  const rebaseMergeResult = execGit(['rev-parse', '--git-path', 'rebase-merge']);
  const rebaseMergePath = rebaseMergeResult.stdout.trim();
  const resolvedMergePath = resolve(process.cwd(), rebaseMergePath);

  if (existsSync(resolvedMergePath)) {
    return parseRebaseState(resolvedMergePath, 'merge');
  }

  // Check for rebase-apply (regular rebase, am, etc.)
  const rebaseApplyResult = execGit(['rev-parse', '--git-path', 'rebase-apply']);
  const rebaseApplyPath = rebaseApplyResult.stdout.trim();
  const resolvedApplyPath = resolve(process.cwd(), rebaseApplyPath);

  if (existsSync(resolvedApplyPath)) {
    return parseRebaseState(resolvedApplyPath, 'apply');
  }

  return {
    inProgress: false,
    type: 'none',
  };
}

function parseRebaseState(rebasePath: string, type: 'merge' | 'apply'): RebaseState {
  const state: RebaseState = {
    inProgress: true,
    type,
  };

  // Try to read head-name (original branch)
  const headNamePath = resolve(rebasePath, 'head-name');
  if (existsSync(headNamePath)) {
    const headName = readFileSync(headNamePath, 'utf-8').trim();
    // Remove refs/heads/ prefix
    state.headName = headName.replace(/^refs\/heads\//, '');
  }

  // Try to read onto (target commit)
  const ontoPath = resolve(rebasePath, 'onto');
  if (existsSync(ontoPath)) {
    state.onto = readFileSync(ontoPath, 'utf-8').trim();
  }

  // Try to read msgnum (current step)
  const msgnumPath = resolve(rebasePath, 'msgnum');
  if (existsSync(msgnumPath)) {
    state.currentStep = parseInt(readFileSync(msgnumPath, 'utf-8').trim(), 10);
  }

  // Try to read end (total steps)
  const endPath = resolve(rebasePath, 'end');
  if (existsSync(endPath)) {
    state.totalSteps = parseInt(readFileSync(endPath, 'utf-8').trim(), 10);
  }

  return state;
}
