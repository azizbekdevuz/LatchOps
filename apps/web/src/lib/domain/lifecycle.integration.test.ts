import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auditService from '../domain/audit-service';
import { DomainError } from '../domain/errors';
import { ingestIncident, transitionIncident } from '../domain/incident-service';
import { canSubmitVerification } from '../domain/lifecycle';
import { ensurePersonalOrganization } from '../domain/organization-service';
import { disconnectTestPrisma, getTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from '../test-support/test-db';
import { createTestUser, sampleSnapshot } from '../test-support/fixtures';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const APPROVED: Array<{ from: string; action: string; to: string; role?: 'member' | 'admin' }> = [
  { from: 'detected', action: 'acknowledge', to: 'triaged' },
  { from: 'detected', action: 'dismiss', to: 'dismissed' },
  { from: 'triaged', action: 'start_recovery', to: 'recovery_in_progress' },
  { from: 'plan_ready', action: 'submit_verification', to: 'verification_pending' },
  { from: 'recovery_in_progress', action: 'submit_verification', to: 'verification_pending' },
  { from: 'verification_pending', action: 'verification_succeeded', to: 'resolved' },
  { from: 'verification_pending', action: 'verification_failed', to: 'recovery_in_progress' },
  { from: 'resolved', action: 'reopen', to: 'triaged', role: 'admin' },
  { from: 'dismissed', action: 'reopen', to: 'triaged', role: 'admin' },
];

const REJECTED: Array<{ status: string; action: string }> = [
  { status: 'detected', action: 'submit_verification' },
  { status: 'triaged', action: 'submit_verification' },
  { status: 'resolved', action: 'submit_verification' },
  { status: 'dismissed', action: 'submit_verification' },
  { status: 'resolved', action: 'acknowledge' },
  { status: 'dismissed', action: 'start_recovery' },
];

const VERIFICATION_ALLOWED = ['plan_ready', 'recovery_in_progress', 'verification_pending'] as const;
const VERIFICATION_REJECTED = ['detected', 'triaged', 'resolved', 'dismissed'] as const;

describeDb('incident lifecycle integration', () => {
  let orgId: string;
  let userId: string;

  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const user = await createTestUser('lifecycle@test.local');
    userId = user.id;
    const org = await ensurePersonalOrganization(userId);
    orgId = org.id;
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  async function incidentAt(status: string) {
    const { incident } = await ingestIncident({
      organizationId: orgId,
      snapshot: sampleSnapshot(),
      userId,
    });
    if (incident.status === status) return incident;
    return getTestPrisma().incident.update({
      where: { id: incident.id },
      data: { status: status as typeof incident.status },
    });
  }

  it.each(APPROVED)('allows $action from $from → $to', async ({ from, action, to, role }) => {
    const incident = await incidentAt(from);
    const updated = await transitionIncident({
      organizationId: orgId,
      incidentId: incident.id,
      action: action as 'acknowledge',
      actorUserId: userId,
      role: role ?? 'member',
      expectedVersion: incident.version,
    });
    expect(updated.status).toBe(to);
  });

  it.each(REJECTED)('rejects $action from $status', async ({ status, action }) => {
    const incident = await incidentAt(status);
    await expect(
      transitionIncident({
        organizationId: orgId,
        incidentId: incident.id,
        action: action as 'submit_verification',
        actorUserId: userId,
        role: 'member',
        expectedVersion: incident.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('verification allowed only from plan_ready, recovery_in_progress, verification_pending', () => {
    for (const s of VERIFICATION_ALLOWED) {
      expect(canSubmitVerification(s)).toBe(true);
    }
    for (const s of VERIFICATION_REJECTED) {
      expect(canSubmitVerification(s)).toBe(false);
    }
  });

  it('terminal incident must reopen to triaged before further recovery', async () => {
    let incident = await incidentAt('plan_ready');
    incident = await transitionIncident({
      organizationId: orgId,
      incidentId: incident.id,
      action: 'submit_verification',
      actorUserId: userId,
      role: 'member',
      expectedVersion: incident.version,
    });
    incident = await transitionIncident({
      organizationId: orgId,
      incidentId: incident.id,
      action: 'verification_succeeded',
      actorUserId: userId,
      role: 'member',
      expectedVersion: incident.version,
    });
    expect(incident.status).toBe('resolved');

    await expect(
      transitionIncident({
        organizationId: orgId,
        incidentId: incident.id,
        action: 'submit_verification',
        actorUserId: userId,
        role: 'member',
        expectedVersion: incident.version,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    const reopened = await transitionIncident({
      organizationId: orgId,
      incidentId: incident.id,
      action: 'reopen',
      actorUserId: userId,
      role: 'admin',
      expectedVersion: incident.version,
    });
    expect(reopened.status).toBe('triaged');
  });

  it('concurrent transitions result in one winner and one conflict', async () => {
    const incident = await incidentAt('detected');
    const results = await Promise.allSettled([
      transitionIncident({
        organizationId: orgId,
        incidentId: incident.id,
        action: 'acknowledge',
        actorUserId: userId,
        role: 'member',
        expectedVersion: incident.version,
      }),
      transitionIncident({
        organizationId: orgId,
        incidentId: incident.id,
        action: 'dismiss',
        actorUserId: userId,
        role: 'member',
        expectedVersion: incident.version,
      }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toBeInstanceOf(DomainError);
  });

  it('audit insertion failure rolls back status change', async () => {
    const incident = await incidentAt('detected');
    const spy = vi.spyOn(auditService, 'recordAuthoritative').mockRejectedValueOnce(new Error('audit fail'));

    await expect(
      transitionIncident({
        organizationId: orgId,
        incidentId: incident.id,
        action: 'acknowledge',
        actorUserId: userId,
        role: 'member',
        expectedVersion: incident.version,
      }),
    ).rejects.toThrow('audit fail');

    const { getTestPrisma } = await import('../test-support/test-db');
    const fresh = await getTestPrisma().incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(fresh.status).toBe('detected');
    spy.mockRestore();
  });
});
