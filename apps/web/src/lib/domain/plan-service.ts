import type { Prisma } from '@prisma/client';
import {
  RecoveryPlanV1Schema,
  RepoSignalsV1Schema,
  type RecoveryPlanV1,
  type RepoSignalsV1,
} from '@latchops/schema';
import prisma from '../prisma';
import { DomainError } from './errors';
import { recordAuthoritative } from './audit-service';
import { assertOrgWritable } from './organization-service';

export async function getCurrentPlan(organizationId: string, incidentId: string): Promise<RecoveryPlanV1> {
  const plan = await prisma.recoveryPlanRecord.findFirst({
    where: { incidentId, organizationId, isCurrent: true },
    orderBy: { version: 'desc' },
  });
  if (!plan) throw new DomainError('PLAN_NOT_FOUND', 'No current recovery plan', 404);
  return RecoveryPlanV1Schema.parse(plan.planJson);
}

export async function persistPlan(params: {
  organizationId: string;
  incidentId: string;
  sourceSnapshotId: string;
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
  incomplete?: boolean;
}) {
  const snapshot = await prisma.snapshot.findFirst({
    where: {
      id: params.sourceSnapshotId,
      OR: [{ incidentId: params.incidentId }, { incidentId: null }],
    },
  });
  if (!snapshot) throw new DomainError('SNAPSHOT_NOT_FOUND', 'Source snapshot not found', 404);
  if (snapshot.incidentId && snapshot.incidentId !== params.incidentId) {
    throw new DomainError('SNAPSHOT_INCIDENT_MISMATCH', 'Snapshot belongs to a different incident', 409);
  }

  const latest = await prisma.recoveryPlanRecord.findFirst({
    where: { incidentId: params.incidentId, organizationId: params.organizationId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  return prisma.$transaction(async (tx) => {
    await tx.recoveryPlanRecord.updateMany({
      where: { incidentId: params.incidentId, organizationId: params.organizationId, isCurrent: true },
      data: { isCurrent: false },
    });

    const record = await tx.recoveryPlanRecord.create({
      data: {
        incidentId: params.incidentId,
        organizationId: params.organizationId,
        sourceSnapshotId: params.sourceSnapshotId,
        version,
        isCurrent: true,
        signalsJson: RepoSignalsV1Schema.parse(params.signals) as Prisma.InputJsonValue,
        planJson: RecoveryPlanV1Schema.parse(params.plan) as Prisma.InputJsonValue,
        incidentType: params.signals.state,
        summary: params.plan.summary,
        risk: params.plan.risk,
        engineVersion: params.plan.engineVersion,
        incomplete: params.incomplete ?? false,
      },
    });

    return record;
  });
}

export async function regeneratePlan(organizationId: string, incidentId: string, actorUserId: string) {
  await assertOrgWritable(organizationId);
  const incident = await prisma.incident.findFirst({ where: { id: incidentId, organizationId } });
  if (!incident) throw new DomainError('INCIDENT_NOT_FOUND', 'Incident not found', 404);

  const current = await prisma.recoveryPlanRecord.findFirst({
    where: { incidentId, organizationId, isCurrent: true },
    include: { sourceSnapshot: true },
  });
  if (!current?.sourceSnapshot) throw new DomainError('PLAN_NOT_FOUND', 'No current plan to regenerate from', 404);

  const { analyzeSnapshot, parseSnapshot } = await import('../recovery/core');
  const snapshotJson = parseSnapshot(current.sourceSnapshot.snapshotJson);
  const { signals, plan } = analyzeSnapshot(snapshotJson);

  return prisma.$transaction(async (tx) => {
    await tx.recoveryPlanRecord.updateMany({
      where: { incidentId, organizationId, isCurrent: true },
      data: { isCurrent: false },
    });
    const version = current.version + 1;
    const record = await tx.recoveryPlanRecord.create({
      data: {
        incidentId,
        organizationId,
        sourceSnapshotId: current.sourceSnapshotId,
        version,
        isCurrent: true,
        signalsJson: signals as Prisma.InputJsonValue,
        planJson: plan as Prisma.InputJsonValue,
        incidentType: signals.state,
        summary: plan.summary,
        risk: plan.risk,
        engineVersion: plan.engineVersion,
      },
    });
    await recordAuthoritative(tx, {
      organizationId,
      incidentId,
      actorUserId,
      actorType: 'user',
      action: 'recovery_plan.regenerated',
      payload: { version },
    });
    return record;
  });
}
