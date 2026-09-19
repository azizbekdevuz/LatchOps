import { createHash } from 'node:crypto';
import type { SnapshotV1 } from './snapshot.js';

export interface RepositoryFingerprintInput {
  remotes?: Array<{ name: string; url: string }>;
  rootCommitOid?: string | null;
}

export interface FingerprintResult {
  fingerprint: string;
  displayName: string;
  primaryRemote: string | null;
  rootCommitOid: string | null;
  missingRemote: boolean;
}

export function normalizeRemoteUrl(url: string): string {
  let normalized = url.trim();

  const scpMatch = /^([^@]+@)?([^:]+):(.+)$/.exec(normalized);
  if (scpMatch && !normalized.includes('://')) {
    const host = scpMatch[2]!.toLowerCase();
    const pathPart = scpMatch[3]!.replace(/^\/+/, '');
    normalized = `https://${host}/${pathPart}`;
  }

  try {
    const parsed = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    let pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/i, '');
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return normalized.toLowerCase().replace(/\.git$/i, '');
  }
}

export function selectPrimaryRemote(
  remotes: Array<{ name: string; url: string }>,
): { name: string; url: string } | null {
  if (remotes.length === 0) return null;
  const origin = remotes.find((r) => r.name === 'origin');
  if (origin) return origin;
  return [...remotes].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

export function computeRepositoryFingerprint(
  input: RepositoryFingerprintInput,
): FingerprintResult {
  const remotes = input.remotes ?? [];
  const primary = selectPrimaryRemote(remotes);
  const rootCommitOid = input.rootCommitOid ?? null;
  const missingRemote = !primary;

  let material: string;
  let displayName: string;
  let primaryRemote: string | null = null;

  if (primary) {
    primaryRemote = normalizeRemoteUrl(primary.url);
    material = `remote:${primaryRemote}\nroot:${rootCommitOid ?? 'none'}`;
    const segments = primaryRemote.split('/').filter(Boolean);
    displayName = segments[segments.length - 1] ?? 'repository';
  } else if (rootCommitOid) {
    material = `local:${rootCommitOid}\nroot:${rootCommitOid}`;
    displayName = `local/${rootCommitOid.slice(0, 8)}`;
  } else {
    material = 'local:unborn\nroot:none';
    displayName = 'local/unknown';
  }

  const fingerprint = createHash('sha256').update(material).digest('hex');
  return { fingerprint, displayName, primaryRemote, rootCommitOid, missingRemote };
}

/** Compute fingerprint from a captured snapshot (server / full capture path). */
export function computeFingerprint(snapshot: SnapshotV1): FingerprintResult {
  return computeRepositoryFingerprint({
    remotes: snapshot.remotes,
    rootCommitOid: snapshot.rootCommitOid,
  });
}
