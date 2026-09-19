import { z } from 'zod';

export const MembershipRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type MembershipRole = z.infer<typeof MembershipRoleSchema>;

export const OrganizationStatusSchema = z.enum(['active', 'archived']);
export type OrganizationStatus = z.infer<typeof OrganizationStatusSchema>;

export const ROLE_RANK: Record<MembershipRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export function hasMinRole(actual: MembershipRole, required: MembershipRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
