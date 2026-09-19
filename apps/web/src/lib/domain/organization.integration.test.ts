import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auditService from '../domain/audit-service';
import { DomainError } from '../domain/errors';
import {
  ensurePersonalOrganization,
  removeMember,
  transferOwnership,
  updateMemberRole,
} from '../domain/organization-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { addMember, createTestUser } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb('organization integration', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('first call creates organization and sole-owner membership', async () => {
    const user = await createTestUser('personal1@test.local');
    const org = await ensurePersonalOrganization(user.id);

    const prisma = getTestPrisma();
    const memberships = await prisma.membership.findMany({ where: { organizationId: org.id } });
    expect(org.kind).toBe('personal');
    expect(memberships).toHaveLength(1);
    expect(memberships[0]!.role).toBe('owner');

    const audit = await prisma.auditEvent.findFirst({
      where: { organizationId: org.id, action: 'organization.created' },
    });
    expect(audit?.tier).toBe('authoritative');
  });

  it('second call is idempotent', async () => {
    const user = await createTestUser('personal2@test.local');
    const first = await ensurePersonalOrganization(user.id);
    const second = await ensurePersonalOrganization(user.id);
    expect(second.id).toBe(first.id);
    expect(await getTestPrisma().organization.count()).toBe(1);
  });

  it('concurrent calls create exactly one personal organization', async () => {
    const user = await createTestUser('personal3@test.local');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensurePersonalOrganization(user.id)),
    );
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);
    expect(await getTestPrisma().organization.count()).toBe(1);
    expect(await getTestPrisma().membership.count({ where: { role: 'owner' } })).toBe(1);
  });

  it('valid ownership transfer succeeds; previous owner becomes admin; target becomes sole owner', async () => {
    const owner = await createTestUser('owner@test.local');
    const target = await createTestUser('target@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await addMember(org.id, target.id, 'member');

    await transferOwnership(org.id, owner.id, target.id);

    const prisma = getTestPrisma();
    const ownerMembership = await prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    });
    const targetMembership = await prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: org.id, userId: target.id } },
    });
    expect(ownerMembership.role).toBe('admin');
    expect(targetMembership.role).toBe('owner');
    expect(await prisma.membership.count({ where: { organizationId: org.id, role: 'owner' } })).toBe(1);
  });

  it('concurrent transfers result in one success and one conflict', async () => {
    const owner = await createTestUser('owner2@test.local');
    const a = await createTestUser('a@test.local');
    const b = await createTestUser('b@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await addMember(org.id, a.id, 'member');
    await addMember(org.id, b.id, 'member');

    const results = await Promise.allSettled([
      transferOwnership(org.id, owner.id, a.id),
      transferOwnership(org.id, owner.id, b.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
  });

  it('audit failure rolls back the transfer', async () => {
    const owner = await createTestUser('owner3@test.local');
    const target = await createTestUser('target3@test.local');
    const org = await ensurePersonalOrganization(owner.id);
    await addMember(org.id, target.id, 'member');

    const spy = vi.spyOn(auditService, 'recordAuthoritative').mockRejectedValueOnce(new Error('audit down'));

    await expect(transferOwnership(org.id, owner.id, target.id)).rejects.toThrow('audit down');

    const prisma = getTestPrisma();
    const ownerMembership = await prisma.membership.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    });
    expect(ownerMembership.role).toBe('owner');
    spy.mockRestore();
  });

  it('sole owner cannot be removed or demoted directly', async () => {
    const owner = await createTestUser('owner4@test.local');
    const org = await ensurePersonalOrganization(owner.id);

    await expect(removeMember(org.id, owner.id, owner.id)).rejects.toMatchObject({
      code: 'CANNOT_REMOVE_OWNER',
    });
    await expect(updateMemberRole(org.id, owner.id, owner.id, 'admin')).rejects.toMatchObject({
      code: 'CANNOT_DEMOTE_OWNER',
    });
  });
});
