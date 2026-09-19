/**
 * Atomic legacy + canonical ingest when PHASE4_DUAL_WRITE=true.
 * All writes share one Prisma transaction; failure rolls back both sides.
 */

import type { Prisma } from '@prisma/client';
import type { SnapshotV1 } from '@latchops/schema';
import prisma from '../prisma';
import { recordAuthoritative } from '../domain/audit-service';
import { ensurePersonalOrganizationInTx } from '../domain/organization-service';
import { upsertRepositoryInTx } from '../domain/repository-service';
import {
  analyzeSnapshot,
  generateTitle,
  parseSnapshot,
  PIPELINE_STAGES,
  repoRootHash,
} from './core';
import type { IngestResult } from './pipeline';

type Tx = Prisma.TransactionClient;

async function persistConflictsInTx(tx: Tx, analysisId: string, snapshot: SnapshotV1) {
  for (const file of snapshot.unmergedFiles) {
    const conflictFile = await tx.conflictFile.create({
      data: { analysisId, path: file.path },
    });
    for (let i = 0; i < file.conflictBlocks.length; i++) {
      const block = file.conflictBlocks[i]!;
      await tx.conflictHunk.create({
        data: {
          conflictFileId: conflictFile.id,
          index: i,
          startLine: block.startLine,
          endLine: block.endLine,
          baseText: block.context,
          oursText: block.oursContent,
          theirsText: block.theirsContent,
        },
      });
    }
  }
}

async function persistLegacyAnalysisInTx(
  tx: Tx,
  params: {
    gitSessionId: string;
    snapshotId: string;
    snapshot: SnapshotV1;
    signals: ReturnType<typeof analyzeSnapshot>['signals'];
    plan: ReturnType<typeof analyzeSnapshot>['plan'];
    pipelineStart: number;
  },
) {
  const { gitSessionId, snapshotId, snapshot, signals, plan, pipelineStart } = params;

  await tx.analysis.deleteMany({ where: { snapshotId } });

  const analysis = await tx.analysis.create({
    data: {
      gitSessionId,
      snapshotId,
      issueType: signals.state,
      summary: plan.summary,
      signalsJson: signals as Prisma.InputJsonValue,
      planJson: plan as Prisma.InputJsonValue,
      risk: plan.risk,
      engineVersion: plan.engineVersion,
    },
  });

  await persistConflictsInTx(tx, analysis.id, snapshot);

  const trace = (stage: string, input: unknown, output: unknown) =>
    tx.trace.create({
      data: {
        gitSessionId,
        stage,
        snapshotId,
        inputJson: input as Prisma.InputJsonValue,
        outputJson: output as Prisma.InputJsonValue,
        durationMs: pipelineStart ? Date.now() - pipelineStart : undefined,
        success: true,
      },
    });

  await trace(PIPELINE_STAGES.signalsComputed, null, signals);
  await trace(PIPELINE_STAGES.incidentClassified, null, {
    incidentType: signals.state,
    secondaryStates: signals.secondaryStates,
    risk: plan.risk,
    reasons: signals.reasons,
  });
  await trace(PIPELINE_STAGES.planGenerated, null, plan);

  return analysis;
}

async function persistCanonicalInTx(
  tx: Tx,
  params: {
    organizationId: string;
    repositoryId: string;
    snapshot: SnapshotV1;
    snapshotId: string;
    gitSessionId: string;
    userId: string;
    signals: ReturnType<typeof analyzeSnapshot>['signals'];
    plan: ReturnType<typeof analyzeSnapshot>['plan'];
    incomplete: boolean;
  },
) {
  const incident = await tx.incident.create({
    data: {
      organizationId: params.organizationId,
      repositoryId: params.repositoryId,
      createdById: params.userId,
      title: generateTitle(params.snapshot),
      status: params.incomplete ? 'detected' : 'plan_ready',
      source: 'web_import',
      incidentType: params.signals.state,
      risk: params.plan.risk,
      summary: params.plan.summary,
      engineVersion: params.plan.engineVersion,
      legacyGitSessionId: params.gitSessionId,
    },
  });

  await tx.snapshot.update({
    where: { id: params.snapshotId },
    data: { incidentId: incident.id },
  });

  await tx.recoveryPlanRecord.create({
    data: {
      incidentId: incident.id,
      organizationId: params.organizationId,
      sourceSnapshotId: params.snapshotId,
      version: 1,
      isCurrent: true,
      signalsJson: params.signals as Prisma.InputJsonValue,
      planJson: params.plan as Prisma.InputJsonValue,
      incidentType: params.signals.state,
      summary: params.plan.summary,
      risk: params.plan.risk,
      engineVersion: params.plan.engineVersion,
      incomplete: params.incomplete,
    },
  });

  await tx.gitSession.update({
    where: { id: params.gitSessionId },
    data: { incidentId: incident.id },
  });

  await tx.analysis.update({
    where: { id: (await tx.analysis.findFirstOrThrow({ where: { snapshotId: params.snapshotId } })).id },
    data: { incidentId: incident.id },
  });

  await recordAuthoritative(tx, {
    organizationId: params.organizationId,
    incidentId: incident.id,
    actorUserId: params.userId,
    actorType: 'user',
    action: 'incident.ingested',
    payload: { source: 'web_import', dualWrite: true },
  });

  return incident;
}

export async function ingestSnapshotDualWrite(params: {
  rawSnapshot: unknown;
  userId: string;
}): Promise<IngestResult> {
  const pipelineStart = Date.now();
  const snapshot = parseSnapshot(params.rawSnapshot);
  const { signals, plan } = analyzeSnapshot(snapshot);
  const incomplete = plan.incomplete;

  return prisma.$transaction(async (tx) => {
    const org = await ensurePersonalOrganizationInTx(tx, params.userId);
    const repository = await upsertRepositoryInTx(tx, org.id, snapshot);

    const gitSession = await tx.gitSession.create({
      data: {
        title: generateTitle(snapshot),
        os: snapshot.platform,
        repoRootHash: repoRootHash(snapshot.repoRoot),
        userId: params.userId,
        status: 'analyzing',
      },
    });

    const snapshotRecord = await tx.snapshot.create({
      data: {
        gitSessionId: gitSession.id,
        snapshotJson: snapshot,
        kind: 'capture',
        sequence: 1,
      },
    });

    await tx.trace.create({
      data: {
        gitSessionId: gitSession.id,
        stage: PIPELINE_STAGES.snapshotValidated,
        snapshotId: snapshotRecord.id,
        inputJson: { source: 'api' },
        outputJson: { snapshotId: snapshotRecord.id, version: snapshot.version },
        durationMs: Date.now() - pipelineStart,
        success: true,
      },
    });

    await persistLegacyAnalysisInTx(tx, {
      gitSessionId: gitSession.id,
      snapshotId: snapshotRecord.id,
      snapshot,
      signals,
      plan,
      pipelineStart,
    });

    await persistCanonicalInTx(tx, {
      organizationId: org.id,
      repositoryId: repository.id,
      snapshot,
      snapshotId: snapshotRecord.id,
      gitSessionId: gitSession.id,
      userId: params.userId,
      signals,
      plan,
      incomplete,
    });

    await tx.gitSession.update({
      where: { id: gitSession.id },
      data: { status: 'ready' },
    });

    return {
      sessionId: gitSession.id,
      incidentType: signals.state,
      summary: plan.summary,
      risk: plan.risk,
    };
  });
}

/**
 * Test hook: run dual-write ingest but force failure after legacy writes.
 * Used to prove rollback leaves neither side committed.
 */
export async function ingestSnapshotDualWriteWithFailureHook(params: {
  rawSnapshot: unknown;
  userId: string;
  failAfterLegacy: boolean;
}): Promise<IngestResult> {
  const pipelineStart = Date.now();
  const snapshot = parseSnapshot(params.rawSnapshot);
  const { signals, plan } = analyzeSnapshot(snapshot);
  const incomplete = plan.incomplete;

  return prisma.$transaction(async (tx) => {
    const org = await ensurePersonalOrganizationInTx(tx, params.userId);
    const repository = await upsertRepositoryInTx(tx, org.id, snapshot);

    const gitSession = await tx.gitSession.create({
      data: {
        title: generateTitle(snapshot),
        os: snapshot.platform,
        repoRootHash: repoRootHash(snapshot.repoRoot),
        userId: params.userId,
        status: 'analyzing',
      },
    });

    const snapshotRecord = await tx.snapshot.create({
      data: {
        gitSessionId: gitSession.id,
        snapshotJson: snapshot,
        kind: 'capture',
        sequence: 1,
      },
    });

    await persistLegacyAnalysisInTx(tx, {
      gitSessionId: gitSession.id,
      snapshotId: snapshotRecord.id,
      snapshot,
      signals,
      plan,
      pipelineStart,
    });

    if (params.failAfterLegacy) {
      throw new Error('forced dual-write failure after legacy write');
    }

    await persistCanonicalInTx(tx, {
      organizationId: org.id,
      repositoryId: repository.id,
      snapshot,
      snapshotId: snapshotRecord.id,
      gitSessionId: gitSession.id,
      userId: params.userId,
      signals,
      plan,
      incomplete,
    });

    await tx.gitSession.update({
      where: { id: gitSession.id },
      data: { status: 'ready' },
    });

    return {
      sessionId: gitSession.id,
      incidentType: signals.state,
      summary: plan.summary,
      risk: plan.risk,
    };
  });
}
