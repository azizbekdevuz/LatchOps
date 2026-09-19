import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensurePersonalOrganization } from '../domain/organization-service';
import { ingestSnapshotDualWrite, ingestSnapshotDualWriteWithFailureHook } from '../recovery/dual-write-ingest';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('dual-write ingest integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('creates legacy and canonical records in one transaction with dual parent snapshot', async () => {
    const user = await createTestUser('dual@test.local');
    await ensurePersonalOrganization(user.id);

    const result = await ingestSnapshotDualWrite({
      rawSnapshot: sampleSnapshot(),
      userId: user.id,
    });

    const prisma = getTestPrisma();
    const session = await prisma.gitSession.findUniqueOrThrow({ where: { id: result.sessionId } });
    const incident = await prisma.incident.findFirstOrThrow({ where: { legacyGitSessionId: session.id } });
    const snapshot = await prisma.snapshot.findFirstOrThrow({ where: { gitSessionId: session.id } });

    expect(snapshot.gitSessionId).toBe(session.id);
    expect(snapshot.incidentId).toBe(incident.id);
    expect(session.incidentId).toBe(incident.id);

    const analysis = await prisma.analysis.findFirstOrThrow({ where: { snapshotId: snapshot.id } });
    expect(analysis.gitSessionId).toBe(session.id);
    expect(analysis.incidentId).toBe(incident.id);

    const plan = await prisma.recoveryPlanRecord.findFirstOrThrow({ where: { incidentId: incident.id } });
    expect(plan.isCurrent).toBe(true);

    const audit = await prisma.auditEvent.findFirst({
      where: { incidentId: incident.id, action: 'incident.ingested', tier: 'authoritative' },
    });
    expect(audit).not.toBeNull();
  });

  it('forced failure after legacy write leaves neither side committed', async () => {
    const user = await createTestUser('dual-fail@test.local');
    await ensurePersonalOrganization(user.id);

    await expect(
      ingestSnapshotDualWriteWithFailureHook({
        rawSnapshot: sampleSnapshot(),
        userId: user.id,
        failAfterLegacy: true,
      }),
    ).rejects.toThrow('forced dual-write failure');

    const prisma = getTestPrisma();
    expect(await prisma.gitSession.count()).toBe(0);
    expect(await prisma.snapshot.count()).toBe(0);
    expect(await prisma.analysis.count()).toBe(0);
    expect(await prisma.incident.count()).toBe(0);
    expect(await prisma.recoveryPlanRecord.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: 'incident.ingested' } })).toBe(0);
  });
});
