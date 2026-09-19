/**
 * Canonical deterministic recovery pipeline for the web app.
 *
 * This is the single server-side analysis path:
 *
 *   validate SnapshotV1
 *     -> computeRepoSignals (@latchops/state-engine, pure classifier)
 *     -> generateRecoveryPlan (@latchops/recovery-engine)
 *     -> canonical RecoveryPlanV1
 *
 * It never calls Python, never calls an LLM, and never fabricates analysis.
 * All persisted JSON is validated with Zod before write and after read.
 */

import { type RepoSignalsV1, type RecoveryPlanV1, type SnapshotV1 } from '@latchops/schema';
import {
  createAnalysis,
  createConflictFile,
  createConflictHunk,
  createSession,
  createSnapshot,
  deleteAnalysisBySnapshotId,
  saveTrace,
  updateSessionStatus,
  type Analysis,
} from '@/lib/db';
import {
  analyzeSnapshot,
  generateTitle,
  parseSnapshot,
  PIPELINE_STAGES,
  repoRootHash,
} from './core';

// Re-export the pure core so existing route imports (`from '@/lib/recovery/pipeline'`)
// keep working. The pure functions live in `./core` (no DB dependency) so they
// can be unit-tested in isolation.
export {
  PIPELINE_STAGES,
  DETERMINISTIC_STAGE_ORDER,
  analyzeSnapshot,
  parseSnapshot,
  parseSignals,
  parsePlan,
  safeParsePlan,
  safeParseSignals,
  generateTitle,
  repoRootHash,
} from './core';
export type { PipelineStage, AnalysisResult } from './core';

// ============================================
// Persistence
// ============================================

/**
 * Persist conflict files/hunks from the snapshot's real three-way content.
 * No AI explanation/suggestion fields are written — those belong to the future
 * (Phase 8) explanation layer.
 */
async function persistConflictsFromSnapshot(analysisId: string, snapshot: SnapshotV1): Promise<void> {
  for (const file of snapshot.unmergedFiles) {
    const conflictFile = await createConflictFile({ analysisId, path: file.path });
    for (let i = 0; i < file.conflictBlocks.length; i++) {
      const block = file.conflictBlocks[i];
      await createConflictHunk({
        conflictFileId: conflictFile.id,
        index: i,
        startLine: block.startLine,
        endLine: block.endLine,
        baseText: block.context,
        oursText: block.oursContent,
        theirsText: block.theirsContent,
      });
    }
  }
}

/**
 * Persist a canonical analysis (signals + plan) for a snapshot, replacing any
 * prior analysis for that snapshot, and write deterministic pipeline traces.
 */
export async function persistAnalysis(params: {
  gitSessionId: string;
  snapshotId: string;
  snapshot: SnapshotV1;
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
  pipelineStart: number;
}): Promise<Analysis> {
  const { gitSessionId, snapshotId, snapshot, signals, plan, pipelineStart } = params;

  await deleteAnalysisBySnapshotId(snapshotId);

  const analysis = await createAnalysis({
    gitSessionId,
    snapshotId,
    issueType: signals.state,
    summary: plan.summary,
    signalsJson: signals,
    planJson: plan,
    risk: plan.risk,
    engineVersion: plan.engineVersion,
  });

  await persistConflictsFromSnapshot(analysis.id, snapshot);

  // Deterministic pipeline traces (no agent nodes / graph traces).
  await saveTrace(gitSessionId, PIPELINE_STAGES.signalsComputed, snapshotId, null, signals, pipelineStart);
  await saveTrace(
    gitSessionId,
    PIPELINE_STAGES.incidentClassified,
    snapshotId,
    null,
    { incidentType: signals.state, secondaryStates: signals.secondaryStates, risk: plan.risk, reasons: signals.reasons },
    pipelineStart,
  );
  await saveTrace(gitSessionId, PIPELINE_STAGES.planGenerated, snapshotId, null, plan, pipelineStart);

  return analysis;
}

// ============================================
// Ingest orchestration (shared by CLI ingest + web import)
// ============================================

export interface IngestResult {
  sessionId: string;
  incidentId?: string;
  incidentType: RepoSignalsV1['state'];
  summary: string;
  risk: RecoveryPlanV1['risk'];
}

/**
 * Full deterministic ingest: create session + snapshot, analyze, persist, and
 * write traces. Used by anonymous legacy ingest only.
 */
export async function ingestSnapshot(params: {
  rawSnapshot: unknown;
  userId: string | null;
}): Promise<IngestResult> {
  if (params.userId) {
    return ingestForAuthenticatedUser(params.rawSnapshot, params.userId);
  }

  const pipelineStart = Date.now();
  const snapshot = parseSnapshot(params.rawSnapshot);

  const gitSession = await createSession({
    title: generateTitle(snapshot),
    os: snapshot.platform,
    repoRootHash: repoRootHash(snapshot.repoRoot),
    userId: params.userId,
    status: 'analyzing',
  });

  const snapshotRecord = await createSnapshot({
    gitSessionId: gitSession.id,
    snapshotJson: snapshot,
  });

  await saveTrace(
    gitSession.id,
    PIPELINE_STAGES.snapshotValidated,
    snapshotRecord.id,
    { source: 'api' },
    { snapshotId: snapshotRecord.id, version: snapshot.version },
    pipelineStart,
  );

  const { signals, plan } = analyzeSnapshot(snapshot);

  await persistAnalysis({
    gitSessionId: gitSession.id,
    snapshotId: snapshotRecord.id,
    snapshot,
    signals,
    plan,
    pipelineStart,
  });

  await updateSessionStatus(gitSession.id, 'ready');

  return {
    sessionId: gitSession.id,
    incidentType: signals.state,
    summary: plan.summary,
    risk: plan.risk,
  };
}

export async function ingestForAuthenticatedUser(rawSnapshot: unknown, userId: string): Promise<IngestResult> {
  const { phase4DualWriteEnabled, phase4LegacyWritesEnabled } = await import('@/lib/domain/phase4-flags');
  if (phase4DualWriteEnabled()) {
    const { ingestSnapshotDualWrite } = await import('@/lib/recovery/dual-write-ingest');
    const result = await ingestSnapshotDualWrite({ rawSnapshot, userId });
    return result;
  }

  if (phase4LegacyWritesEnabled()) {
    return ingestSnapshotLegacyOwned(rawSnapshot, userId);
  }

  const { ensurePersonalOrganization } = await import('@/lib/domain/organization-service');
  const { ingestIncident } = await import('@/lib/domain/incident-service');
  const org = await ensurePersonalOrganization(userId);
  const snapshot = parseSnapshot(rawSnapshot);
  const { incident } = await ingestIncident({
    organizationId: org.id,
    snapshot,
    userId,
    source: 'web_import',
  });
  return {
    sessionId: incident.id,
    incidentId: incident.id,
    incidentType: incident.incidentType as IngestResult['incidentType'],
    summary: incident.summary ?? '',
    risk: (incident.risk as IngestResult['risk']) ?? 'none',
  };
}

async function ingestSnapshotLegacyOwned(rawSnapshot: unknown, userId: string): Promise<IngestResult> {
  const pipelineStart = Date.now();
  const snapshot = parseSnapshot(rawSnapshot);

  const gitSession = await createSession({
    title: generateTitle(snapshot),
    os: snapshot.platform,
    repoRootHash: repoRootHash(snapshot.repoRoot),
    userId,
    status: 'analyzing',
  });

  const snapshotRecord = await createSnapshot({
    gitSessionId: gitSession.id,
    snapshotJson: snapshot,
  });

  await saveTrace(
    gitSession.id,
    PIPELINE_STAGES.snapshotValidated,
    snapshotRecord.id,
    { source: 'api' },
    { snapshotId: snapshotRecord.id, version: snapshot.version },
    pipelineStart,
  );

  const { signals, plan } = analyzeSnapshot(snapshot);

  await persistAnalysis({
    gitSessionId: gitSession.id,
    snapshotId: snapshotRecord.id,
    snapshot,
    signals,
    plan,
    pipelineStart,
  });

  await updateSessionStatus(gitSession.id, 'ready');

  return {
    sessionId: gitSession.id,
    incidentType: signals.state,
    summary: plan.summary,
    risk: plan.risk,
  };
}
