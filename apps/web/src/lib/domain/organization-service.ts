import type { MembershipRole } from '@latchops/schema';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { DomainError, isPrismaUniqueViolation } from './errors';
import { recordAuthoritative } from './audit-service';

function personalOrgLockKey(userId: string): string {
  return `personal_org:${userId}`;
}

export async function ensurePersonalOrganizationInTx(tx: OrganizationTx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${personalOrgLockKey(userId)}))`;

  const existing = await tx.organization.findUnique({ where: { personalOwnerUserId: userId } });
  if (existing) return existing;

  try {
    const org = await tx.organization.create({
      data: {
        kind: 'personal',
        personalOwnerUserId: userId,
        slug: `personal-${userId}`,
        name: 'Personal',
        memberships: { create: { userId, role: 'owner' } },
      },
    });
    await recordAuthoritative(tx, {
      organizationId: org.id,
      actorUserId: userId,
      actorType: 'user',
      action: 'organization.created',
      payload: { kind: 'personal' },
    });
    return org;
  } catch (error) {
    if (isPrismaUniqueViolation(error, 'personalOwnerUserId')) {
      return tx.organization.findUniqueOrThrow({ where: { personalOwnerUserId: userId } });
    }
    throw error;
  }
}

export async function ensurePersonalOrganization(userId: string) {
  return prisma.$transaction(async (tx) => ensurePersonalOrganizationInTx(tx, userId));
}

export async function createOrganization(userId: string, input: { name: string; slug?: string }) {
  const slug = input.slug ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        kind: 'team',
        name: input.name,
        slug,
        memberships: { create: { userId, role: 'owner' } },
      },
    });
    await recordAuthoritative(tx, {
      organizationId: org.id,
      actorUserId: userId,
      actorType: 'user',
      action: 'organization.created',
      payload: { kind: 'team' },
    });
    return org;
  });
}

export async function getOrganizationsForUser(userId: string) {
  return prisma.membership.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getMembership(organizationId: string, userId: string) {
  return prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
}

export async function assertOrgWritable(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new DomainError('ORG_NOT_FOUND', 'Organization not found', 404);
  if (org.status === 'archived') throw new DomainError('ORG_ARCHIVED', 'Organization is archived', 403);
  return org;
}

export async function transferOwnership(organizationId: string, fromUserId: string, toUserId: string) {
  await assertOrgWritable(organizationId);
  return prisma.$transaction(async (tx) => {
    const fromMembership = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: fromUserId } },
    });
    if (!fromMembership || fromMembership.role !== 'owner') {
      throw new DomainError('NOT_OWNER', 'Only the current owner can transfer ownership', 409);
    }

    const toMembership = await tx.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
    });
    if (!toMembership) {
      throw new DomainError('TARGET_NOT_MEMBER', 'Target user must already be a member', 404);
    }

    const demoted = await tx.membership.updateMany({
      where: { organizationId, userId: fromUserId, role: 'owner' },
      data: { role: 'admin' },
    });
    if (demoted.count !== 1) throw new DomainError('CONFLICT', 'Ownership transfer conflict', 409);

    await tx.membership.update({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
      data: { role: 'owner' },
    });

    await recordAuthoritative(tx, {
      organizationId,
      actorUserId: fromUserId,
      actorType: 'user',
      action: 'membership.ownership_transferred',
      payload: { fromUserId, toUserId },
    });
  });
}

export async function updateMemberRole(
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  role: MembershipRole,
) {
  await assertOrgWritable(organizationId);
  if (role === 'owner') {
    throw new DomainError('USE_TRANSFER', 'Use transferOwnership to change owner', 400);
  }

  const target = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
  if (!target) throw new DomainError('MEMBER_NOT_FOUND', 'Member not found', 404);
  if (target.role === 'owner') {
    throw new DomainError('CANNOT_DEMOTE_OWNER', 'Transfer ownership before changing owner role', 409);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.membership.update({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      data: { role },
    });
    await recordAuthoritative(tx, {
      organizationId,
      actorUserId,
      actorType: 'user',
      action: 'membership.role_changed',
      payload: { targetUserId, role },
    });
    return updated;
  });
}

export async function removeMember(organizationId: string, actorUserId: string, targetUserId: string) {
  await assertOrgWritable(organizationId);
  const target = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: targetUserId } },
  });
  if (!target) throw new DomainError('MEMBER_NOT_FOUND', 'Member not found', 404);
  if (target.role === 'owner') {
    throw new DomainError('CANNOT_REMOVE_OWNER', 'Transfer ownership before removing owner', 409);
  }

  return prisma.$transaction(async (tx) => {
    await tx.membership.delete({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    await recordAuthoritative(tx, {
      organizationId,
      actorUserId,
      actorType: 'user',
      action: 'membership.removed',
      payload: { targetUserId },
    });
  });
}

export async function archiveOrganization(organizationId: string, actorUserId: string) {
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.update({
      where: { id: organizationId, status: 'active' },
      data: { status: 'archived', archivedAt: new Date() },
    });
    await recordAuthoritative(tx, {
      organizationId,
      actorUserId,
      actorType: 'user',
      action: 'organization.archived',
    });
    return org;
  });
}

export type OrganizationTx = Prisma.TransactionClient;
