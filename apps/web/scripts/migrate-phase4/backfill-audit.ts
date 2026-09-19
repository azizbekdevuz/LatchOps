import type { Prisma } from '@prisma/client';
import { VerificationResultV1Schema } from '@latchops/schema';
import { logBackfillError } from './checkpoint.js';
import type { BackfillStats, DbClient } from './types.js';

export async function backfillAuditForSession(
  tx: DbClient,
  params: {
    gitSessionId: string;
    incidentId: string;
    organizationId: string;
    persistErrors: boolean;
    stats: BackfillStats;
  },
): Promise<{ verificationSucceeded: boolean }> {
  const traces = await tx.trace.findMany({
    where: { gitSessionId: params.gitSessionId },
    orderBy: { createdAt: 'asc' },
  });

  let verificationSucceeded = false;
  const currentPlan = await tx.recoveryPlanRecord.findFirst({
    where: { incidentId: params.incidentId, isCurrent: true },
  });

  for (const trace of traces) {
    await tx.trace.update({
      where: { id: trace.id },
      data: { incidentId: params.incidentId },
    });

    const existing = await tx.auditEvent.findUnique({ where: { legacyTraceId: trace.id } });
    if (existing) {
      await tx.trace.update({
        where: { id: trace.id },
        data: { auditEventId: existing.id, incidentId: params.incidentId },
      });
    } else {
      const event = await tx.auditEvent.create({
        data: {
          organizationId: params.organizationId,
          incidentId: params.incidentId,
          actorType: 'system',
          action: `legacy.trace.${trace.stage}`,
          tier: 'telemetry',
          payload: {
            stage: trace.stage,
            success: trace.success,
            durationMs: trace.durationMs ?? null,
            traceId: trace.id,
          } as Prisma.InputJsonValue,
          legacyTraceId: trace.id,
        },
      });
      await tx.trace.update({
        where: { id: trace.id },
        data: { auditEventId: event.id, incidentId: params.incidentId },
      });
      params.stats.auditEventsCreated += 1;
    }

    if (trace.stage !== 'verification_completed') continue;

    const parsed = VerificationResultV1Schema.safeParse(trace.outputJson);
    if (!parsed.success) {
      if (params.persistErrors) {
        await logBackfillError(tx, {
          sourceTable: 'Trace',
          sourceId: trace.id,
          errorCode: 'TRACE_INVALID',
          errorDetail: 'verification_completed output failed Zod validation',
        });
      }
      params.stats.errors += 1;
      continue;
    }

    if (parsed.data.status === 'succeeded') verificationSucceeded = true;

    if (!currentPlan) continue;
    const afterSnapshotId = trace.snapshotId;
    if (!afterSnapshotId) continue;

    const already = await tx.verificationRun.findFirst({
      where: { incidentId: params.incidentId, afterSnapshotId },
    });
    if (already) continue;

    await tx.verificationRun.create({
      data: {
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        recoveryPlanRecordId: currentPlan.id,
        afterSnapshotId,
        selectedAlternativeId: parsed.data.selectedAlternativeId,
        status: parsed.data.status,
        resultJson: parsed.data as Prisma.InputJsonValue,
        durationMs: trace.durationMs,
      },
    });
    params.stats.verificationRunsCreated += 1;
  }

  return { verificationSucceeded };
}
