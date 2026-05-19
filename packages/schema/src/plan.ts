import { z } from 'zod';

// Issue types we handle
export const IssueTypeSchema = z.enum([
  'merge_conflict',
  'detached_head',
  'rebase_in_progress',
  'clean',
  'unknown',
]);

export type IssueType = z.infer<typeof IssueTypeSchema>;

// Risk levels
export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);

export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// A single step in the recovery plan
export const PlanStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  commands: z.array(z.string()), // git commands to execute
  expected: z.string(), // what should happen after running
  undo: z.object({
    possible: z.boolean(),
    commands: z.array(z.string()), // commands to undo this step
    description: z.string(),
  }),
  dangerous: z.boolean(), // requires explicit dangerous_allowed flag
  warning: z.string().optional(), // warning text for dangerous operations
  requiresUserInput: z.boolean().default(false), // e.g., editing conflict markers
  userInputHint: z.string().optional(),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

// Complete recovery plan
export const PlanV1Schema = z.object({
  version: z.literal(1),
  timestamp: z.string().datetime(),
  issueType: IssueTypeSchema,
  issueSummary: z.string(),
  risk: RiskLevelSchema,
  steps: z.array(PlanStepSchema),

  // Alternative safer approaches if dangerous operations are suggested
  saferAlternatives: z.array(z.object({
    description: z.string(),
    tradeoff: z.string(), // what you lose by using safer approach
    steps: z.array(PlanStepSchema),
  })).optional(),

  // Reflog-based recovery path (always included for safety)
  reflogRecovery: z.object({
    description: z.string(),
    relevantEntries: z.array(z.string()), // reflog selectors like HEAD@{2}
    recoveryCommand: z.string(),
  }).optional(),
});

export type PlanV1 = z.infer<typeof PlanV1Schema>;

// Verification result after user runs some steps
export const VerificationResultSchema = z.object({
  stepsCompleted: z.array(z.string()), // step IDs
  issueResolved: z.boolean(),
  remainingIssues: z.array(z.string()),
  nextStepId: z.string().optional(),
  guidance: z.string(),
});

export type VerificationResult = z.infer<typeof VerificationResultSchema>;
