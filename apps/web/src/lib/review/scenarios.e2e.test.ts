import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, verifyAuditChain } from './audit';
import { resetReviewDbForTests } from './db';
import { groundedResponse } from './fixture-responses';
import { fixtureProvider } from './llm';
import { RUNNER_ACTORS, runScenario } from './scenario-runner';
import { REVIEW_SCENARIOS } from './scenarios';
import { createScenarioReview, executeReview, getReview, importCliSnapshot, ReviewError } from './service';
import { builtInBrokenSnapshot } from '@/lib/isolation/demo-scenario';

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'latchops-review-test-'));
  await resetReviewDbForTests(`file:${join(dir, 'test.db').replace(/\\/g, '/')}`);
});

afterAll(async () => {
  const db = await resetReviewDbForTests(`file:${join(dir, 'closing.db').replace(/\\/g, '/')}`);
  await db.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows may hold the sqlite file briefly */
  }
});

const echoProvider = fixtureProvider((prompt) => prompt.user, 'fixture:echo');

describe('Recovery Review scenarios (git + SQLite, fixture model)', () => {
  expect(REVIEW_SCENARIOS.length).toBeGreaterThanOrEqual(15);

  for (const scenario of REVIEW_SCENARIOS) {
    it(`${scenario.id} ${scenario.title}`, async () => {
      const outcome = await runScenario(scenario, { provider: null });

      expect(outcome.verdict).toBe(scenario.expected.verdict);
      expect(outcome.unauthorizedExecution).toBe(false);
      expect(outcome.plantedSecretsInEvidence).toBe(0);
      expect(outcome.plantedSecretsInPrompts).toBe(0);
      expect(outcome.auditChainValid).toBe(true);
      if (scenario.expected.evidenceTruncated) expect(outcome.evidenceTruncated).toBe(true);
      if (scenario.expected.plantedSecrets) expect(outcome.redactions).toBeGreaterThanOrEqual(scenario.expected.plantedSecrets.length);
      if (scenario.control === 'no_consent') expect(outcome.explanationBlocked).toMatch(/consent/i);
      if (scenario.control === 'bad_llm') expect(outcome.adversarialRejected).toBe(outcome.adversarialTotal);
      if (scenario.control === 'viewer' || scenario.control === 'self_approval') expect(outcome.decisionRefused).not.toBeNull();
      if (scenario.id === 'S11') expect(outcome.authReasons.join(' ')).toMatch(/covers 5 of 7 unmerged paths/);
      if (scenario.id === 'S04') expect(outcome.authReasons.join(' ')).toMatch(/conflict markers remain/);
    }, 120_000);
  }
});

describe('explanations through the service', () => {
  it('accepts a grounded fixture explanation and persists it', async () => {
    const incidentId = await createScenarioReview(RUNNER_ACTORS.requester, 'S03');
    const review = await getReview(incidentId);
    const provider = fixtureProvider(() =>
      groundedResponse(review.snapshot.evidence.items, review.snapshot.signals.worktree.conflictedPaths),
    );
    const { grantConsent, generateExplanation } = await import('./service');
    await grantConsent(RUNNER_ACTORS.requester, incidentId, provider.id);
    const direct = await generateExplanation(RUNNER_ACTORS.requester, incidentId, 'direct', { provider });
    const rag = await generateExplanation(RUNNER_ACTORS.requester, incidentId, 'rag', { provider });
    expect(direct.status).toBe('accepted');
    expect(rag.status).toBe('accepted');
    const after = await getReview(incidentId);
    expect(after.explanations).toHaveLength(2);
    expect(after.incident.status).toBe('explained');
  }, 60_000);

  it('records a model echoing the prompt as rejected', async () => {
    const incidentId = await createScenarioReview(RUNNER_ACTORS.requester, 'S01');
    const { grantConsent, generateExplanation } = await import('./service');
    await grantConsent(RUNNER_ACTORS.requester, incidentId, echoProvider.id);
    const outcome = await generateExplanation(RUNNER_ACTORS.requester, incidentId, 'direct', { provider: echoProvider });
    expect(outcome.status).toBe('rejected');
  }, 60_000);
});

describe('security regressions', () => {
  it('an approval can be used only once', async () => {
    const scenario = REVIEW_SCENARIOS.find((s) => s.id === 'S01')!;
    const first = await runScenario(scenario, { provider: null });
    expect(first.verdict).toBe('VERIFIED');
    const second = await executeReview(RUNNER_ACTORS.requester, first.incidentId);
    expect(second.authorized).toBe(false);
    expect(second.reasons.join(' ')).toMatch(/already used/);
  }, 120_000);

  it('detects an edited audit row', async () => {
    const incidentId = await createScenarioReview(RUNNER_ACTORS.requester, 'S01');
    const { reviewDb } = await import('./db');
    const db = await reviewDb();
    await db.$transaction((tx) => appendAudit(tx, { incidentId, actorId: 'minji', action: 'note', payload: { x: 1 } }));
    expect((await verifyAuditChain(db, incidentId)).valid).toBe(true);
    const row = await db.reviewAuditEvent.findFirst({ where: { incidentId, action: 'note' } });
    await db.reviewAuditEvent.update({ where: { seq: row!.seq }, data: { payload: '{"x":2}' } });
    const check = await verifyAuditChain(db, incidentId);
    expect(check.valid).toBe(false);
    expect(check.brokenAtSeq).toBe(row!.seq);
  }, 60_000);

  it('imports a CLI snapshot read-only and never executes it', async () => {
    const incidentId = await importCliSnapshot(RUNNER_ACTORS.requester, builtInBrokenSnapshot(), 'imported');
    const review = await getReview(incidentId);
    expect(review.incident.source).toBe('cli_import');
    expect(JSON.stringify(review.snapshot.evidence)).not.toContain('/demo/checkout-service');
    const result = await executeReview(RUNNER_ACTORS.requester, incidentId);
    expect(result.authorized).toBe(false);
    expect(result.verdict).toBe('BLOCKED');
  }, 60_000);

  it('rejects out-of-scope incident types on import', async () => {
    const snapshot = { ...builtInBrokenSnapshot(), unmergedFiles: [], mergeHead: undefined, rawStatus: '' };
    await expect(importCliSnapshot(RUNNER_ACTORS.requester, snapshot)).rejects.toBeInstanceOf(ReviewError);
  });

  it('viewers cannot create reviews', async () => {
    await expect(createScenarioReview(RUNNER_ACTORS.viewer, 'S01')).rejects.toMatchObject({ status: 403 });
  });
});
