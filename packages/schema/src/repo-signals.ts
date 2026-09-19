import { z } from 'zod';

/**
 * Canonical deterministic repository-state contract (v1).
 *
 * `RepoSignalsV1` is the single normalized output of the deterministic state
 * engine. It is produced only by rule-based code (never an LLM) and every
 * classification exposes the human-readable `reasons` that produced it.
 *
 * Phase 1 scope: the classifier emits exactly the six states below. Additional
 * incident types (cherry_pick_in_progress, bisect_in_progress, diverged_branch,
 * failed_ci, risky_force_push, …) are added in later phases behind their own
 * schema/version bumps.
 */
export const RepoStateSchema = z.enum([
  'clean',
  'dirty_worktree',
  'merge_conflict',
  'detached_head',
  'rebase_in_progress',
  'unknown',
]);

export type RepoState = z.infer<typeof RepoStateSchema>;

export const RepoBranchSignalsSchema = z.object({
  /** Branch name, or null when detached or on an unborn branch. */
  name: z.string().nullable(),
  /** Current commit oid, or null when unborn. */
  oid: z.string().nullable(),
  /** Configured upstream tracking ref, if any. */
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  isDetached: z.boolean(),
  isUnborn: z.boolean(),
});

export type RepoBranchSignals = z.infer<typeof RepoBranchSignalsSchema>;

export const RepoWorktreeSignalsSchema = z.object({
  staged: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  conflictedPaths: z.array(z.string()),
  /** True when there are staged, modified, or untracked changes. */
  isDirty: z.boolean(),
});

export type RepoWorktreeSignals = z.infer<typeof RepoWorktreeSignalsSchema>;

export const RepoOperationSignalsSchema = z.object({
  merge: z.boolean(),
  rebase: z.boolean(),
  rebaseType: z.enum(['merge', 'apply', 'none']),
  cherryPick: z.boolean(),
  revert: z.boolean(),
  bisect: z.boolean(),
});

export type RepoOperationSignals = z.infer<typeof RepoOperationSignalsSchema>;

export const RepoSignalsV1Schema = z.object({
  version: z.literal(1),
  /** Primary deterministic classification. */
  state: RepoStateSchema,
  /** Other applicable states, in priority order (subset of the six). */
  secondaryStates: z.array(RepoStateSchema),
  /** Human-readable justifications for the classification. Always populated. */
  reasons: z.array(z.string()),
  branch: RepoBranchSignalsSchema,
  worktree: RepoWorktreeSignalsSchema,
  operations: RepoOperationSignalsSchema,
});

export type RepoSignalsV1 = z.infer<typeof RepoSignalsV1Schema>;
