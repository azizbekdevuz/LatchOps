import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getLatchOpsStateDir,
  pendingPayloadPath,
  pendingPayloadsDir,
  pendingSendsFilePath,
  pendingSendsLockPath,
} from './paths.js';
import { hashRawBytes } from './request-hash.js';

/** Age after which a pending submission is marked stale (never auto-deleted). */
export const STALE_PENDING_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum unresolved pending submissions on disk. */
export const MAX_PENDING_SUBMISSIONS = 10;

/** Maximum total bytes for unresolved pending payloads. */
export const MAX_PENDING_TOTAL_BYTES = 50 * 1024 * 1024;

export class PendingPayloadCorruptError extends Error {
  constructor(message = 'Pending payload failed integrity check') {
    super(message);
    this.name = 'PendingPayloadCorruptError';
  }
}

export class PendingSubmissionExistsError extends Error {
  constructor(
    message: string,
    public readonly summary: PendingSubmissionSummary,
  ) {
    super(message);
    this.name = 'PendingSubmissionExistsError';
  }
}

export class PendingStorageFullError extends Error {
  constructor(
    message: string,
    public readonly existing: PendingSubmissionSummary[],
    public readonly limits: { maxCount: number; maxBytes: number },
  ) {
    super(message);
    this.name = 'PendingStorageFullError';
  }
}

export interface PendingSubmissionSummary {
  apiOrigin: string;
  repositoryFingerprint: string;
  idempotencyKeyPrefix: string;
  displayName?: string;
  createdAt: string;
  stale: boolean;
}

export interface PendingSendRecord {
  apiOrigin: string;
  repositoryFingerprint: string;
  /** Last known repo root for display and legacy fallback only. */
  repoRoot?: string;
  idempotencyKey: string;
  requestHash: string;
  payloadFile: string;
  displayName?: string;
  createdAt: string;
  stale?: boolean;
  staleSince?: string;
}

interface PendingSendStore {
  version: 3;
  entries: Record<string, PendingSendRecord>;
}

export interface ResolvedPendingSend {
  idempotencyKey: string;
  requestBodyBytes: string;
  requestHash: string;
  repositoryFingerprint: string;
  displayName?: string;
  stale: boolean;
  reused: true;
}

function entryKey(apiOrigin: string, repositoryFingerprint: string): string {
  return `${apiOrigin}\0${repositoryFingerprint}`;
}

function legacyEntryKey(apiOrigin: string, repoRoot: string): string {
  return `${apiOrigin}\0${repoRoot}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeRecord(record: PendingSendRecord): PendingSubmissionSummary {
  return {
    apiOrigin: record.apiOrigin,
    repositoryFingerprint: record.repositoryFingerprint,
    idempotencyKeyPrefix: record.idempotencyKey.slice(0, 12),
    displayName: record.displayName,
    createdAt: record.createdAt,
    stale: record.stale === true,
  };
}

async function ensureStateDir(stateDir: string): Promise<void> {
  await fs.mkdir(pendingPayloadsDir(stateDir), { recursive: true, mode: 0o700 });
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(stateDir, 0o700);
    await fs.chmod(pendingPayloadsDir(stateDir), 0o700);
  } catch {
    // Windows may not support chmod semantics
  }
}

async function withStoreLock<T>(stateDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = pendingSendsLockPath(stateDir);
  await ensureStateDir(stateDir);
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const fd = await fs.open(lockPath, 'wx');
      await fd.close();
      try {
        return await fn();
      } finally {
        await fs.unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await sleep(25 + Math.floor(Math.random() * 25));
    }
  }
  throw new Error('Timed out acquiring pending-send state lock');
}

function applyStaleMarkers(store: PendingSendStore, now = Date.now()): PendingSendStore {
  for (const record of Object.values(store.entries)) {
    const age = now - Date.parse(record.createdAt);
    if (Number.isFinite(age) && age > STALE_PENDING_MS) {
      record.stale = true;
      record.staleSince ??= new Date(Date.parse(record.createdAt) + STALE_PENDING_MS).toISOString();
    }
  }
  return store;
}

type RawPendingStore = {
  version?: number;
  entries?: Record<string, PendingSendRecord & { repositoryId?: string }>;
};

function migrateStore(raw: unknown): PendingSendStore {
  if (!raw || typeof raw !== 'object') {
    return { version: 3, entries: {} };
  }
  const parsed = raw as RawPendingStore;
  if (parsed.version === 3 && parsed.entries) {
    return applyStaleMarkers({ version: 3, entries: parsed.entries });
  }
  if (parsed.version === 2 && parsed.entries) {
    const entries: Record<string, PendingSendRecord> = {};
    for (const [key, record] of Object.entries(parsed.entries)) {
      entries[key] = {
        apiOrigin: record.apiOrigin,
        repositoryFingerprint: record.repositoryFingerprint ?? record.repositoryId ?? key,
        repoRoot: record.repoRoot,
        idempotencyKey: record.idempotencyKey,
        requestHash: record.requestHash,
        payloadFile: record.payloadFile,
        displayName: record.displayName,
        createdAt: record.createdAt,
        stale: record.stale,
        staleSince: record.staleSince,
      };
    }
    return applyStaleMarkers({ version: 3, entries });
  }
  return { version: 3, entries: {} };
}

async function readStore(stateDir: string): Promise<PendingSendStore> {
  const filePath = pendingSendsFilePath(stateDir);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return migrateStore(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 3, entries: {} };
    }
    throw error;
  }
}

async function writeStoreAtomic(stateDir: string, store: PendingSendStore): Promise<void> {
  const normalized = applyStaleMarkers({ version: 3, entries: store.entries });
  const filePath = pendingSendsFilePath(stateDir);
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(tmp, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // best effort
  }
}

async function writePayloadAtomic(stateDir: string, payloadFile: string, bodyBytes: string): Promise<void> {
  const fullPath = pendingPayloadPath(stateDir, payloadFile);
  const tmp = `${fullPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, bodyBytes, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, fullPath);
  try {
    await fs.chmod(fullPath, 0o600);
  } catch {
    // best effort
  }
}

async function deletePayloadFile(stateDir: string, payloadFile: string): Promise<void> {
  await fs.unlink(pendingPayloadPath(stateDir, payloadFile)).catch(() => {});
}

async function payloadByteSize(stateDir: string, payloadFile: string): Promise<number> {
  try {
    const stat = await fs.stat(pendingPayloadPath(stateDir, payloadFile));
    return stat.size;
  } catch {
    return 0;
  }
}

async function computeStorageUsage(
  stateDir: string,
  store: PendingSendStore,
): Promise<{ count: number; totalBytes: number }> {
  let totalBytes = 0;
  for (const record of Object.values(store.entries)) {
    totalBytes += await payloadByteSize(stateDir, record.payloadFile);
  }
  return { count: Object.keys(store.entries).length, totalBytes };
}

export function listPendingSummaries(store: PendingSendStore, now = Date.now()): PendingSubmissionSummary[] {
  const normalized: PendingSendStore = {
    version: 3,
    entries: Object.fromEntries(
      Object.entries(store.entries).map(([key, record]) => [key, { ...record }]),
    ),
  };
  applyStaleMarkers(normalized, now);
  return Object.values(normalized.entries).map(summarizeRecord);
}

function findRecord(
  store: PendingSendStore,
  params: { apiOrigin: string; repositoryFingerprint: string; repoRoot?: string },
): { key: string; record: PendingSendRecord } | null {
  const primaryKey = entryKey(params.apiOrigin, params.repositoryFingerprint);
  const primary = store.entries[primaryKey];
  if (primary) return { key: primaryKey, record: primary };

  if (params.repoRoot) {
    const legacyKey = legacyEntryKey(params.apiOrigin, params.repoRoot);
    const legacy = store.entries[legacyKey];
    if (legacy) return { key: legacyKey, record: legacy };

    for (const [key, record] of Object.entries(store.entries)) {
      if (record.apiOrigin === params.apiOrigin && record.repoRoot === params.repoRoot) {
        return { key, record };
      }
    }
  }

  return null;
}

function promoteRecord(
  store: PendingSendStore,
  oldKey: string,
  record: PendingSendRecord,
  repositoryFingerprint: string,
  repoRoot?: string,
): string {
  const next: PendingSendRecord = {
    ...record,
    repositoryFingerprint,
    repoRoot: repoRoot ?? record.repoRoot,
  };
  const newKey = entryKey(record.apiOrigin, repositoryFingerprint);
  store.entries[newKey] = next;
  if (oldKey !== newKey) delete store.entries[oldKey];
  return newKey;
}

async function loadPayloadVerified(stateDir: string, record: PendingSendRecord): Promise<string> {
  let bodyBytes: string;
  try {
    bodyBytes = await fs.readFile(pendingPayloadPath(stateDir, record.payloadFile), 'utf8');
  } catch {
    throw new PendingPayloadCorruptError('Pending payload file is missing');
  }
  const actualHash = hashRawBytes(bodyBytes);
  if (actualHash !== record.requestHash) {
    throw new PendingPayloadCorruptError('Pending payload hash mismatch');
  }
  return bodyBytes;
}

export async function loadPendingRetry(params: {
  apiOrigin: string;
  repositoryFingerprint: string;
  repoRoot?: string;
  stateDir?: string;
}): Promise<ResolvedPendingSend | null> {
  const stateDir = params.stateDir ?? getLatchOpsStateDir();
  return withStoreLock(stateDir, async () => {
    let store = await readStore(stateDir);
    const found = findRecord(store, params);
    if (!found) return null;

    const key = promoteRecord(
      store,
      found.key,
      found.record,
      params.repositoryFingerprint,
      params.repoRoot,
    );
    const record = store.entries[key]!;

    try {
      const requestBodyBytes = await loadPayloadVerified(stateDir, record);
      store = applyStaleMarkers(store);
      await writeStoreAtomic(stateDir, store);
      return {
        idempotencyKey: record.idempotencyKey,
        requestBodyBytes,
        requestHash: record.requestHash,
        repositoryFingerprint: record.repositoryFingerprint,
        displayName: record.displayName,
        stale: record.stale === true,
        reused: true,
      };
    } catch (error) {
      if (error instanceof PendingPayloadCorruptError) {
        await deletePayloadFile(stateDir, record.payloadFile);
        delete store.entries[key];
        await writeStoreAtomic(stateDir, store);
        return null;
      }
      throw error;
    }
  });
}

export async function createPendingSubmission(params: {
  apiOrigin: string;
  repositoryFingerprint: string;
  repoRoot?: string;
  displayName?: string;
  requestBodyBytes: string;
  explicitKey?: string;
  stateDir?: string;
}): Promise<{ idempotencyKey: string; requestHash: string; reused: boolean }> {
  const stateDir = params.stateDir ?? getLatchOpsStateDir();
  const requestHash = hashRawBytes(params.requestBodyBytes);

  return withStoreLock(stateDir, async () => {
    let store = await readStore(stateDir);
    const found = findRecord(store, {
      apiOrigin: params.apiOrigin,
      repositoryFingerprint: params.repositoryFingerprint,
      repoRoot: params.repoRoot,
    });

    if (found) {
      const key = promoteRecord(
        store,
        found.key,
        found.record,
        params.repositoryFingerprint,
        params.repoRoot,
      );
      const existing = store.entries[key]!;

      if (existing.requestHash === requestHash) {
        try {
          const existingBytes = await loadPayloadVerified(stateDir, existing);
          if (existingBytes === params.requestBodyBytes) {
            store = applyStaleMarkers(store);
            await writeStoreAtomic(stateDir, store);
            return {
              idempotencyKey: existing.idempotencyKey,
              requestHash: existing.requestHash,
              reused: true,
            };
          }
        } catch {
          await deletePayloadFile(stateDir, existing.payloadFile);
          delete store.entries[key];
        }
      } else {
        store = applyStaleMarkers(store);
        const summary = summarizeRecord(existing);
        throw new PendingSubmissionExistsError(
          'An uncertain pending submission already exists for this repository. Retry to resend the exact payload, or run with --discard-pending to capture a new incident.',
          summary,
        );
      }
    }

    const usage = await computeStorageUsage(stateDir, store);
    const nextBytes = Buffer.byteLength(params.requestBodyBytes, 'utf8');
    if (
      usage.count >= MAX_PENDING_SUBMISSIONS ||
      usage.totalBytes + nextBytes > MAX_PENDING_TOTAL_BYTES
    ) {
      store = applyStaleMarkers(store);
      throw new PendingStorageFullError(
        'Pending submission storage is full. Retry or explicitly discard an existing pending submission before creating another.',
        listPendingSummaries(store),
        { maxCount: MAX_PENDING_SUBMISSIONS, maxBytes: MAX_PENDING_TOTAL_BYTES },
      );
    }

    const resolvedKey = params.explicitKey ?? `cli-${randomUUID()}`;
    const resolvedPayloadFile = path.posix.join(
      'payloads',
      `${createHash('sha256').update(resolvedKey).digest('hex').slice(0, 16)}.json`,
    );

    await writePayloadAtomic(stateDir, resolvedPayloadFile, params.requestBodyBytes);
    const key = entryKey(params.apiOrigin, params.repositoryFingerprint);
    store.entries[key] = {
      apiOrigin: params.apiOrigin,
      repositoryFingerprint: params.repositoryFingerprint,
      repoRoot: params.repoRoot,
      idempotencyKey: resolvedKey,
      requestHash,
      payloadFile: resolvedPayloadFile,
      displayName: params.displayName,
      createdAt: new Date().toISOString(),
      stale: false,
    };
    store = applyStaleMarkers(store);
    await writeStoreAtomic(stateDir, store);

    return { idempotencyKey: resolvedKey, requestHash, reused: false };
  });
}

export async function clearPendingSubmission(
  apiOrigin: string,
  repositoryFingerprint: string,
  stateDir = getLatchOpsStateDir(),
  repoRoot?: string,
): Promise<void> {
  return withStoreLock(stateDir, async () => {
    const store = await readStore(stateDir);
    const found = findRecord(store, { apiOrigin, repositoryFingerprint, repoRoot });
    if (!found) return;
    await deletePayloadFile(stateDir, found.record.payloadFile);
    delete store.entries[found.key];
    await writeStoreAtomic(stateDir, store);
  });
}

export async function discardPendingSubmission(
  apiOrigin: string,
  repositoryFingerprint: string,
  stateDir = getLatchOpsStateDir(),
  repoRoot?: string,
): Promise<void> {
  return clearPendingSubmission(apiOrigin, repositoryFingerprint, stateDir, repoRoot);
}

export async function readPendingStoreForTest(stateDir: string): Promise<PendingSendStore> {
  return readStore(stateDir);
}

export async function writePendingStoreForTest(stateDir: string, store: PendingSendStore): Promise<void> {
  await writeStoreAtomic(stateDir, store);
}

export async function readPayloadFileForTest(stateDir: string, payloadFile: string): Promise<string> {
  return fs.readFile(pendingPayloadPath(stateDir, payloadFile), 'utf8');
}

export async function resetPendingStoreForTest(stateDir: string): Promise<void> {
  await fs.rm(stateDir, { recursive: true, force: true });
}

export { applyStaleMarkers };
