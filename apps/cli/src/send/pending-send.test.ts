import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeRepositoryFingerprint } from '@latchops/schema';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyStaleMarkers,
  clearPendingSubmission,
  createPendingSubmission,
  discardPendingSubmission,
  loadPendingRetry,
  MAX_PENDING_SUBMISSIONS,
  PendingStorageFullError,
  PendingSubmissionExistsError,
  readPendingStoreForTest,
  readPayloadFileForTest,
  resetPendingStoreForTest,
  STALE_PENDING_MS,
  writePendingStoreForTest,
} from './pending-send.js';
import { hashRawBytes } from './request-hash.js';

const API = 'http://localhost:3000';

function fingerprintFor(remoteUrl: string | null, rootOid: string) {
  return computeRepositoryFingerprint({
    remotes: remoteUrl ? [{ name: 'origin', url: remoteUrl }] : [],
    rootCommitOid: rootOid,
  });
}

const REPO_A = fingerprintFor('https://github.com/org/repo.git', 'a'.repeat(40));
const REPO_B = fingerprintFor('https://github.com/org/other.git', 'b'.repeat(40));
const REPO_LOCAL = fingerprintFor(null, 'c'.repeat(40));

describe('pending-send lifecycle', () => {
  let stateDir: string;

  afterEach(async () => {
    if (stateDir) await resetPendingStoreForTest(stateDir);
  });

  async function setup() {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'latchops-pending-'));
    return stateDir;
  }

  it('stores exact request bytes keyed by apiOrigin and repository fingerprint', async () => {
    const dir = await setup();
    const requestBodyBytes = JSON.stringify({ snapshot: { version: 1, capturedAt: 't1' } });
    const requestHash = hashRawBytes(requestBodyBytes);

    const { idempotencyKey, reused } = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      displayName: REPO_A.displayName,
      requestBodyBytes,
      stateDir: dir,
    });

    expect(reused).toBe(false);
    expect(idempotencyKey).toMatch(/^cli-/);

    const store = await readPendingStoreForTest(dir);
    expect(Object.keys(store.entries)).toHaveLength(1);
    const record = Object.values(store.entries)[0]!;
    expect(record.repositoryFingerprint).toBe(REPO_A.fingerprint);
    expect(record.requestHash).toBe(requestHash);
    expect(record.apiOrigin).toBe(API);
    expect(await readPayloadFileForTest(dir, record.payloadFile)).toBe(requestBodyBytes);
    expect(JSON.stringify(record)).not.toMatch(/lops_live_|Bearer/i);
  });

  it('retry loads original bytes without recapture', async () => {
    const dir = await setup();
    const originalBytes = JSON.stringify({ snapshot: { version: 1, capturedAt: 'original' } });
    const first = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      requestBodyBytes: originalBytes,
      stateDir: dir,
    });

    const retry = await loadPendingRetry({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      stateDir: dir,
    });
    expect(retry?.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry?.requestBodyBytes).toBe(originalBytes);
  });

  it('marks submissions stale after configured age but retains payload and key', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { old: true } });
    const first = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    const store = await readPendingStoreForTest(dir);
    const key = Object.keys(store.entries)[0]!;
    store.entries[key]!.createdAt = new Date(Date.now() - STALE_PENDING_MS - 86_400_000).toISOString();
    await writePendingStoreForTest(dir, store);

    const loaded = await loadPendingRetry({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      stateDir: dir,
    });
    expect(loaded?.stale).toBe(true);
    expect(loaded?.idempotencyKey).toBe(first.idempotencyKey);
    expect(loaded?.requestBodyBytes).toBe(bytes);

    const after = await readPendingStoreForTest(dir);
    expect(Object.keys(after.entries)).toHaveLength(1);
  });

  it('does not silently replace an existing pending submission with a different payload', async () => {
    const dir = await setup();
    await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/tmp/repo-a',
      requestBodyBytes: JSON.stringify({ snapshot: { first: true } }),
      stateDir: dir,
    });

    await expect(
      createPendingSubmission({
        apiOrigin: API,
        repositoryFingerprint: REPO_A.fingerprint,
        repoRoot: '/tmp/repo-a',
        requestBodyBytes: JSON.stringify({ snapshot: { second: true } }),
        stateDir: dir,
      }),
    ).rejects.toBeInstanceOf(PendingSubmissionExistsError);
  });

  it('refuses an eleventh pending submission without deleting existing entries', async () => {
    const dir = await setup();
  const created: string[] = [];
    for (let i = 0; i < MAX_PENDING_SUBMISSIONS; i++) {
      const rootOid = `${'a'.repeat(39)}${i}`;
      const fp = fingerprintFor(`https://github.com/org/repo-${i}.git`, rootOid);
      await createPendingSubmission({
        apiOrigin: API,
        repositoryFingerprint: fp.fingerprint,
        requestBodyBytes: JSON.stringify({ snapshot: { n: i } }),
        stateDir: dir,
      });
      created.push(fp.fingerprint);
    }

    const overflow = fingerprintFor('https://github.com/org/overflow.git', 'f'.repeat(40));
    await expect(
      createPendingSubmission({
        apiOrigin: API,
        repositoryFingerprint: overflow.fingerprint,
        requestBodyBytes: JSON.stringify({ snapshot: { overflow: true } }),
        stateDir: dir,
      }),
    ).rejects.toBeInstanceOf(PendingStorageFullError);

    const store = await readPendingStoreForTest(dir);
    expect(Object.keys(store.entries)).toHaveLength(MAX_PENDING_SUBMISSIONS);
    for (const fp of created) {
      expect(store.entries[`${API}\0${fp}`]).toBeDefined();
    }
  });

  it('finds pending submission after repository path move via fingerprint', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { moved: true } });
    const first = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/old/path/repo',
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    const loaded = await loadPendingRetry({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/new/path/repo',
      stateDir: dir,
    });
    expect(loaded?.idempotencyKey).toBe(first.idempotencyKey);
    expect(loaded?.requestBodyBytes).toBe(bytes);
  });

  it('isolates pending identity by repository fingerprint', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { same: true } });
    const a = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });
    const b = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_B.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });

  it('isolates pending identity by API origin', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { same: true } });
    const local = await createPendingSubmission({
      apiOrigin: 'http://localhost:3000',
      repositoryFingerprint: REPO_A.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });
    const prod = await createPendingSubmission({
      apiOrigin: 'https://api.latchops.example',
      repositoryFingerprint: REPO_A.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });
    expect(prod.idempotencyKey).not.toBe(local.idempotencyKey);
  });

  it('supports no-remote repositories via local root-commit fingerprint', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { local: true } });
    const created = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_LOCAL.fingerprint,
      displayName: REPO_LOCAL.displayName,
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    const loaded = await loadPendingRetry({
      apiOrigin: API,
      repositoryFingerprint: REPO_LOCAL.fingerprint,
      stateDir: dir,
    });
    expect(loaded?.idempotencyKey).toBe(created.idempotencyKey);
    expect(loaded?.requestBodyBytes).toBe(bytes);
  });

  it('explicit discard after move allows a new submission identity', async () => {
    const dir = await setup();
    const firstBytes = JSON.stringify({ snapshot: { n: 1 } });
    const first = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/old/path/repo',
      requestBodyBytes: firstBytes,
      stateDir: dir,
    });

    await discardPendingSubmission(API, REPO_A.fingerprint, dir, '/new/path/repo');

    const secondBytes = JSON.stringify({ snapshot: { n: 2 } });
    const second = await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      repoRoot: '/new/path/repo',
      requestBodyBytes: secondBytes,
      stateDir: dir,
    });
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it('clears pending only on explicit success or discard', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { x: 1 } });
    await createPendingSubmission({
      apiOrigin: API,
      repositoryFingerprint: REPO_A.fingerprint,
      requestBodyBytes: bytes,
      stateDir: dir,
    });

    await clearPendingSubmission(API, REPO_A.fingerprint, dir);
    expect(
      await loadPendingRetry({
        apiOrigin: API,
        repositoryFingerprint: REPO_A.fingerprint,
        stateDir: dir,
      }),
    ).toBeNull();
  });

  it('applyStaleMarkers never deletes entries', () => {
    const store = {
      version: 3 as const,
      entries: {
        k: {
          apiOrigin: API,
          repositoryFingerprint: REPO_A.fingerprint,
          idempotencyKey: 'cli-test',
          requestHash: 'abc',
          payloadFile: 'payloads/x.json',
          createdAt: new Date(Date.now() - STALE_PENDING_MS - 1).toISOString(),
        },
      },
    };
    const marked = applyStaleMarkers(store);
    expect(Object.keys(marked.entries)).toHaveLength(1);
    expect(marked.entries.k?.stale).toBe(true);
  });

  it('concurrent submissions for the same fingerprint reuse one identity', async () => {
    const dir = await setup();
    const bytes = JSON.stringify({ snapshot: { concurrent: true } });
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        createPendingSubmission({
          apiOrigin: API,
          repositoryFingerprint: REPO_A.fingerprint,
          requestBodyBytes: bytes,
          stateDir: dir,
        }),
      ),
    );
    expect(new Set(results.map((r) => r.idempotencyKey)).size).toBe(1);
    expect((await readPendingStoreForTest(dir)).entries).toHaveProperty(
      `${API}\0${REPO_A.fingerprint}`,
    );
  });
});
