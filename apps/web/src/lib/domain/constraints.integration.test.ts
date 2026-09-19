import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensurePersonalOrganization } from '../domain/organization-service';
import { ingestIncident } from '../domain/incident-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { addMember, createTeamOrg, createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function expectPgError(fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
    throw new Error('expected PostgreSQL error');
  } catch (error) {
    const e = error as { code?: string };
    if (e.code === 'expected PostgreSQL error') throw e;
    if (code) expect(e.code).toBe(code);
  }
}

describeDb('PostgreSQL constraint integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('rejects a second owner in one organization', async () => {
    const owner = await createTestUser('c-owner@test.local');
    const other = await createTestUser('c-other@test.local');
    const org = await ensurePersonalOrganization(owner.id);

    await expectPgError(() =>
      getTestPrisma().membership.create({
        data: { organizationId: org.id, userId: other.id, role: 'owner' },
      }),
      'P2002',
    );
  });

  it('rejects a second current plan for one incident', async () => {
    const user = await createTestUser('c-plan@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { incident } = await ingestIncident({
      organizationId: org.id,
      snapshot: sampleSnapshot(),
      userId: user.id,
    });
    const snapshotId = (
      await getTestPrisma().snapshot.findFirstOrThrow({ where: { incidentId: incident.id } })
    ).id;

    await expectPgError(() =>
      getTestPrisma().recoveryPlanRecord.create({
        data: {
          incidentId: incident.id,
          organizationId: org.id,
          sourceSnapshotId: snapshotId,
          version: 99,
          isCurrent: true,
          signalsJson: {},
          planJson: { incidentType: 'clean', summary: 'x', risk: 'low', steps: [], engineVersion: '1' },
          incidentType: 'clean',
          risk: 'low',
          engineVersion: '1',
        },
      }),
      'P2002',
    );
  });

  it('rejects an Incident using a Repository from another organization', async () => {
    const a = await createTestUser('c-a@test.local');
    const b = await createTestUser('c-b@test.local');
    const orgA = await createTeamOrg(a.id, 'org-a');
    const orgB = await createTeamOrg(b.id, 'org-b');
    const repoA = await ingestIncident({
      organizationId: orgA.id,
      snapshot: sampleSnapshot({ repoRoot: '/tmp/a' }),
      userId: a.id,
    });

    await expectPgError(() =>
      getTestPrisma().incident.create({
        data: {
          organizationId: orgB.id,
          repositoryId: repoA.repository.id,
          incidentType: 'clean',
          risk: 'low',
          summary: 'bad',
          engineVersion: '1',
        },
      }),
      'P2003',
    );
  });

  it('rejects IdempotencyRecord whose organization does not match its Incident', async () => {
    const a = await createTestUser('c-idem-a@test.local');
    const b = await createTestUser('c-idem-b@test.local');
    const orgA = await ensurePersonalOrganization(a.id);
    const orgB = await ensurePersonalOrganization(b.id);
    const { incident } = await ingestIncident({
      organizationId: orgA.id,
      snapshot: sampleSnapshot(),
      userId: a.id,
    });

    await expectPgError(() =>
      getTestPrisma().idempotencyRecord.create({
        data: {
          organizationId: orgB.id,
          key: 'k1',
          requestHash: 'h1',
          incidentId: incident.id,
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      'P2003',
    );
  });

  it('rejects duplicate personal organizations for one user', async () => {
    const user = await createTestUser('c-personal@test.local');
    await ensurePersonalOrganization(user.id);

    await expectPgError(() =>
      getTestPrisma().organization.create({
        data: {
          kind: 'personal',
          personalOwnerUserId: user.id,
          slug: `personal-dup-${user.id}`,
          name: 'Dup',
        },
      }),
      'P2002',
    );
  });

  it('rejects duplicate (organizationId, fingerprint) repositories', async () => {
    const user = await createTestUser('c-repo@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const snap = sampleSnapshot();
    await ingestIncident({ organizationId: org.id, snapshot: snap, userId: user.id });
    const fp = (await getTestPrisma().repository.findFirstOrThrow({ where: { organizationId: org.id } }))
      .fingerprint;

    await expectPgError(() =>
      getTestPrisma().repository.create({
        data: {
          organizationId: org.id,
          fingerprint: fp,
          displayName: 'dup',
        },
      }),
      'P2002',
    );
  });

  it('exposes partial unique indexes and composite foreign keys', async () => {
    const prisma = getTestPrisma();
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('Membership_one_owner_per_org', 'RecoveryPlanRecord_one_current_per_incident')
    `;
    expect(indexes).toHaveLength(2);
    expect(indexes.map((i) => i.indexname).sort()).toEqual([
      'Membership_one_owner_per_org',
      'RecoveryPlanRecord_one_current_per_incident',
    ]);

    const fks = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conname IN (
        'Incident_repositoryId_organizationId_fkey',
        'IdempotencyRecord_incidentId_organizationId_fkey',
        'RecoveryPlanRecord_incidentId_organizationId_fkey'
      )
    `;
    expect(fks).toHaveLength(3);
  });
});
