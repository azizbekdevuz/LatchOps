import { z } from 'zod';
import { IssueTypeSchema, RiskLevelSchema } from './plan.js';

// Normalized signals from snapshot for agent processing
export const SignalsSchema = z.object({
  // Detected issues
  hasConflicts: z.boolean(),
  conflictCount: z.number(),
  conflictFiles: z.array(z.string()),

  isDetachedHead: z.boolean(),
  detachedAt: z.string().optional(), // commit hash

  isRebaseInProgress: z.boolean(),
  rebaseType: z.enum(['merge', 'apply', 'none']),
  rebaseOnto: z.string().optional(),

  // Branch context
  currentBranch: z.string(),
  upstreamBranch: z.string().optional(),
  aheadCount: z.number(),
  behindCount: z.number(),

  // Working tree state
  hasStagedChanges: z.boolean(),
  hasUnstagedChanges: z.boolean(),
  hasUntrackedFiles: z.boolean(),

  // Recovery hints from reflog
  recentCheckouts: z.array(z.object({
    from: z.string(),
    to: z.string(),
    reflogSelector: z.string(),
  })),
  recentResets: z.array(z.object({
    type: z.string(), // soft, mixed, hard
    target: z.string(),
    reflogSelector: z.string(),
  })),

  // Classification result
  primaryIssue: IssueTypeSchema,
  secondaryIssues: z.array(IssueTypeSchema),
  estimatedRisk: RiskLevelSchema,
});

export type Signals = z.infer<typeof SignalsSchema>;
