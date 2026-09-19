import type { Prisma } from '@prisma/client';
import { verifyRecovery } from '@latchops/recovery-engine';
import { computeRepoSignals } from '@latchops/state-engine';
import prisma from '../prisma';
import { DomainError } from './errors';
import { recordAuthoritative } from './audit-service';
import { assertOrgWritable } from './organization-service';
import { phase4LegacyWritesEnabled } from './phase4-flags';
import { getCurrentPlan } from './plan-service';
import { parseSignals, parseSnapshot, PIPELINE_STAGES } from '../recovery/core';

export async function verifyIncident(params: {
  organizationId: string;
  incidentId: string;
  rawSnapshot: unknown;
  selectedAlternativeId?: string | null;
  actorUserId: string;
}) {
  await assertOrgWritable(params.organizationId);
  const incident = await prisma.incident.findFirst({
    where: { id: params.incidentId, organizationId: params.organizationId },
  });
  if (!incident) throw new DomainError('INCIDENT_NOT_FOUND', 'Incident not found', 404);

  const current = await prisma.recoveryPlanRecord.findFirst({
    where: { incidentId: params.incidentId, organizationId: params.organizationId, isCurrent: true },
  });
  if (!current) throw new DomainError('PLAN_NOT_FOUND', 'No canonical plan/signals to verify against; generate a plan first.', 409);

  let before;
  let plan;
  try {
    before = parseSignals(current.signalsJson);
    plan = await getCurrentPlan(params.organizationId, params.incidentId);
  } catch {
    throw new DomainError('PLAN_INVALID', 'Stored analysis is invalid; regenerate the plan before verifying.', 409);
  }

  const afterSnapshot = parseSnapshot(params.rawSnapshot);
  const after = computeRepoSignals(afterSnapshot);
  const result = verifyRecovery({
    incidentType: plan.incidentType,
    before,
    after,
    plan,
    selectedAlternativeId: params.selectedAlternativeId ?? null,
  });

  const latest = await prisma.snapshot.findFirst({
    where: { incidentId: params.incidentId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  });

  return prisma.$transaction(async (tx) => {
    const snapshotRecord = await tx.snapshot.create({
      data: {
        incidentId: params.incidentId,
        gitSessionId: phase4LegacyWritesEnabled() ? incident.legacyGitSessionId : null,
        snapshotJson: afterSnapshot as Prisma.InputJsonValue,
        kind: 'verification',
        sequence: (latest?.sequence ?? 1) + 1,
      },
    });

    const run = await tx.verificationRun.create({
      data: {
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        recoveryPlanRecordId: current.id,
        afterSnapshotId: snapshotRecord.id,
        selectedAlternativeId: params.selectedAlternativeId ?? null,
        status: result.status,
        resultJson: result as Prisma.InputJsonValue,
      },
    });

    if (phase4LegacyWritesEnabled() && incident.legacyGitSessionId) {
      await tx.trace.create({
        data: {
          gitSessionId: incident.legacyGitSessionId,
          incidentId: params.incidentId,
          stage: PIPELINE_STAGES.verificationCompleted,
          snapshotId: snapshotRecord.id,
          outputJson: result as Prisma.InputJsonValue,
          success: result.status !== 'failed',
        },
      });
    }

    await recordAuthoritative(tx, {
      organizationId: params.organizationId,
      incidentId: params.incidentId,
      actorUserId: params.actorUserId,
      actorType: 'user',
      action: 'incident.verified',
      payload: { status: result.status, verificationRunId: run.id },
    });

    return { verification: result, snapshotId: snapshotRecord.id, verificationRunId: run.id };
  });
}
