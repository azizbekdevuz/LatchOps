/**
 * @latchops/recovery-engine
 *
 * Deterministic recovery + verification engine. Consumes canonical
 * `RepoSignalsV1` (plus the `SnapshotV1` they were derived from) and emits safe,
 * structured, advisory `RecoveryPlanV1` plans. It never executes commands and
 * never calls an LLM.
 */

export { ENGINE_VERSION } from './version.js';

// Plan generation
export {
  generateRecoveryPlan,
  selectIncidentType,
  type GeneratePlanOptions,
  type PlanInput,
  type PlanBody,
} from './plan/index.js';

// Verification
export { verifyRecovery, type VerifyInput } from './verify/index.js';
export { resolveSignalField, evaluateSignalCheck } from './verify/signal-checks.js';

// Command + safety model
export {
  command,
  git,
  renderDisplay,
  shellQuoteForDisplay,
  type CommandOptions,
} from './command.js';
export {
  classifyCommand,
  aggregateSafety,
  maxRisk,
  riskAtLeast,
  type CommandSafety,
} from './safety.js';

// Reflog / target selection
export { analyzeDetached, rescueBranchName, type DetachedAnalysis } from './reflog.js';

// Re-export the canonical schema family for convenience.
export type {
  IncidentTypeV1,
  RiskLevelV1,
  RecoveryPlanV1,
  RecoveryStepV1,
  RecoveryCommandV1,
  RecoveryAlternativeV1,
  UndoStrategyV1,
  VerificationExpectationV1,
  VerificationResultV1,
  VerificationStatusV1,
  PlanArtifactV1,
  SignalCheckV1,
  ChangedSignalV1,
} from '@latchops/schema';
