import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ingestIncident } from '../domain/incident-service';
import { ensurePersonalOrganization } from '../domain/organization-service';
import { getCurrentPlan, persistPlan, regeneratePlan } from '../domain/plan-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('plan persistence integration', () => {
  let orgId: string;
  let userId: string;

  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const user = await createTestUser('plan@test.local');
    userId = user.id;
    orgId = (await ensurePersonalOrganization(userId)).id;
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('first plan is current version 1', async () => {
    const { incident } = await ingestIncident({
      organizationId: orgId,
      snapshot: sampleSnapshot(),
      userId,
    });
    const prisma = getTestPrisma();
    const plans = await prisma.recoveryPlanRecord.findMany({ where: { incidentId: incident.id } });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.version).toBe(1);
    expect(plans[0]!.isCurrent).toBe(true);
    await getCurrentPlan(orgId, incident.id);
  });

  it('regeneration atomically supersedes previous plan; exactly one current remains', async () => {
    const { incident } = await ingestIncident({
      organizationId: orgId,
      snapshot: sampleSnapshot(),
      userId,
    });
    const before = await getCurrentPlan(orgId, incident.id);
    await regeneratePlan(orgId, incident.id, userId);
    const after = await getCurrentPlan(orgId, incident.id);

    const prisma = getTestPrisma();
    const plans = await prisma.recoveryPlanRecord.findMany({
      where: { incidentId: incident.id },
      orderBy: { version: 'asc' },
    });
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.isCurrent)).toHaveLength(1);
    expect(plans[1]!.version).toBe(2);
    expect(plans[0]!.isCurrent).toBe(false);
    const stripStamp = (p: typeof before) => ({ ...p, generatedAt: '<stamp>' });
    expect(JSON.stringify(stripStamp(after))).toBe(JSON.stringify(stripStamp(before)));
  });

  it('immutable historical payload is not overwritten', async () => {
    const { incident, snapshot } = await ingestIncident({
      organizationId: orgId,
      snapshot: sampleSnapshot(),
      userId,
    });
    const prisma = getTestPrisma();
    const v1 = await prisma.recoveryPlanRecord.findFirstOrThrow({
      where: { incidentId: incident.id, version: 1 },
    });
    const originalJson = JSON.stringify(v1.planJson);

    await regeneratePlan(orgId, incident.id, userId);
    const v1After = await prisma.recoveryPlanRecord.findFirstOrThrow({
      where: { id: v1.id },
    });
    expect(JSON.stringify(v1After.planJson)).toBe(originalJson);

    await persistPlan({
      organizationId: orgId,
      incidentId: incident.id,
      sourceSnapshotId: (await getTestPrisma().snapshot.findFirstOrThrow({ where: { incidentId: incident.id } })).id,
      signals: v1.signalsJson as never,
      plan: v1.planJson as never,
    });
    const v1Final = await prisma.recoveryPlanRecord.findFirstOrThrow({ where: { id: v1.id } });
    expect(JSON.stringify(v1Final.planJson)).toBe(originalJson);
  });

  it('corrupted stored JSON is rejected safely', async () => {
    const { incident } = await ingestIncident({
      organizationId: orgId,
      snapshot: sampleSnapshot(),
      userId,
    });
    const prisma = getTestPrisma();
    await prisma.recoveryPlanRecord.updateMany({
      where: { incidentId: incident.id, isCurrent: true },
      data: { planJson: { not: 'a valid plan' } },
    });

    await expect(getCurrentPlan(orgId, incident.id)).rejects.toThrow();
    await expect(
      persistPlan({
        organizationId: orgId,
        incidentId: incident.id,
        sourceSnapshotId: (await getTestPrisma().snapshot.findFirstOrThrow({ where: { incidentId: incident.id } })).id,
        signals: { not: 'valid' } as never,
        plan: { not: 'valid' } as never,
      }),
    ).rejects.toThrow();
  });
});
