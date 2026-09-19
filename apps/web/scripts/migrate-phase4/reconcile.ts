import type { PrismaClient } from '@prisma/client';
import type { ReconcileCounts } from './types.js';

export async function reconcile(db: PrismaClient): Promise<ReconcileCounts> {
  const ownedSessionsWithoutIncident = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "GitSession" gs
     WHERE gs."userId" IS NOT NULL AND gs."incidentId" IS NULL`,
  );
  const snapshotsMissingIncidentId = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "Snapshot" s
     JOIN "GitSession" gs ON s."gitSessionId" = gs.id
     WHERE gs."incidentId" IS NOT NULL AND s."incidentId" IS NULL`,
  );
  const analysesMissingIncidentId = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "Analysis" a
     JOIN "GitSession" gs ON a."gitSessionId" = gs.id
     WHERE gs."incidentId" IS NOT NULL AND a."incidentId" IS NULL`,
  );
  const tracesMissingIncidentId = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "Trace" t
     JOIN "GitSession" gs ON t."gitSessionId" = gs.id
     WHERE gs."incidentId" IS NOT NULL AND t."incidentId" IS NULL`,
  );
  const orphanSnapshots = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "Snapshot"
     WHERE "gitSessionId" IS NULL AND "incidentId" IS NULL`,
  );
  const incidentRepoOrgMismatch = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "Incident" i
     JOIN "Repository" r ON i."repositoryId" = r.id
     WHERE i."organizationId" != r."organizationId"`,
  );
  const planSnapshotOrgMismatch = await count(
    db,
    `SELECT COUNT(*)::bigint AS count FROM "RecoveryPlanRecord" r
     JOIN "Snapshot" s ON r."sourceSnapshotId" = s.id
     WHERE s."incidentId" IS DISTINCT FROM r."incidentId"`,
  );

  return {
    ownedSessionsWithoutIncident,
    snapshotsMissingIncidentId,
    analysesMissingIncidentId,
    tracesMissingIncidentId,
    orphanSnapshots,
    planSnapshotOrgMismatch,
    incidentRepoOrgMismatch,
  };
}

export function ownedDeltasZero(counts: ReconcileCounts): boolean {
  return (
    counts.ownedSessionsWithoutIncident === 0 &&
    counts.snapshotsMissingIncidentId === 0 &&
    counts.analysesMissingIncidentId === 0 &&
    counts.tracesMissingIncidentId === 0 &&
    counts.orphanSnapshots === 0 &&
    counts.planSnapshotOrgMismatch === 0 &&
    counts.incidentRepoOrgMismatch === 0
  );
}

export function formatReconcileReport(params: {
  stats?: {
    ownedSessions: number;
    incidentsCreated: number;
    incidentsReused: number;
    snapshotsLinked: number;
    recomputedJson: number;
    unrecoverable: number;
    skippedAnonymous: number;
  };
  counts: ReconcileCounts;
}): string {
  const { stats, counts } = params;
  const lines: string[] = [];
  if (stats) {
    const incidentTotal = stats.incidentsCreated + stats.incidentsReused;
    lines.push(`GitSession (owned):     ${stats.ownedSessions}`);
    lines.push(
      `Incident created/reused: ${incidentTotal}  (delta ${counts.ownedSessionsWithoutIncident}) ${mark(counts.ownedSessionsWithoutIncident)}`,
    );
    lines.push(
      `Snapshot incidentId:    ${stats.snapshotsLinked}  (delta ${counts.snapshotsMissingIncidentId}) ${mark(counts.snapshotsMissingIncidentId)}`,
    );
    lines.push(`Recomputed JSON:             ${stats.recomputedJson}`);
    lines.push(`Unrecoverable:                ${stats.unrecoverable}${stats.unrecoverable ? '  ⚠' : ''}`);
    lines.push(`Skipped anonymous:           ${stats.skippedAnonymous}`);
  }
  lines.push(`Analysis incidentId delta: ${counts.analysesMissingIncidentId} ${mark(counts.analysesMissingIncidentId)}`);
  lines.push(`Trace incidentId delta:    ${counts.tracesMissingIncidentId} ${mark(counts.tracesMissingIncidentId)}`);
  lines.push(`Orphan snapshots:          ${counts.orphanSnapshots} ${mark(counts.orphanSnapshots)}`);
  lines.push(`Plan/snapshot mismatch:    ${counts.planSnapshotOrgMismatch} ${mark(counts.planSnapshotOrgMismatch)}`);
  lines.push(`Incident/repo org mismatch:${counts.incidentRepoOrgMismatch} ${mark(counts.incidentRepoOrgMismatch)}`);
  return lines.join('\n');
}

function mark(delta: number): string {
  return delta === 0 ? '✓' : '✗';
}

async function count(db: PrismaClient, sql: string): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ count: bigint }[]>(sql);
  return Number(rows[0]?.count ?? 0);
}
