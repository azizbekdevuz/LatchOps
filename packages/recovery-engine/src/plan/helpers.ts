import type {
  ApplicabilityV1,
  RecoveryCommandV1,
  RecoveryPlanV1,
  RecoveryStepV1,
  RiskLevelV1,
  SignalCheckOperatorV1,
  SignalCheckV1,
  UndoStrategyV1,
  VerificationExpectationV1,
} from '@latchops/schema';
import type { RepoSignalsV1, SnapshotV1 } from '@latchops/schema';
import { aggregateSafety } from '../safety.js';

/** Input shared by all plan templates. */
export interface PlanInput {
  snapshot: SnapshotV1;
  signals: RepoSignalsV1;
}

/**
 * The incident-specific body of a plan. The dispatcher fills in the fixed
 * envelope fields (`version`, `generatedAt`, `generatedBy`, `engineVersion`).
 */
export type PlanBody = Omit<
  RecoveryPlanV1,
  'version' | 'generatedAt' | 'generatedBy' | 'engineVersion'
>;

// ---------- signal check builders ----------

export function check(
  field: string,
  operator: SignalCheckOperatorV1,
  describe: string,
  value?: unknown,
): SignalCheckV1 {
  return value === undefined ? { field, operator, describe } : { field, operator, value, describe };
}

// ---------- verification builders ----------

export function expectation(
  description: string,
  signalChecks: SignalCheckV1[] = [],
  commands: RecoveryCommandV1[] = [],
): VerificationExpectationV1 {
  return { description, signalChecks, commands };
}

// ---------- undo builders ----------

export function undo(
  reversibility: UndoStrategyV1['reversibility'],
  description: string,
  opts: {
    commands?: RecoveryCommandV1[];
    recoveryReference?: string;
    guaranteed?: boolean;
    notes?: string;
  } = {},
): UndoStrategyV1 {
  return {
    reversibility,
    description,
    commands: opts.commands ?? [],
    recoveryReference: opts.recoveryReference,
    // Guaranteed defaults to true only for fully reversible undo, and only when
    // the caller has not said otherwise.
    guaranteed: opts.guaranteed ?? reversibility === 'reversible',
    notes: opts.notes,
  };
}

/** Undo strategy for inherently read-only/inspection steps. */
export function undoNoop(): UndoStrategyV1 {
  return undo('reversible', 'No changes are made; nothing to undo.', { guaranteed: true });
}

// ---------- step builder ----------

export interface StepInput {
  id: string;
  title: string;
  description: string;
  commands: RecoveryCommandV1[];
  expectedOutcome: string;
  undoStrategy: UndoStrategyV1;
  verification: VerificationExpectationV1;
  prerequisites?: string[];
  applicability?: ApplicabilityV1;
  /** Override the auto-derived risk (usually left unset). */
  risk?: RiskLevelV1;
  /** Override the auto-derived destructive flag (usually left unset). */
  destructive?: boolean;
  /** Override auto-derived confirmation requirement. */
  requiresConfirmation?: boolean;
}

/**
 * Build a recovery step, deriving `risk`/`destructive`/`requiresConfirmation`
 * from the actual commands so safety metadata cannot drift from behaviour.
 */
export function buildStep(order: number, input: StepInput): RecoveryStepV1 {
  const safety = aggregateSafety(input.commands);
  const destructive = input.destructive ?? safety.destructive;
  const risk = input.risk ?? safety.risk;
  const requiresConfirmation =
    input.requiresConfirmation ?? (destructive || risk === 'high' || risk === 'critical');

  return {
    id: input.id,
    order,
    title: input.title,
    description: input.description,
    commands: input.commands,
    risk,
    destructive,
    requiresConfirmation,
    prerequisites: input.prerequisites ?? [],
    expectedOutcome: input.expectedOutcome,
    undoStrategy: input.undoStrategy,
    verification: input.verification,
    applicability: input.applicability ?? { appliesWhen: 'always', optional: false },
  };
}

/** Assign sequential order numbers starting at 1 to a list of step inputs. */
export function orderSteps(steps: StepInput[]): RecoveryStepV1[] {
  return steps.map((s, i) => buildStep(i + 1, s));
}
