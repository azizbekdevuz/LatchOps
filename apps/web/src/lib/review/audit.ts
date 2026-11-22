import type { PrismaClient } from '@prisma/review-client';
import { canonicalJson, sha256 } from './canonical';

export const GENESIS_HASH = '0'.repeat(64);

type Tx = Pick<PrismaClient, 'reviewAuditEvent'>;

function chainHash(prevHash: string, incidentId: string, actorId: string, action: string, payload: string): string {
  return sha256(`${prevHash}|${incidentId}|${actorId}|${action}|${payload}`);
}

export async function appendAudit(
  db: Tx,
  entry: { incidentId: string; actorId: string; action: string; payload: unknown },
): Promise<void> {
  const last = await db.reviewAuditEvent.findFirst({
    where: { incidentId: entry.incidentId },
    orderBy: { seq: 'desc' },
  });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const payload = canonicalJson(entry.payload ?? {});
  await db.reviewAuditEvent.create({
    data: {
      incidentId: entry.incidentId,
      actorId: entry.actorId,
      action: entry.action,
      payload,
      prevHash,
      hash: chainHash(prevHash, entry.incidentId, entry.actorId, entry.action, payload),
    },
  });
}

export interface ChainCheck {
  valid: boolean;
  events: number;
  brokenAtSeq: number | null;
}

/** Recompute every link; any edited, reordered or deleted row breaks the chain. */
export async function verifyAuditChain(db: Tx, incidentId: string): Promise<ChainCheck> {
  const events = await db.reviewAuditEvent.findMany({ where: { incidentId }, orderBy: { seq: 'asc' } });
  let prev = GENESIS_HASH;
  for (const event of events) {
    const expected = chainHash(prev, event.incidentId, event.actorId, event.action, event.payload);
    if (event.prevHash !== prev || event.hash !== expected) {
      return { valid: false, events: events.length, brokenAtSeq: event.seq };
    }
    prev = event.hash;
  }
  return { valid: true, events: events.length, brokenAtSeq: null };
}
