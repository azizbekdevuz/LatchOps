import type { Prisma } from '@prisma/client';
import {
  RecoveryPlanV1Schema,
  RepoSignalsV1Schema,
  SnapshotV1Schema,
} from '@latchops/schema';
import { analyzeSnapshot } from '../../src/lib/recovery/core';
import { logBackfillError } from './checkpoint.js';
import type { BackfillStats, DbClient, JsonQuality } from './types.js';

export async function backfillPlansForSession(
  tx: DbClient,
  params: {
    gitSessionId: string;
    incidentId: string;
    organizationId: string;
    forceRepair: boolean;
    persistErrors: boolean;
    stats: BackfillStats;
  },
): Promise<{ quality: JsonQuality; incomplete: boolean }> {
  const analyses = await tx.analysis.findMany({
    where: { gitSessionId: params.gitSessionId },
    orderBy: { createdAt: 'asc' },
  });

  if (analyses.length === 0) {
    return { quality: 'unrecoverable', incomplete: true };
  }

  let latestQuality: JsonQuality = 'unrecoverable';
  let incomplete = true;
  let version = 0;
  const existingMax = await tx.recoveryPlanRecord.findFirst({
    where: { incidentId: params.incidentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  version = existingMax?.version ?? 0;

  for (const analysis of analyses) {
    if (!analysis.snapshotId) {
      if (params.persistErrors) {
        await logBackfillError(tx, {
          sourceTable: 'Analysis',
          sourceId: analysis.id,
          errorCode: 'ORPHAN_ANALYSIS',
          errorDetail: 'Analysis has no snapshotId',
        });
      }
      params.stats.errors += 1;
      continue;
    }

    const snapshot = await tx.snapshot.findUnique({ where: { id: analysis.snapshotId } });
    if (!snapshot) {
      if (params.persistErrors) {
        await logBackfillError(tx, {
          sourceTable: 'Analysis',
          sourceId: analysis.id,
          errorCode: 'MISSING_FK',
          errorDetail: `snapshot ${analysis.snapshotId} missing`,
        });
      }
      params.stats.errors += 1;
      continue;
    }

    const existing = await tx.recoveryPlanRecord.findUnique({
      where: { legacyAnalysisId: analysis.id },
    });
    if (existing) {
      await tx.analysis.update({
        where: { id: analysis.id },
        data: { incidentId: params.incidentId, recoveryPlanRecordId: existing.id },
      });
      latestQuality = 'canonical';
      incomplete = existing.incomplete;
      continue;
    }

    const resolved = resolvePlanJson(analysis.signalsJson, analysis.planJson, snapshot.snapshotJson);
    latestQuality = resolved.quality;
    incomplete = resolved.incomplete;

    if (resolved.quality === 'recomputed') params.stats.recomputedJson += 1;
    if (resolved.quality === 'unrecoverable') {
      params.stats.unrecoverable += 1;
      if (params.persistErrors) {
        await logBackfillError(tx, {
          sourceTable: 'Analysis',
          sourceId: analysis.id,
          errorCode: resolved.errorCode ?? 'PLAN_INVALID',
          errorDetail: resolved.errorDetail,
        });
      }
      params.stats.errors += 1;
      await tx.analysis.update({
        where: { id: analysis.id },
        data: { incidentId: params.incidentId },
      });
      continue;
    }

    if (!resolved.signals || !resolved.plan) {
      await tx.analysis.update({
        where: { id: analysis.id },
        data: { incidentId: params.incidentId },
      });
      continue;
    }

    version += 1;
    await tx.recoveryPlanRecord.updateMany({
      where: { incidentId: params.incidentId, isCurrent: true },
      data: { isCurrent: false },
    });

    const record = await tx.recoveryPlanRecord.create({
      data: {
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        sourceSnapshotId: snapshot.id,
        version,
        isCurrent: true,
        signalsJson: resolved.signals as Prisma.InputJsonValue,
        planJson: resolved.plan as Prisma.InputJsonValue,
        incidentType: resolved.signals.state,
        summary: resolved.plan.summary,
        risk: resolved.plan.risk,
        engineVersion: resolved.plan.engineVersion,
        incomplete: resolved.incomplete,
        legacyAnalysisId: analysis.id,
      },
    });

    await tx.analysis.update({
      where: { id: analysis.id },
      data: {
        incidentId: params.incidentId,
        recoveryPlanRecordId: record.id,
      },
    });
    params.stats.plansCreated += 1;
  }

  void params.forceRepair;
  return { quality: latestQuality, incomplete };
}

function resolvePlanJson(
  signalsJson: unknown,
  planJson: unknown,
  snapshotJson: unknown,
): {
  quality: JsonQuality;
  incomplete: boolean;
  signals?: ReturnType<typeof analyzeSnapshot>['signals'];
  plan?: ReturnType<typeof analyzeSnapshot>['plan'];
  errorCode?: 'SIGNALS_INVALID' | 'PLAN_INVALID' | 'SNAPSHOT_INVALID';
  errorDetail?: string;
} {
  const signalsOk = RepoSignalsV1Schema.safeParse(signalsJson);
  const planOk = RecoveryPlanV1Schema.safeParse(planJson);
  if (signalsOk.success && planOk.success) {
    return { quality: 'canonical', incomplete: planOk.data.incomplete, signals: signalsOk.data, plan: planOk.data };
  }

  const snapshotOk = SnapshotV1Schema.safeParse(snapshotJson);
  if (snapshotOk.success) {
    const computed = analyzeSnapshot(snapshotOk.data);
    return { quality: 'recomputed', incomplete: computed.plan.incomplete, signals: computed.signals, plan: computed.plan };
  }

  return {
    quality: 'unrecoverable',
    incomplete: true,
    errorCode: snapshotOk.success ? 'PLAN_INVALID' : 'SNAPSHOT_INVALID',
    errorDetail: 'signals/plan/snapshot JSON failed Zod validation',
  };
}
