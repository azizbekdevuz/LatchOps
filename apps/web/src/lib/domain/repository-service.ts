import type { SnapshotV1 } from '@latchops/schema';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { computeFingerprint, type FingerprintResult } from './fingerprint';
import { assertOrgWritable } from './organization-service';

export async function upsertRepositoryInTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  snapshot: SnapshotV1,
  fp: FingerprintResult = computeFingerprint(snapshot),
) {
  return tx.repository.upsert({
    where: {
      organizationId_fingerprint: {
        organizationId,
        fingerprint: fp.fingerprint,
      },
    },
    create: {
      organizationId,
      fingerprint: fp.fingerprint,
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
      missingRemote: fp.missingRemote,
      platform: snapshot.platform,
    },
    update: {
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
      missingRemote: fp.missingRemote,
      platform: snapshot.platform,
      lastSeenAt: new Date(),
    },
  });
}

export async function upsertRepository(organizationId: string, snapshot: SnapshotV1) {
  await assertOrgWritable(organizationId);
  const fp = computeFingerprint(snapshot);
  return prisma.repository.upsert({
    where: {
      organizationId_fingerprint: {
        organizationId,
        fingerprint: fp.fingerprint,
      },
    },
    create: {
      organizationId,
      fingerprint: fp.fingerprint,
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
      missingRemote: fp.missingRemote,
      platform: snapshot.platform,
    },
    update: {
      displayName: fp.displayName,
      primaryRemote: fp.primaryRemote,
      rootCommitOid: fp.rootCommitOid,
      missingRemote: fp.missingRemote,
      platform: snapshot.platform,
      lastSeenAt: new Date(),
    },
  });
}

export async function listRepositories(organizationId: string) {
  const rows = await prisma.repository.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    include: { _count: { select: { incidents: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    fingerprint: r.fingerprint,
    displayName: r.displayName,
    primaryRemote: r.primaryRemote,
    missingRemote: r.missingRemote,
    lastSeenAt: r.lastSeenAt,
    incidentCount: r._count.incidents,
  }));
}

export async function touchLastSeen(organizationId: string, repositoryId: string) {
  return prisma.repository.updateMany({
    where: { id: repositoryId, organizationId },
    data: { lastSeenAt: new Date() },
  });
}
