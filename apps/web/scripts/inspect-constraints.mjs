/**
 * Inspect PostgreSQL constraints for Phase 4B validation report.
 * Usage: DATABASE_URL=... node scripts/inspect-constraints.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const partialIndexes = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN ('Membership_one_owner_per_org', 'RecoveryPlanRecord_one_current_per_incident')
    ORDER BY indexname
  `;

  const compositeFks = await prisma.$queryRaw`
    SELECT
      c.conname AS name,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'f'
      AND c.conname IN (
        'Incident_repositoryId_organizationId_fkey',
        'IdempotencyRecord_incidentId_organizationId_fkey',
        'RecoveryPlanRecord_incidentId_organizationId_fkey',
        'VerificationRun_incidentId_organizationId_fkey',
        'VerificationRun_recoveryPlanRecordId_incidentId_fkey'
      )
    ORDER BY c.conname
  `;

  const onDelete = await prisma.$queryRaw`
    SELECT
      c.conname AS name,
      CASE c.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END AS on_delete,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.contype = 'f'
      AND (
        c.conname LIKE 'Snapshot_%'
        OR c.conname LIKE 'GitSession_%'
        OR c.conname LIKE 'Analysis_%'
        OR c.conname LIKE 'Trace_%'
        OR c.conname LIKE 'Incident_%'
        OR c.conname LIKE 'AuditEvent_%'
      )
    ORDER BY c.conname
  `;

  const uniques = await prisma.$queryRaw`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'Organization_personalOwnerUserId_key',
        'Repository_organizationId_fingerprint_key',
        'Incident_legacyGitSessionId_key',
        'Incident_id_organizationId_key'
      )
    ORDER BY indexname
  `;

  console.log(JSON.stringify({ partialIndexes, compositeFks, onDelete, uniques }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
