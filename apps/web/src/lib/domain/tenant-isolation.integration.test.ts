import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../domain/errors';
import { getIncident, ingestIncident, listIncidents } from '../domain/incident-service';
import { archiveOrganization, ensurePersonalOrganization } from '../domain/organization-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { addMember, createTeamOrg, createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('tenant isolation integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  async function seedTenantPair() {
    const userA = await createTestUser('a-tenant@test.local');
    const userB = await createTestUser('b-tenant@test.local');
    const orgA = await ensurePersonalOrganization(userA.id);
    const orgB = await ensurePersonalOrganization(userB.id);
    const incidentA = await ingestIncident({
      organizationId: orgA.id,
      snapshot: sampleSnapshot({ repoRoot: '/tmp/tenant-a' }),
      userId: userA.id,
    });
    const incidentB = await ingestIncident({
      organizationId: orgB.id,
      snapshot: sampleSnapshot({ repoRoot: '/tmp/tenant-b' }),
      userId: userB.id,
    });
    return { userA, userB, orgA, orgB, incidentA, incidentB };
  }

  it('cross-tenant incident access returns safe not-found', async () => {
    const { orgA, orgB, incidentA } = await seedTenantPair();
    expect(await getIncident(orgA.id, incidentA.incident.id)).not.toBeNull();
    expect(await getIncident(orgB.id, incidentA.incident.id)).toBeNull();
  });

  it('list operations return only tenant-owned rows', async () => {
    const { orgA, orgB } = await seedTenantPair();
    const listA = await listIncidents(orgA.id);
    const listB = await listIncidents(orgB.id);
    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0]!.organizationId).toBe(orgA.id);
    expect(listB[0]!.organizationId).toBe(orgB.id);
  });

  it('viewer write denied for incident transition', async () => {
    const owner = await createTestUser('viewer-owner@test.local');
    const viewer = await createTestUser('viewer@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await addMember(org.id, viewer.id, 'viewer');
    const { incident } = await ingestIncident({
      organizationId: org.id,
      snapshot: sampleSnapshot(),
      userId: owner.id,
    });

    const { transitionIncident } = await import('../domain/incident-service');
    await expect(
      transitionIncident({
        organizationId: org.id,
        incidentId: incident.id,
        action: 'acknowledge',
        actorUserId: viewer.id,
        role: 'viewer',
        expectedVersion: incident.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('member incident operation allowed', async () => {
    const owner = await createTestUser('member-owner@test.local');
    const member = await createTestUser('member@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await addMember(org.id, member.id, 'member');
    const { incident } = await ingestIncident({
      organizationId: org.id,
      snapshot: sampleSnapshot(),
      userId: owner.id,
    });

    const { transitionIncident } = await import('../domain/incident-service');
    const updated = await transitionIncident({
      organizationId: org.id,
      incidentId: incident.id,
      action: 'start_recovery',
      actorUserId: member.id,
      role: 'member',
      expectedVersion: incident.version,
    });
    expect(updated.status).toBe('recovery_in_progress');
  });

  it('archived organization writes denied', async () => {
    const owner = await createTestUser('archived@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await archiveOrganization(org.id, owner.id);

    await expect(
      ingestIncident({
        organizationId: org.id,
        snapshot: sampleSnapshot(),
        userId: owner.id,
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describeDb('cross-tenant repository isolation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('cross-tenant repository access returns safe not-found', async () => {
    const userA = await createTestUser('repo-a@test.local');
    const userB = await createTestUser('repo-b@test.local');
    const orgA = await createTeamOrg(userA.id, 'team-a');
    const orgB = await createTeamOrg(userB.id, 'team-b');

    const { ingestIncident } = await import('../domain/incident-service');
    const ingested = await ingestIncident({
      organizationId: orgA.id,
      snapshot: sampleSnapshot({ repoRoot: '/tmp/repo-a' }),
      userId: userA.id,
    });

    const prisma = getTestPrisma();
    const repo = await prisma.repository.findFirst({ where: { organizationId: orgA.id } });
    expect(repo).not.toBeNull();

    const cross = await prisma.repository.findFirst({
      where: { id: repo!.id, organizationId: orgB.id },
    });
    expect(cross).toBeNull();
    expect(ingested.repository.organizationId).toBe(orgA.id);
  });
});
