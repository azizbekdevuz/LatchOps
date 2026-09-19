import type { AuditActorType, Prisma } from '@prisma/client';
import prisma from '../prisma';

export interface AuditEventInput {
  organizationId?: string | null;
  incidentId?: string | null;
  actorUserId?: string | null;
  actorType?: AuditActorType;
  action: string;
  tier?: 'authoritative' | 'telemetry';
  payload?: Prisma.InputJsonValue;
  userAgent?: string | null;
}

export async function recordAuthoritative(
  tx: Prisma.TransactionClient,
  event: AuditEventInput,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: event.organizationId ?? null,
      incidentId: event.incidentId ?? null,
      actorUserId: event.actorUserId ?? null,
      actorType: event.actorType ?? 'system',
      action: event.action,
      tier: event.tier ?? 'authoritative',
      payload: event.payload,
      userAgent: event.userAgent ?? null,
    },
  });
}

export async function recordTelemetry(event: AuditEventInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: event.organizationId ?? null,
        incidentId: event.incidentId ?? null,
        actorUserId: event.actorUserId ?? null,
        actorType: event.actorType ?? 'system',
        action: event.action,
        tier: 'telemetry',
        payload: event.payload,
        userAgent: event.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error('audit telemetry write failed', error);
  }
}

export async function listAuditForIncident(organizationId: string, incidentId: string) {
  return prisma.auditEvent.findMany({
    where: { organizationId, incidentId },
    orderBy: { createdAt: 'desc' },
  });
}
