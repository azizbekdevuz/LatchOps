import { computeFingerprint, SnapshotV1Schema } from '@latchops/schema';
import { ensurePersonalOrganizationInTx } from '../../src/lib/domain/organization-service';
import { generateTitle } from '../../src/lib/recovery/core';
import { backfillAuditForSession } from './backfill-audit.js';
import { backfillPlansForSession } from './backfill-plans.js';
import { linkSnapshotsToIncident } from './backfill-snapshots.js';
import { logBackfillError } from './checkpoint.js';
import { mapSessionStatus, type BackfillStats, type DbClient } from './types.js';

class FailFastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FailFastError';
  }
}

export { FailFastError };

export async function backfillOwnedSession(
  tx: DbClient,
  params: {
    gitSessionId: string;
    forceRepair: boolean;
    failFast: boolean;
    persistErrors: boolean;
    stats: BackfillStats;
  },
): Promise<void> {
  const session = await tx.gitSession.findUnique({ where: { id: params.gitSessionId } });
  if (!session) return;
  if (!session.userId) return;

  params.stats.ownedSessions += 1;
  const org = await ensurePersonalOrganizationInTx(tx, session.userId);

  const snapshots = await tx.snapshot.findMany({
    where: { gitSessionId: session.id },
    orderBy: { createdAt: 'asc' },
  });
  const primarySnapshot = snapshots[0];
  const snapshotParse = primarySnapshot ? SnapshotV1Schema.safeParse(primarySnapshot.snapshotJson) : null;
  const validSnapshot = snapshotParse?.success ? snapshotParse.data : null;

  const fp = validSnapshot
    ? computeFingerprint(validSnapshot)
    : {
        fingerprint: session.repoRootHash ? `legacy:${session.repoRootHash}` : `legacy-session:${session.id}`,
        displayName: session.title ?? 'migrated-repository',
        primaryRemote: null,
        rootCommitOid: null,
        missingRemote: true,
      };

  const repository = await tx.repository.upsert({
    where: {
      organizationId_fingerprint: { organizationId: org.id, fingerprint: fp.fingerprint },
    },
    create: {
      organizationId: org.id,
      fingerprint: fp.fingerprint,
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
      missingRemote: fp.missingRemote,
      platform: validSnapshot?.platform ?? session.os,
    },
    update: {
      lastSeenAt: new Date(),
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
    },
  });

  let incident = await tx.incident.findUnique({ where: { legacyGitSessionId: session.id } });
  if (!incident) {
    incident = await tx.incident.create({
      data: {
        organizationId: org.id,
        repositoryId: repository.id,
        createdById: session.userId,
        title: validSnapshot ? generateTitle(validSnapshot) : session.title,
        status: mapSessionStatus(session.status),
        source: 'legacy_migration',
        incidentType: 'unknown',
        risk: null,
        summary: null,
        engineVersion: null,
        legacyGitSessionId: session.id,
        detectedAt: session.createdAt,
      },
    });
    params.stats.incidentsCreated += 1;
  } else {
    params.stats.incidentsReused += 1;
  }

  await tx.gitSession.update({
    where: { id: session.id },
    data: { incidentId: incident.id },
  });

  const linked = await linkSnapshotsToIncident(tx, session.id, incident.id);
  void linked;
  params.stats.snapshotsLinked += await tx.snapshot.count({
    where: { gitSessionId: session.id, incidentId: incident.id },
  });

  if (primarySnapshot && !validSnapshot && params.persistErrors) {
    await logBackfillError(tx, {
      sourceTable: 'Snapshot',
      sourceId: primarySnapshot.id,
      errorCode: 'SNAPSHOT_INVALID',
      errorDetail: 'snapshotJson failed SnapshotV1 validation',
    });
    params.stats.errors += 1;
    params.stats.unrecoverable += 1;
    if (params.failFast) throw new FailFastError(`SNAPSHOT_INVALID ${primarySnapshot.id}`);
  }

  const planResult = await backfillPlansForSession(tx, {
    gitSessionId: session.id,
    incidentId: incident.id,
    organizationId: org.id,
    forceRepair: params.forceRepair,
    persistErrors: params.persistErrors,
    stats: params.stats,
  });

  const auditResult = await backfillAuditForSession(tx, {
    gitSessionId: session.id,
    incidentId: incident.id,
    organizationId: org.id,
    persistErrors: params.persistErrors,
    stats: params.stats,
  });

  const currentPlan = await tx.recoveryPlanRecord.findFirst({
    where: { incidentId: incident.id, isCurrent: true },
  });

  let status = incident.status;
  if (auditResult.verificationSucceeded) status = 'resolved';
  else if (currentPlan && !currentPlan.incomplete) status = incident.status === 'detected' ? 'plan_ready' : incident.status;
  else if (planResult.incomplete) status = 'detected';

  await tx.incident.update({
    where: { id: incident.id },
    data: {
      status,
      incidentType: currentPlan?.incidentType ?? incident.incidentType,
      risk: currentPlan?.risk ?? incident.risk,
      summary: currentPlan?.summary ?? incident.summary,
      engineVersion: currentPlan?.engineVersion ?? incident.engineVersion,
      resolvedAt: status === 'resolved' ? new Date() : incident.resolvedAt,
    },
  });

  await tx.analysis.updateMany({
    where: { gitSessionId: session.id, incidentId: null },
    data: { incidentId: incident.id },
  });
  await tx.trace.updateMany({
    where: { gitSessionId: session.id, incidentId: null },
    data: { incidentId: incident.id },
  });
}
