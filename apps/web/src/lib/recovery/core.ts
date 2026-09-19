/**
 * Pure, dependency-light core of the deterministic recovery pipeline.
 *
 * This module has NO database or I/O dependencies so it can be unit-tested in
 * isolation. It wraps the deterministic engines and the Zod validation used by
 * the web app:
 *
 *   validate SnapshotV1 -> computeRepoSignals -> generateRecoveryPlan -> RecoveryPlanV1
 *
 * It never calls Python and never calls an LLM.
 */

import {
  RepoSignalsV1Schema,
  RecoveryPlanV1Schema,
  SnapshotV1Schema,
  type RepoSignalsV1,
  type RecoveryPlanV1,
  type SnapshotV1,
} from '@latchops/schema';
import { computeRepoSignals } from '@latchops/state-engine';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { createHash } from 'crypto';

/**
 * Deterministic pipeline stages. These replace the prototype "agent graph"
 * trace stages and describe the real, ordered steps of the pipeline.
 */
export const PIPELINE_STAGES = {
  snapshotValidated: 'snapshot_validated',
  signalsComputed: 'signals_computed',
  incidentClassified: 'incident_classified',
  planGenerated: 'plan_generated',
  verificationCompleted: 'verification_completed',
} as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[keyof typeof PIPELINE_STAGES];

export const DETERMINISTIC_STAGE_ORDER: PipelineStage[] = [
  PIPELINE_STAGES.snapshotValidated,
  PIPELINE_STAGES.signalsComputed,
  PIPELINE_STAGES.incidentClassified,
  PIPELINE_STAGES.planGenerated,
  PIPELINE_STAGES.verificationCompleted,
];

export interface AnalysisResult {
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
}

/**
 * Run the pure deterministic analysis over a validated snapshot. No I/O.
 * Same snapshot in -> same signals + plan out.
 */
export function analyzeSnapshot(snapshot: SnapshotV1): AnalysisResult {
  const signals = computeRepoSignals(snapshot);
  const plan = generateRecoveryPlan({ snapshot, signals });
  return { signals, plan };
}

// ---- Zod-validated (de)serialization for persisted JSON ----

export function parseSnapshot(json: unknown): SnapshotV1 {
  return SnapshotV1Schema.parse(json);
}

/** Validate persisted signals JSON. Throws on malformed data (no silent cast). */
export function parseSignals(json: unknown): RepoSignalsV1 {
  return RepoSignalsV1Schema.parse(json);
}

/** Validate persisted plan JSON. Throws on malformed data (no silent cast). */
export function parsePlan(json: unknown): RecoveryPlanV1 {
  return RecoveryPlanV1Schema.parse(json);
}

export function safeParsePlan(json: unknown): RecoveryPlanV1 | null {
  const r = RecoveryPlanV1Schema.safeParse(json);
  return r.success ? r.data : null;
}

export function safeParseSignals(json: unknown): RepoSignalsV1 | null {
  const r = RepoSignalsV1Schema.safeParse(json);
  return r.success ? r.data : null;
}

// ---- Titles + repo hash ----

export function generateTitle(snapshot: SnapshotV1): string {
  const parts: string[] = [];
  if (snapshot.unmergedFiles.length > 0) parts.push('Merge Conflict');
  else if (snapshot.rebaseState.inProgress) parts.push('Rebase');
  else if (snapshot.isDetachedHead) parts.push('Detached HEAD');
  parts.push(`on ${snapshot.branch.head}`);
  return parts.join(' ') || 'Git Recovery Session';
}

export function repoRootHash(repoRoot: string): string {
  return createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
}
