import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeRepositoryFingerprint } from '@latchops/schema';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { resetPendingStoreForTest } from './pending-send.js';
import { hashRawBytes } from './request-hash.js';

const API = 'http://localhost:3000';
const FP = computeRepositoryFingerprint({
  remotes: [{ name: 'origin', url: 'https://github.com/org/cross.git' }],
  rootCommitOid: 'd'.repeat(40),
});
const workerPath = fileURLToPath(new URL('./pending-send.worker.mjs', import.meta.url));
const cliRoot = fileURLToPath(new URL('../..', import.meta.url));

function runWorker(op: string, payload: Record<string, unknown>) {
  const result = spawnSync(process.execPath, [workerPath, op, JSON.stringify(payload)], {
    encoding: 'utf8',
    cwd: cliRoot,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `worker ${op} failed`);
  }
  return JSON.parse(result.stdout.trim()) as unknown;
}

describe('pending-send cross-process retry proof', () => {
  let stateDir: string;

  beforeAll(() => {
    const build = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], {
      cwd: cliRoot,
      encoding: 'utf8',
      shell: true,
    });
    if (build.status !== 0) {
      throw new Error(`CLI build failed for cross-process tests:\n${build.stderr}`);
    }
  });

  afterEach(async () => {
    if (stateDir) await resetPendingStoreForTest(stateDir);
  });

  async function setup() {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latchops-xproc-'));
    return stateDir;
  }

  it('stores exact bytes in process A and reloads them in process B', async () => {
    const dir = await setup();
    const originalBytes = JSON.stringify({ snapshot: { capturedAt: 't-fixed', seq: 1 } });
    const requestHash = hashRawBytes(originalBytes);

    const created = runWorker('create', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      requestBodyBytes: originalBytes,
      stateDir: dir,
    }) as { idempotencyKey: string; requestHash: string };

    expect(created.requestHash).toBe(requestHash);

    const loaded = runWorker('load', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      repoRoot: '/new/path',
      stateDir: dir,
    }) as {
      idempotencyKey: string;
      requestBodyBytes: string;
      requestHash: string;
      reused: boolean;
    };

    expect(loaded.reused).toBe(true);
    expect(loaded.idempotencyKey).toBe(created.idempotencyKey);
    expect(loaded.requestBodyBytes).toBe(originalBytes);
    expect(loaded.requestHash).toBe(requestHash);
  });

  it('simulated timeout retains payload; second invocation resends original bytes', async () => {
    const dir = await setup();
    const originalBytes = JSON.stringify({ snapshot: { capturedAt: 'first-send', value: 42 } });
    const wouldBeDifferent = JSON.stringify({ snapshot: { capturedAt: 'second-send', value: 99 } });
    expect(wouldBeDifferent).not.toBe(originalBytes);

    const first = runWorker('create', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      requestBodyBytes: originalBytes,
      stateDir: dir,
    }) as { idempotencyKey: string; requestHash: string };

    const retry = runWorker('load', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      stateDir: dir,
    }) as {
      idempotencyKey: string;
      requestBodyBytes: string;
      requestHash: string;
    };

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.requestBodyBytes).toBe(originalBytes);
    expect(retry.requestHash).toBe(first.requestHash);
  });

  it('success clears payload across processes', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { ok: true } });
    runWorker('create', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    runWorker('clear', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      stateDir: dir,
    });
    const loaded = runWorker('load', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      stateDir: dir,
    });
    expect(loaded).toBeNull();
  });

  it('does not persist bearer tokens on disk', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { safe: true } });
    runWorker('create', {
      apiOrigin: API,
      repositoryFingerprint: FP.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    const indexRaw = await fs.readFile(path.join(dir, 'pending-sends.json'), 'utf8');
    expect(indexRaw).not.toMatch(/lops_live_|Bearer/i);
  });
});
