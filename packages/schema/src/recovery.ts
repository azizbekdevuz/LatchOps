import { z } from 'zod';
import { RepoStateSchema } from './repo-signals.js';

/**
 * Canonical recovery + verification schema family (v1).
 *
 * This is the single source of truth for deterministic recovery plans produced
 * by `@latchops/recovery-engine`. It intentionally supersedes the legacy
 * `plan.ts` / `analysis.ts` types (which remain only for the not-yet-migrated
 * web LLM path and are marked `@deprecated`). No LLM ever authors these types.
 */

// ==========================================
// Incident + risk taxonomy
// ==========================================

/**
 * Incident type is the canonical repository state. It reuses
 * `RepoSignalsV1.state` so there is exactly one incident enum across the engine.
 */
export const IncidentTypeV1Schema = RepoStateSchema;
export type IncidentTypeV1 = z.infer<typeof IncidentTypeV1Schema>;

export const RiskLevelV1Schema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type RiskLevelV1 = z.infer<typeof RiskLevelV1Schema>;

// ==========================================
// Typed command model (never shell strings)
// ==========================================

/** How the working directory for a command is resolved at run time. */
export const CwdStrategyV1Schema = z.enum(['repo_root', 'current_dir', 'git_dir']);
export type CwdStrategyV1 = z.infer<typeof CwdStrategyV1Schema>;

/**
 * A single command represented as an argument vector, preserving argument
 * boundaries. It is never concatenated into a shell string. `display` is a
 * human-readable, shell-quoted rendering for terminals/UIs only.
 */
export const RecoveryCommandV1Schema = z.object({
  executable: z.string(),
  args: z.array(z.string()),
  cwdStrategy: CwdStrategyV1Schema.default('repo_root'),
  display: z.string(),
  /**
   * True when one or more args are user-supplied placeholders (e.g. a commit
   * the user must choose). Such commands must not be executed verbatim.
   */
  containsPlaceholder: z.boolean().default(false),
  /** Read-only commands are safe to run for inspection/verification. */
  readOnly: z.boolean().default(false),
});
export type RecoveryCommandV1 = z.infer<typeof RecoveryCommandV1Schema>;

// ==========================================
// Signal checks (deterministic verification primitives)
// ==========================================

export const SignalCheckOperatorV1Schema = z.enum([
  'eq',
  'neq',
  'gte',
  'lte',
  'gt',
  'lt',
  'isTrue',
  'isFalse',
  'isEmpty',
  'isNonEmpty',
  'includes',
  'excludes',
]);
export type SignalCheckOperatorV1 = z.infer<typeof SignalCheckOperatorV1Schema>;

/**
 * A deterministic assertion over a dotted field path within `RepoSignalsV1`
 * (e.g. `worktree.conflicted`, `operations.rebase`, `state`).
 */
export const SignalCheckV1Schema = z.object({
  field: z.string(),
  operator: SignalCheckOperatorV1Schema,
  value: z.unknown().optional(),
  describe: z.string(),
});
export type SignalCheckV1 = z.infer<typeof SignalCheckV1Schema>;

// ==========================================
// Undo + verification
// ==========================================

export const ReversibilityV1Schema = z.enum(['reversible', 'partial', 'irreversible']);
export type ReversibilityV1 = z.infer<typeof ReversibilityV1Schema>;

export const UndoStrategyV1Schema = z.object({
  reversibility: ReversibilityV1Schema,
  description: z.string(),
  commands: z.array(RecoveryCommandV1Schema).default([]),
  /** Concrete ref/branch/reflog selector that undo relies on, when available. */
  recoveryReference: z.string().optional(),
  /** True only when undo is guaranteed to fully restore the prior state. */
  guaranteed: z.boolean(),
  /** Stated caveats, especially when undo is not guaranteed. */
  notes: z.string().optional(),
});
export type UndoStrategyV1 = z.infer<typeof UndoStrategyV1Schema>;

export const VerificationExpectationV1Schema = z.object({
  description: z.string(),
  /** Deterministic before/after signal assertions. */
  signalChecks: z.array(SignalCheckV1Schema).default([]),
  /** Read-only commands the user may run to confirm the outcome. */
  commands: z.array(RecoveryCommandV1Schema).default([]),
});
export type VerificationExpectationV1 = z.infer<typeof VerificationExpectationV1Schema>;

// ==========================================
// Recovery step
// ==========================================

export const ApplicabilityV1Schema = z.object({
  /** Human description of when this step applies. */
  appliesWhen: z.string(),
  /** True when the step is a user decision rather than a required action. */
  optional: z.boolean().default(false),
});
export type ApplicabilityV1 = z.infer<typeof ApplicabilityV1Schema>;

export const RecoveryStepV1Schema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  commands: z.array(RecoveryCommandV1Schema),
  risk: RiskLevelV1Schema,
  destructive: z.boolean(),
  requiresConfirmation: z.boolean(),
  prerequisites: z.array(z.string()),
  expectedOutcome: z.string(),
  undoStrategy: UndoStrategyV1Schema,
  verification: VerificationExpectationV1Schema,
  applicability: ApplicabilityV1Schema,
});
export type RecoveryStepV1 = z.infer<typeof RecoveryStepV1Schema>;

// ==========================================
// Alternatives (mutually exclusive paths)
// ==========================================

export const RecoveryAlternativeV1Schema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  risk: RiskLevelV1Schema,
  recommended: z.boolean().default(false),
  /** What the user gains and gives up by choosing this path. */
  tradeoffs: z.string(),
  steps: z.array(RecoveryStepV1Schema),
  /** Expected end state if this alternative is followed to completion. */
  expectedOutcome: VerificationExpectationV1Schema,
});
export type RecoveryAlternativeV1 = z.infer<typeof RecoveryAlternativeV1Schema>;

// ==========================================
// Recovery plan
// ==========================================

/** Marker identifying the author of the plan. Never implies an LLM. */
export const GeneratedByV1Schema = z.literal('deterministic_engine');
export type GeneratedByV1 = z.infer<typeof GeneratedByV1Schema>;

export const RecoveryPlanV1Schema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  generatedBy: GeneratedByV1Schema,
  engineVersion: z.string(),

  incidentType: IncidentTypeV1Schema,
  summary: z.string(),
  risk: RiskLevelV1Schema,

  /** Human-readable conditions that must hold before acting. */
  preconditions: z.array(z.string()),

  /** Common/sequential steps. May be empty when only alternatives apply. */
  steps: z.array(RecoveryStepV1Schema),

  /** Mutually exclusive recovery paths (e.g. complete vs abort). */
  alternatives: z.array(RecoveryAlternativeV1Schema).default([]),

  warnings: z.array(z.string()),

  /** True when a human must decide before any automated recovery is safe. */
  manualReviewRequired: z.boolean(),

  /** True when evidence was insufficient to produce a complete plan. */
  incomplete: z.boolean().default(false),
});
export type RecoveryPlanV1 = z.infer<typeof RecoveryPlanV1Schema>;

// ==========================================
// Plan artifact (persisted for the verify round-trip)
// ==========================================

/**
 * What `latchops plan --json --output <file>` writes. It bundles the plan with
 * the before-state signals and minimal snapshot metadata so that
 * `latchops verify --plan <file>` has full before-context to compare against.
 */
export const PlanArtifactV1Schema = z.object({
  version: z.literal(1),
  kind: z.literal('latchops-plan-artifact'),
  generatedAt: z.string().datetime(),
  repoRoot: z.string(),
  incidentType: IncidentTypeV1Schema,
  /** Optional alternative the user intends to follow. */
  selectedAlternativeId: z.string().nullable().default(null),
  plan: RecoveryPlanV1Schema,
  /** Import lazily to avoid a hard cycle; validated as the RepoSignalsV1 shape. */
  beforeSignals: z.unknown(),
});
export type PlanArtifactV1 = z.infer<typeof PlanArtifactV1Schema>;

// ==========================================
// Verification result
// ==========================================

export const VerificationStatusV1Schema = z.enum([
  'not_started',
  'in_progress',
  'succeeded',
  'failed',
  'manual_review',
]);
export type VerificationStatusV1 = z.infer<typeof VerificationStatusV1Schema>;

export const ChangedSignalV1Schema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type ChangedSignalV1 = z.infer<typeof ChangedSignalV1Schema>;

export const VerificationResultV1Schema = z.object({
  version: z.literal(1),
  status: VerificationStatusV1Schema,
  incidentType: IncidentTypeV1Schema,
  selectedAlternativeId: z.string().nullable(),
  beforeState: IncidentTypeV1Schema,
  afterState: IncidentTypeV1Schema,
  reasons: z.array(z.string()),
  changedSignals: z.array(ChangedSignalV1Schema),
  remainingIssues: z.array(z.string()),
  checkedAt: z.string().datetime(),
});
export type VerificationResultV1 = z.infer<typeof VerificationResultV1Schema>;
