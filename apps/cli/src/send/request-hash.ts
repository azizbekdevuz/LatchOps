import { createHash } from 'node:crypto';

/** SHA-256 over exact serialized request bytes (must match server `hashRequestBody` on same bytes). */
export function hashRawBytes(bodyBytes: string | Buffer): string {
  return createHash('sha256').update(bodyBytes).digest('hex');
}

/** Canonical request-body hash from a parsed object (for tests / server parity). */
export function hashRequestBody(body: unknown): string {
  return hashRawBytes(JSON.stringify(body));
}

export function normalizeApiOrigin(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  return parsed.origin;
}
