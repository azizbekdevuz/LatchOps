import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CHECKPOINT_ID, emptyStats, type BackfillStats, type DbClient } from './types.js';

export async function loadCheckpoint(db: DbClient) {
  return db.migrationCheckpoint.findUnique({ where: { id: CHECKPOINT_ID } });
}

export async function saveCheckpoint(
  db: DbClient,
  params: {
    lastProcessedGitSessionId?: string | null;
    mode: string;
    stats: BackfillStats;
  },
) {
  await db.migrationCheckpoint.upsert({
    where: { id: CHECKPOINT_ID },
    create: {
      id: CHECKPOINT_ID,
      lastProcessedGitSessionId: params.lastProcessedGitSessionId ?? null,
      lastProcessedAt: new Date(),
      mode: params.mode,
      statsJson: params.stats as unknown as Prisma.InputJsonValue,
    },
    update: {
      lastProcessedGitSessionId: params.lastProcessedGitSessionId ?? null,
      lastProcessedAt: new Date(),
      mode: params.mode,
      statsJson: params.stats as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function logBackfillError(
  db: DbClient,
  params: { sourceTable: string; sourceId: string; errorCode: string; errorDetail?: string },
) {
  await db.migrationBackfillError.create({
    data: {
      sourceTable: params.sourceTable,
      sourceId: params.sourceId,
      errorCode: params.errorCode,
      errorDetail: params.errorDetail ?? null,
    },
  });
}

export async function acquireBackfillLock(db: PrismaClient): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_lock(hashtext('latchops_phase4_backfill'))`;
}

export async function releaseBackfillLock(db: PrismaClient): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_unlock(hashtext('latchops_phase4_backfill'))`;
}

export async function applySwitchConstraints(db: PrismaClient): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sqlPath = join(here, '../../../prisma/manual-migrations/20260910_phase4d_switch.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  await db.$executeRawUnsafe(sql);
}

export { emptyStats };
