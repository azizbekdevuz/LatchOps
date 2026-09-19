import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RecoveryPlanV1Schema } from '@latchops/schema';
import { parseArgs, runPhase4Migration } from '../../../scripts/migrate-phase4/index';
import { seedLegacyPhase3Fixture } from '../../../scripts/migrate-phase4/fixtures/legacy-db-seed';
import { resolveIncidentRecord } from './incident-service';
import { loadIncidentPayload } from '../recovery/incident';
import {
  disconnectTestPrisma,
  getTestPrisma,
  requireTestDatabaseUrl,
  resetTestDatabase,
  tableCounts,
} from '../test-support/test-db';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('phase 4D backfill', () => {
  const prisma = () => getTestPrisma();

  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('dry run writes nothing', async () => {
    await seedLegacyPhase3Fixture(prisma());
    const before = await tableCounts();
    await runPhase4Migration(prisma(), parseArgs(['--dry-run']));
    const after = await tableCounts();
    expect(after.Incident).toBe(before.Incident);
    expect(after.Organization).toBe(before.Organization);
    expect(after.RecoveryPlanRecord).toBe(before.RecoveryPlanRecord);
    expect(after.GitSession).toBe(before.GitSession);
  });

  it('apply migrates owned sessions, skips anonymous, is idempotent', async () => {
    const seed = await seedLegacyPhase3Fixture(prisma());
    const first = await runPhase4Migration(prisma(), {
      ...parseArgs(['--apply']),
      dryRun: false,
      apply: true,
      reconcileOnly: false,
    });
    expect(first.stats.skippedAnonymous).toBe(1);
    expect(first.stats.ownedSessions).toBe(3);
    expect(first.exitCode).toBe(0);

    const incidents = await prisma().incident.findMany();
    expect(incidents).toHaveLength(3);

    const anonymous = await prisma().gitSession.findUnique({ where: { id: seed.anonymous.id } });
    expect(anonymous?.incidentId).toBeNull();
    expect(await prisma().incident.findFirst({ where: { legacyGitSessionId: seed.anonymous.id } })).toBeNull();

    const ready = await prisma().incident.findUniqueOrThrow({
      where: { legacyGitSessionId: seed.sessionReady.id },
    });
    expect(ready.organizationId).toBe(
      (await prisma().organization.findUniqueOrThrow({ where: { personalOwnerUserId: seed.owner.id } })).id,
    );
    expect(ready.status).toBe('resolved');

    const snapshots = await prisma().snapshot.findMany({ where: { gitSessionId: seed.sessionReady.id } });
    expect(snapshots.every((s) => s.incidentId === ready.id && s.gitSessionId === seed.sessionReady.id)).toBe(true);
    const snapshotCountAfter = await prisma().snapshot.count();

    const plan = await prisma().recoveryPlanRecord.findFirstOrThrow({ where: { incidentId: ready.id, isCurrent: true } });
    expect(RecoveryPlanV1Schema.parse(plan.planJson).version).toBe(1);

    const byLegacy = await resolveIncidentRecord(seed.sessionReady.id);
    expect(byLegacy?.id).toBe(ready.id);
    const byId = await resolveIncidentRecord(ready.id);
    expect(byId?.id).toBe(ready.id);

    const payload = await loadIncidentPayload(ready.id);
    expect(payload?.id).toBe(ready.id);
    expect(payload?.plan).toBeTruthy();
    expect(payload?.legacyGitSessionId).toBe(seed.sessionReady.id);

    const errors = await prisma().migrationBackfillError.findMany();
    const corruptSnap = await prisma().snapshot.findFirstOrThrow({
      where: { gitSessionId: seed.sessionCorrupt.id },
    });
    expect(errors.some((e) => e.errorCode === 'SNAPSHOT_INVALID' && e.sourceId === corruptSnap.id)).toBe(true);

    const second = await runPhase4Migration(prisma(), {
      ...parseArgs(['--apply']),
      dryRun: false,
      apply: true,
      reconcileOnly: false,
    });
    expect(await prisma().incident.count()).toBe(3);
    expect(await prisma().snapshot.count()).toBe(snapshotCountAfter);
    expect(second.stats.incidentsCreated).toBe(0);

    await prisma().gitSession.delete({ where: { id: seed.sessionPending.id } });
    const pendingIncident = await prisma().incident.findUnique({
      where: { legacyGitSessionId: seed.sessionPending.id },
    });
    expect(pendingIncident).toBeTruthy();
    const pendingSnap = await prisma().snapshot.findFirst({ where: { incidentId: pendingIncident!.id } });
    expect(pendingSnap?.gitSessionId).toBeNull();
    expect(pendingSnap?.incidentId).toBe(pendingIncident!.id);
  });

  it('resume continues after a limited apply', async () => {
    await seedLegacyPhase3Fixture(prisma());
    await runPhase4Migration(prisma(), {
      ...parseArgs(['--apply', '--limit', '1']),
      dryRun: false,
      apply: true,
      reconcileOnly: false,
      limit: 1,
    });
    expect(await prisma().incident.count()).toBe(1);

    await runPhase4Migration(prisma(), {
      ...parseArgs(['--apply', '--resume']),
      dryRun: false,
      apply: true,
      resume: true,
      reconcileOnly: false,
    });
    expect(await prisma().incident.count()).toBe(3);
  });

  it('CHECK constraint rejects orphan snapshots after switch', async () => {
    await seedLegacyPhase3Fixture(prisma());
    await runPhase4Migration(prisma(), {
      ...parseArgs(['--apply']),
      dryRun: false,
      apply: true,
      reconcileOnly: false,
    });

    await expect(
      prisma().snapshot.create({
        data: { snapshotJson: { broken: true } },
      }),
    ).rejects.toThrow();
  });
});
