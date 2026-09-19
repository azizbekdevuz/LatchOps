import { spawn } from 'node:child_process';
import { computeRepositoryFingerprint } from '@latchops/schema';
import {
  captureSnapshot,
  collectRepositoryIdentity,
  GitNotInstalledError,
  NotARepositoryError,
} from '@latchops/state-engine';
import {
  clearPendingSubmission,
  createPendingSubmission,
  discardPendingSubmission,
  loadPendingRetry,
  PendingStorageFullError,
  PendingSubmissionExistsError,
} from '../send/pending-send.js';
import { hashRawBytes, normalizeApiOrigin } from '../send/request-hash.js';
import {
  classifySendHttpStatus,
  isNetworkUncertainty,
} from '../send/response-policy.js';

const DEFAULT_API_URL = 'http://localhost:3000';
const TOKEN_RE = /^lops_live_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/;

/** Exit code for missing/invalid API token (send command only). */
export const SEND_EXIT_MISSING_TOKEN = 2;

export interface SendOptions {
  apiUrl?: string;
  open?: boolean;
  token?: string;
  idempotencyKey?: string;
  discardPending?: boolean;
}

export interface IngestResponse {
  incidentId: string;
  url: string;
  analysis: {
    incidentType: string;
    summary: string;
    risk?: string;
  };
  idempotency?: { key: string; replayed: boolean };
  legacySessionId?: string;
}

export function resolveApiToken(explicit?: string): string | null {
  const token = explicit ?? process.env.LATCHOPS_API_TOKEN ?? null;
  if (!token) return null;
  return token.trim();
}

export function validateTokenFormat(token: string): boolean {
  return TOKEN_RE.test(token);
}

function printPendingSummaries(
  requestId: string,
  existing: Array<{
    apiOrigin: string;
    repositoryFingerprint: string;
    idempotencyKeyPrefix: string;
    displayName?: string;
    createdAt: string;
    stale: boolean;
  }>,
): void {
  console.error(`[CLI:SEND:${requestId}] Pending submissions on disk:`);
  for (const item of existing) {
    console.error(
      `  - ${item.displayName ?? 'repository'} @ ${item.apiOrigin} key=${item.idempotencyKeyPrefix}… created=${item.createdAt}${item.stale ? ' (stale)' : ''}`,
    );
    console.error(`    fingerprint=${item.repositoryFingerprint.slice(0, 12)}…`);
  }
}

export async function sendCommand(options: SendOptions): Promise<void> {
  const apiUrl = options.apiUrl || process.env.LATCHOPS_API_URL || DEFAULT_API_URL;
  const apiOrigin = normalizeApiOrigin(apiUrl);
  const requestId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const token = resolveApiToken(options.token);
  if (!token) {
    console.error('LATCHOPS_API_TOKEN is required.');
    console.error('Create a token in the dashboard (Organization → CLI credentials) or set:');
    console.error('  export LATCHOPS_API_TOKEN=lops_live_<tokenId>.<secret>');
    process.exit(SEND_EXIT_MISSING_TOKEN);
  }
  if (!validateTokenFormat(token)) {
    console.error('LATCHOPS_API_TOKEN format is invalid.');
    console.error('Expected: lops_live_<16-char-id>.<43-char-secret>');
    process.exit(SEND_EXIT_MISSING_TOKEN);
  }

  console.error(`[CLI:SEND:${requestId}] ========================================`);
  console.error(`[CLI:SEND:${requestId}] Starting LatchOps repository diagnostic capture`);
  console.error(`[CLI:SEND:${requestId}] API URL: ${apiUrl}`);
  console.error(`[CLI:SEND:${requestId}] Timestamp: ${new Date().toISOString()}`);

  try {
    const identity = await collectRepositoryIdentity();
    const repoRoot = identity.repoRoot;
    const repositoryFingerprint = computeRepositoryFingerprint({
      remotes: identity.remotes,
      rootCommitOid: identity.rootCommitOid,
    });

    if (options.discardPending) {
      await discardPendingSubmission(apiOrigin, repositoryFingerprint.fingerprint, undefined, repoRoot);
      console.error(`[CLI:SEND:${requestId}] Discarded pending submission for this repository`);
    }

    let requestBodyBytes: string;
    let idempotencyKey: string;
    let requestHash: string;
    let reusedPending = false;

    const pending = options.discardPending
      ? null
      : await loadPendingRetry({
          apiOrigin,
          repositoryFingerprint: repositoryFingerprint.fingerprint,
          repoRoot,
        });

    if (pending) {
      requestBodyBytes = pending.requestBodyBytes;
      idempotencyKey = pending.idempotencyKey;
      requestHash = pending.requestHash;
      reusedPending = true;
      console.error(`[CLI:SEND:${requestId}] Retrying pending submission (exact original payload)`);
      console.error(
        `[CLI:SEND:${requestId}]    Repository: ${pending.displayName ?? repositoryFingerprint.displayName}`,
      );
      if (pending.stale) {
        console.error(
          `[CLI:SEND:${requestId}]    Pending submission is stale (>7 days) but will be retried exactly.`,
        );
        console.error(
          `[CLI:SEND:${requestId}]    Use --discard-pending to capture a new incident instead.`,
        );
      }
    } else {
      console.error(`[CLI:SEND:${requestId}] Capturing repository state via state-engine...`);
      const snapshot = await captureSnapshot();
      console.error(`[CLI:SEND:${requestId}] Snapshot captured and validated`);
      console.error(`[CLI:SEND:${requestId}]    Repository: ${repositoryFingerprint.displayName}`);
      console.error(`[CLI:SEND:${requestId}]    Branch: ${snapshot.branch.head}`);

      requestBodyBytes = JSON.stringify({ snapshot });
      requestHash = hashRawBytes(requestBodyBytes);

      try {
        const created = await createPendingSubmission({
          apiOrigin,
          repositoryFingerprint: repositoryFingerprint.fingerprint,
          repoRoot,
          displayName: repositoryFingerprint.displayName,
          requestBodyBytes,
          explicitKey: options.idempotencyKey,
        });
        idempotencyKey = created.idempotencyKey;
      } catch (error) {
        if (error instanceof PendingSubmissionExistsError) {
          console.error(`[CLI:SEND:${requestId}] ${error.message}`);
          printPendingSummaries(requestId, [error.summary]);
          throw error;
        }
        if (error instanceof PendingStorageFullError) {
          console.error(`[CLI:SEND:${requestId}] ${error.message}`);
          printPendingSummaries(requestId, error.existing);
          throw error;
        }
        throw error;
      }
    }

    const endpoint = `${apiUrl}/api/v1/cli/incidents/ingest`;
    console.error(`[CLI:SEND:${requestId}] Uploading snapshot to LatchOps API...`);
    console.error(`[CLI:SEND:${requestId}]    Endpoint: ${endpoint}`);
    console.error(
      `[CLI:SEND:${requestId}]    Idempotency-Key: ${idempotencyKey}${reusedPending ? ' (reused pending)' : ''}`,
    );
    console.error(`[CLI:SEND:${requestId}]    Request hash: ${requestHash}`);

    const uploadStart = Date.now();
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': idempotencyKey,
          'X-LatchOps-CLI-Version': '1.0.0',
        },
        body: requestBodyBytes,
      });
    } catch (error) {
      if (isNetworkUncertainty(error)) {
        console.error(
          `[CLI:SEND:${requestId}] Upload uncertain (connection error); pending payload retained`,
        );
      }
      throw error;
    }

    const uploadDuration = Date.now() - uploadStart;
    console.error(`[CLI:SEND:${requestId}]    Upload duration: ${uploadDuration}ms`);
    console.error(`[CLI:SEND:${requestId}]    Response status: ${response.status}`);

    const outcome = classifySendHttpStatus(response.status);

    if (response.status === 401 || response.status === 403) {
      await clearPendingSubmission(apiOrigin, repositoryFingerprint.fingerprint, undefined, repoRoot);
      console.error(`[CLI:SEND:${requestId}] Authentication failed (${response.status})`);
      console.error('Check that LATCHOPS_API_TOKEN is valid and not revoked.');
      process.exit(SEND_EXIT_MISSING_TOKEN);
    }

    if (!response.ok) {
      let errorMessage = `Server returned ${response.status}`;
      try {
        const errorData = (await response.json()) as { error?: { message?: string } | string };
        if (typeof errorData.error === 'string') {
          errorMessage = errorData.error;
        } else if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Ignore JSON parse errors
      }
      if (outcome === 'clear_pending') {
        await clearPendingSubmission(apiOrigin, repositoryFingerprint.fingerprint, undefined, repoRoot);
      } else {
        console.error(
          `[CLI:SEND:${requestId}] Upload uncertain; pending payload retained for retry`,
        );
      }
      console.error(`[CLI:SEND:${requestId}] Upload failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    const result = (await response.json()) as IngestResponse;
    await clearPendingSubmission(apiOrigin, repositoryFingerprint.fingerprint, undefined, repoRoot);

    const replayed = result.idempotency?.replayed ?? false;
    console.error(`[CLI:SEND:${requestId}] Upload successful${replayed ? ' (idempotent replay)' : ''}`);
    console.error(`[CLI:SEND:${requestId}]    Incident ID: ${result.incidentId}`);

    console.log('');
    console.log('='.repeat(60));
    console.log('');
    console.log(`  Incident Type: ${result.analysis.incidentType.replace(/_/g, ' ').toUpperCase()}`);
    console.log(`  Summary: ${result.analysis.summary}`);
    console.log('');
    console.log(`  Incident Room: ${result.url}`);
    console.log('');
    console.log('='.repeat(60));
    console.log('');

    if (options.open) {
      openInBrowser(result.url, requestId);
    }

    console.error(`[CLI:SEND:${requestId}] Command completed successfully`);
    console.error(`[CLI:SEND:${requestId}] ========================================`);
  } catch (error) {
    console.error(`[CLI:SEND:${requestId}] Command failed`);
    if (error instanceof NotARepositoryError) {
      console.error(`[CLI:SEND:${requestId}]    ${error.message}`);
      console.error('Please run this command from within a git repository.');
    } else if (error instanceof GitNotInstalledError) {
      console.error(`[CLI:SEND:${requestId}]    ${error.message}`);
    } else if (error instanceof PendingSubmissionExistsError || error instanceof PendingStorageFullError) {
      console.error(`[CLI:SEND:${requestId}]    ${error.message}`);
      console.error('Retry the exact pending submission, or run with --discard-pending.');
    } else if (error instanceof Error) {
      console.error(`[CLI:SEND:${requestId}]    Error: ${error.message}`);
      if (error.message.includes('fetch')) {
        console.error(`Could not connect to ${apiUrl}. Is the server running?`);
      }
    }
    console.error(`[CLI:SEND:${requestId}] ========================================`);
    process.exit(1);
  }
}

function openInBrowser(url: string, requestId: string): void {
  try {
    let command: string;
    let args: string[];
    switch (process.platform) {
      case 'darwin':
        command = 'open';
        args = [url];
        break;
      case 'win32':
        command = 'cmd';
        args = ['/c', 'start', '', url];
        break;
      default:
        command = 'xdg-open';
        args = [url];
        break;
    }
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    console.error(`[CLI:SEND:${requestId}] Opening incident room in browser...`);
  } catch {
    // best-effort
  }
}
