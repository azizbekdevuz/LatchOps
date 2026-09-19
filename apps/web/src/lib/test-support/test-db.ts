import { PrismaClient } from '@prisma/client';

let testPrisma: PrismaClient | undefined;

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is required for database integration tests');
  }
  return url;
}

export function getTestPrisma(): PrismaClient {
  if (!testPrisma) {
    testPrisma = new PrismaClient({
      datasources: { db: { url: requireTestDatabaseUrl() } },
      log: ['error'],
    });
  }
  return testPrisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (testPrisma) {
    await testPrisma.$disconnect();
    testPrisma = undefined;
  }
}

export async function resetTestDatabase(): Promise<void> {
  const prisma = getTestPrisma();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

export async function tableCounts(): Promise<Record<string, number>> {
  const prisma = getTestPrisma();
  const tables = [
    'User',
    'GitSession',
    'Snapshot',
    'Analysis',
    'PlanStep',
    'ConflictFile',
    'ConflictHunk',
    'Trace',
    'Event',
    'Organization',
    'Membership',
    'Repository',
    'Incident',
    'RecoveryPlanRecord',
    'AuditEvent',
    'IdempotencyRecord',
    'VerificationRun',
    'MigrationBackfillError',
    'MigrationCheckpoint',
  ] as const;

  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*)::bigint AS count FROM "${table}"`,
    );
    counts[table] = Number(result[0]?.count ?? 0);
  }
  return counts;
}
