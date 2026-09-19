import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewProof, runProof } from './proof';
import { createLocalWorkspace } from './workspace';

const originals = {
  DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
  NOSANA_API_KEY: process.env.NOSANA_API_KEY,
  HACKSPRINT_ISOLATION: process.env.HACKSPRINT_ISOLATION,
};

afterEach(() => {
  process.env.DAYTONA_API_KEY = originals.DAYTONA_API_KEY;
  process.env.NOSANA_API_KEY = originals.NOSANA_API_KEY;
  process.env.HACKSPRINT_ISOLATION = originals.HACKSPRINT_ISOLATION;
  vi.unstubAllGlobals();
});

describe('runProof local isolation', () => {
  it('proves the built-in merge conflict with deterministic engines and mocked Nosana', async () => {
    delete process.env.DAYTONA_API_KEY;
    delete process.env.NOSANA_API_KEY;

    const result = await runProof(
      { scenarioId: 'merge_conflict_demo' },
      {
        createWorkspace: async () => ({
          workspace: createLocalWorkspace(),
          isolation: 'local',
        }),
        explain: async () => ({
          status: {
            status: 'unavailable',
            model: null,
            message: 'Nosana unavailable',
          },
          explanation: null,
        }),
      },
    );

    expect(result.signalsBefore.state).toBe('merge_conflict');
    expect(result.plan.generatedBy).toBe('deterministic_engine');
    expect(result.plan.alternatives.map((alt) => alt.id)).toEqual(['complete_merge', 'abort_merge']);
    expect(result.isolation).toBe('local');
    expect(result.daytona.status).not.toBe('live');
    expect(result.verdict).toBe('VERIFIED');
    expect(result.verification?.status).toBe('succeeded');
    expect(result.signalsAfter?.operations.merge).toBe(false);
    expect(result.signalsAfter?.worktree.conflicted).toBe(0);
    expect(result.nosana.status).toBe('unavailable');
    expect(result.explanation).toBeNull();
    expect(result.broken.conflictedPaths).toEqual(['deploy.env']);
    expect(result.execution.some((row) => row.source === 'demo_orchestration')).toBe(true);
    expect(
      result.execution.some((row) =>
        row.display.includes('controlled demo orchestration'),
      ),
    ).toBe(true);
    const resolved = result.execution.find((row) => row.source === 'demo_orchestration');
    expect(resolved?.stdout).toContain('ENVIRONMENT=production');
    expect(resolved?.stdout).toContain('PORT=8443');
    expect(resolved?.stdout).toContain('HEALTHCHECK_PATH=/healthz');
    expect(result.execution.some((row) => row.display.includes('commit --no-edit'))).toBe(true);
    expect(result.daytona.cleanedUp).toBe(true);
  }, 40_000);

  it('builds a truthful fixture preview when host git is unavailable', async () => {
    delete process.env.DAYTONA_API_KEY;
    delete process.env.NOSANA_API_KEY;
    const preview = await previewProof({ hostGitAvailable: async () => false });
    expect(preview.previewSource).toBe('built_in_fixture');
    expect(preview.previewNote).toMatch(/not a live host Git capture/i);
    expect(preview.broken.incidentType).toBe('merge_conflict');
    expect(preview.broken.mergeActive).toBe(true);
    expect(preview.broken.conflictedPaths).toEqual(['deploy.env']);
    expect(preview.plan.generatedBy).toBe('deterministic_engine');
    expect(preview.plan.alternatives.map((alt) => alt.id)).toEqual(['complete_merge', 'abort_merge']);
  });

  it('refuses a local fallback when host git is missing', async () => {
    delete process.env.DAYTONA_API_KEY;
    delete process.env.NOSANA_API_KEY;
    await expect(
      runProof(
        { scenarioId: 'merge_conflict_demo' },
        {
          hostGitAvailable: async () => false,
          explain: async () => ({
            status: { status: 'missing', model: null, message: 'NOSANA_API_KEY is not set' },
            explanation: null,
          }),
        },
      ),
    ).rejects.toThrow(/Host git is not available/);
  });

  it('never reports Daytona live without a sandbox id', async () => {
    process.env.DAYTONA_API_KEY = 'test-key';
    delete process.env.NOSANA_API_KEY;

    const result = await runProof(
      {},
      {
        createWorkspace: async () => ({
          workspace: createLocalWorkspace(),
          isolation: 'local',
          fallbackReason: 'Daytona create failed: network',
        }),
        explain: async () => ({
          status: { status: 'missing', model: null, message: 'NOSANA_API_KEY is not set' },
          explanation: null,
        }),
      },
    );

    expect(result.daytona.status).toBe('error');
    expect(result.daytona.sandboxId).toBeNull();
    expect(result.verdict).toBe('VERIFIED');
  }, 40_000);
});
