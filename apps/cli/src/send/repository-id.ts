import { createHash } from 'node:crypto';
import type { SnapshotV1 } from '@latchops/schema';

/**
 * Safe repository identifier for pending-send metadata (not used to derive idempotency keys).
 */
export function repositorySendId(snapshot: SnapshotV1): string {
  const remotes = (snapshot.remotes ?? [])
    .map((r) => `${r.name}:${r.url}`)
    .sort()
    .join('|');
  const material = [snapshot.repoRoot, remotes, snapshot.rootCommitOid ?? ''].join('\0');
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}
