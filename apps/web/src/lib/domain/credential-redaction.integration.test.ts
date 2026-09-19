import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliCredential, listCliCredentials, revokeCliCredential } from './cli-credential-service';
import { ensurePersonalOrganization } from './organization-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { createTestUser } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('credential redaction integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('create returns plaintext only once; DB stores hash not token', async () => {
    const user = await createTestUser('redact@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { record, token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'ci',
    });

    expect(token).toMatch(/^lops_live_/);
    const row = await getTestPrisma().cliCredential.findUniqueOrThrow({ where: { id: record.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(token.split('.')[1]);
  });

  it('list and revoke responses never expose tokenHash or secret', async () => {
    const user = await createTestUser('redact2@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { record, token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'ci',
    });

    const listed = await listCliCredentials(org.id);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(token.split('.')[1]!);
    expect(listed[0]!.tokenId).toBe(record.tokenId);

    await revokeCliCredential({ organizationId: org.id, credentialId: record.id, actorUserId: user.id });
    const after = await listCliCredentials(org.id);
    expect(JSON.stringify(after)).not.toContain('tokenHash');
  });

  it('audit payload contains credential ID and tokenId only', async () => {
    const user = await createTestUser('audit-redact@test.local');
    const org = await ensurePersonalOrganization(user.id);
    const { record, token } = await createCliCredential({
      organizationId: org.id,
      createdById: user.id,
      name: 'audit',
    });

    const audit = await getTestPrisma().auditEvent.findFirst({
      where: { action: 'cli_credential.created', organizationId: org.id },
    });
    const payload = JSON.stringify(audit?.payload ?? {});
    expect(payload).toContain(record.id);
    expect(payload).toContain(record.tokenId);
    expect(payload).not.toContain(token);
    expect(payload).not.toContain('tokenHash');
  });
});
