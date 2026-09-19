import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { DomainError } from './errors';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export async function findIdempotencyRecord(organizationId: string, key: string) {
  return prisma.idempotencyRecord.findUnique({
    where: { organizationId_key: { organizationId, key } },
    include: { incident: true },
  });
}

export async function assertIdempotencyOrThrow(params: {
  organizationId: string;
  key: string;
  requestHash: string;
}): Promise<{ replay: true; incidentId: string } | { replay: false }> {
  const existing = await findIdempotencyRecord(params.organizationId, params.key);
  if (!existing) return { replay: false };
  if (existing.requestHash !== params.requestHash) {
    throw new DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different body', 409);
  }
  if (existing.expiresAt < new Date()) {
    throw new DomainError('IDEMPOTENCY_EXPIRED', 'Idempotency record expired', 409);
  }
  return { replay: true, incidentId: existing.incidentId };
}

export async function createIdempotencyRecordInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    key: string;
    requestHash: string;
    incidentId: string;
    ttlMs?: number;
  },
) {
  const expiresAt = new Date(Date.now() + (params.ttlMs ?? DEFAULT_TTL_MS));
  return tx.idempotencyRecord.create({
    data: {
      organizationId: params.organizationId,
      key: params.key,
      requestHash: params.requestHash,
      incidentId: params.incidentId,
      expiresAt,
    },
  });
}
