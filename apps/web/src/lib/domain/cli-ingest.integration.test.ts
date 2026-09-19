import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auditService from './audit-service';
import { createCliCredential, revokeCliCredential, verifyCliToken } from './cli-credential-service';
import { ingestCliIncident } from './cli-ingest-service';
import { ensurePersonalOrganization } from './organization-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('cli ingest integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  async function seedCredential() {
    const user = await createTestUser('cli-ingest@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { record, token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'ci-token',
    });
    return { user, org, record, token };
  }

  it('ingests with valid token and stores hash only', async () => {
    const { org, record, token } = await seedCredential();
    const key = 'idem-1';
    const body = { snapshot: sampleSnapshot() };

    const result = await ingestCliIncident({
      auth: (await verifyCliToken(token))!,
      rawSnapshot: body.snapshot,
      idempotencyKey: key,
      requestBodyForHash: body,
    });

    expect(result.replayed).toBe(false);
    expect(result.organizationId).toBe(org.id);

    const prisma = getTestPrisma();
    const stored = await prisma.cliCredential.findUniqueOrThrow({ where: { id: record.id } });
    expect(stored.tokenHash).not.toContain('.');
    expect(stored.tokenHash).not.toBe(token);

    const replay = await ingestCliIncident({
      auth: (await verifyCliToken(token))!,
      rawSnapshot: body.snapshot,
      idempotencyKey: key,
      requestBodyForHash: body,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.incidentId).toBe(result.incidentId);
  });

  it('rejects idempotency conflict for same key different body', async () => {
    const { token } = await seedCredential();
    const auth = (await verifyCliToken(token))!;
    const key = 'idem-conflict';

    await ingestCliIncident({
      auth,
      rawSnapshot: sampleSnapshot({ repoRoot: '/tmp/a' }),
      idempotencyKey: key,
      requestBodyForHash: { snapshot: sampleSnapshot({ repoRoot: '/tmp/a' }) },
    });

    await expect(
      ingestCliIncident({
        auth,
        rawSnapshot: sampleSnapshot({ repoRoot: '/tmp/b' }),
        idempotencyKey: key,
        requestBodyForHash: { snapshot: sampleSnapshot({ repoRoot: '/tmp/b' }) },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects expired token', async () => {
    const user = await createTestUser('expired@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'expired',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyCliToken(token)).toBeNull();
  });

  it('rejects revoked token', async () => {
    const user = await createTestUser('revoked@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { record, token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'revoke-me',
    });
    await revokeCliCredential({ organizationId: org.id, credentialId: record.id, actorUserId: user.id });
    expect(await verifyCliToken(token)).toBeNull();
  });

  it('audit failure rolls back credential create', async () => {
    const user = await createTestUser('audit-cli@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const spy = vi.spyOn(auditService, 'recordAuthoritative').mockRejectedValueOnce(new Error('audit down'));

    await expect(
      createCliCredential({ organizationId: org.id, createdById: user.id, name: 'fail' }),
    ).rejects.toThrow('audit down');

    expect(await getTestPrisma().cliCredential.count({ where: { organizationId: org.id } })).toBe(0);
    spy.mockRestore();
  });
});
