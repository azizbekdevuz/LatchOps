import type { IncidentSource, IncidentStatus } from '@prisma/client';
import type { SnapshotV1 } from '@latchops/schema';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { analyzeSnapshot, generateTitle, parseSnapshot } from '../recovery/core';
import { DomainError } from './errors';
import { recordAuthoritative } from './audit-service';
import { canTransition, nextStatus, type TransitionAction } from './lifecycle';
import { assertOrgWritable, getOrganizationsForUser } from './organization-service';
import { upsertRepository } from './repository-service';
import type { MembershipRole } from '@latchops/schema';

export async function getIncident(organizationId: string, incidentId: string) {
  return prisma.incident.findFirst({
    where: { id: incidentId, organizationId },
    include: {
      repository: true,
      recoveryPlans: { where: { isCurrent: true }, take: 1 },
      snapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export async function listIncidents(organizationId: string, limit = 50) {
  return prisma.incident.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { repository: true },
  });
}

export async function listIncidentsForUser(userId: string, limit = 50) {
  const memberships = await getOrganizationsForUser(userId);
  const organizationIds = memberships.map((m) => m.organizationId);
  if (organizationIds.length === 0) return [];
  return prisma.incident.findMany({
    where: { organizationId: { in: organizationIds } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      repository: true,
      traces: {
        orderBy: { createdAt: 'asc' },
        select: { stage: true, createdAt: true, success: true },
      },
    },
  });
}

/** Lookup order: Incident.id → Incident.legacyGitSessionId → GitSession.incidentId. */
export async function resolveIncidentRecord(ref: string) {
  const byId = await prisma.incident.findUnique({ where: { id: ref } });
  if (byId) return byId;

  const byLegacy = await prisma.incident.findUnique({ where: { legacyGitSessionId: ref } });
  if (byLegacy) return byLegacy;

  const session = await prisma.gitSession.findUnique({ where: { id: ref } });
  if (session?.incidentId) {
    return prisma.incident.findUnique({ where: { id: session.incidentId } });
  }
  return null;
}

export async function ingestIncident(params: {
  organizationId: string;
  snapshot: SnapshotV1;
  userId?: string | null;
  source?: IncidentSource;
  legacyGitSessionId?: string | null;
}) {
  await assertOrgWritable(params.organizationId);
  const repository = await upsertRepository(params.organizationId, params.snapshot);
  const { signals, plan } = analyzeSnapshot(params.snapshot);
  const incomplete = plan.incomplete;

  return prisma.$transaction(async (tx) => {
    let incident = await tx.incident.create({
      data: {
        organizationId: params.organizationId,
        repositoryId: repository.id,
        createdById: params.userId ?? null,
        title: generateTitle(params.snapshot),
        status: incomplete ? 'detected' : 'plan_ready',
        source: params.source ?? 'web_import',
        incidentType: signals.state,
        risk: plan.risk,
        summary: plan.summary,
        engineVersion: plan.engineVersion,
        legacyGitSessionId: params.legacyGitSessionId ?? null,
      },
    });

    const snapshotRecord = await tx.snapshot.create({
      data: {
        incidentId: incident.id,
        gitSessionId: params.legacyGitSessionId ?? null,
        snapshotJson: params.snapshot,
        kind: 'capture',
        sequence: 1,
      },
    });

    await persistPlanInTx(tx, {
      organizationId: params.organizationId,
      incidentId: incident.id,
      sourceSnapshotId: snapshotRecord.id,
      signals,
      plan,
      incomplete,
    });

    await recordAuthoritative(tx, {
      organizationId: params.organizationId,
      incidentId: incident.id,
      actorUserId: params.userId ?? null,
      actorType: params.userId ? 'user' : 'system',
      action: 'incident.ingested',
      payload: { source: params.source ?? 'web_import' },
    });

    if (params.legacyGitSessionId) {
      await tx.gitSession.update({
        where: { id: params.legacyGitSessionId },
        data: { incidentId: incident.id },
      });
      await tx.snapshot.updateMany({
        where: { gitSessionId: params.legacyGitSessionId, incidentId: null },
        data: { incidentId: incident.id },
      });
    }

    incident = await tx.incident.findUniqueOrThrow({ where: { id: incident.id } });
    return { incident, snapshot: snapshotRecord, repository };
  });
}

async function persistPlanInTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  params: {
    organizationId: string;
    incidentId: string;
    sourceSnapshotId: string;
    signals: ReturnType<typeof analyzeSnapshot>['signals'];
    plan: ReturnType<typeof analyzeSnapshot>['plan'];
    incomplete?: boolean;
  },
) {
  await tx.recoveryPlanRecord.updateMany({
    where: { incidentId: params.incidentId, organizationId: params.organizationId, isCurrent: true },
    data: { isCurrent: false },
  });
  await tx.recoveryPlanRecord.create({
    data: {
      incidentId: params.incidentId,
      organizationId: params.organizationId,
      sourceSnapshotId: params.sourceSnapshotId,
      version: 1,
      isCurrent: true,
      signalsJson: params.signals as Prisma.InputJsonValue,
      planJson: params.plan as Prisma.InputJsonValue,
      incidentType: params.signals.state,
      summary: params.plan.summary,
      risk: params.plan.risk,
      engineVersion: params.plan.engineVersion,
      incomplete: params.incomplete ?? false,
    },
  });
}

export async function transitionIncident(params: {
  organizationId: string;
  incidentId: string;
  action: TransitionAction;
  actorUserId: string;
  role: MembershipRole;
  reason?: string;
  expectedVersion: number;
}) {
  await assertOrgWritable(params.organizationId);
  const incident = await prisma.incident.findFirst({
    where: { id: params.incidentId, organizationId: params.organizationId },
  });
  if (!incident) throw new DomainError('INCIDENT_NOT_FOUND', 'Incident not found', 404);

  if (!canTransition(incident.status, params.action, params.role)) {
    throw new DomainError('INVALID_TRANSITION', `Cannot ${params.action} from ${incident.status}`, 409);
  }

  const next = nextStatus(incident.status, params.action);
  if (!next) throw new DomainError('INVALID_TRANSITION', 'Invalid lifecycle transition', 409);

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.incident.updateMany({
      where: {
        id: params.incidentId,
        organizationId: params.organizationId,
        version: params.expectedVersion,
        status: incident.status,
      },
      data: {
        status: next,
        version: { increment: 1 },
        triagedAt: next === 'triaged' ? new Date() : undefined,
        resolvedAt: next === 'resolved' ? new Date() : undefined,
        dismissedAt: next === 'dismissed' ? new Date() : undefined,
      },
    });
    if (updated.count !== 1) throw new DomainError('INVALID_TRANSITION', 'Concurrent lifecycle update', 409);

    await recordAuthoritative(tx, {
      organizationId: params.organizationId,
      incidentId: params.incidentId,
      actorUserId: params.actorUserId,
      actorType: 'user',
      action: 'incident.status_changed',
      payload: { from: incident.status, to: next, reason: params.reason ?? null },
    });

    return tx.incident.findUniqueOrThrow({ where: { id: params.incidentId } });
  });

  return result;
}

export async function ingestFromRawSnapshot(params: {
  organizationId: string;
  rawSnapshot: unknown;
  userId?: string | null;
  source?: IncidentSource;
}) {
  const snapshot = parseSnapshot(params.rawSnapshot);
  return ingestIncident({ ...params, snapshot });
}

export type { IncidentStatus };
