import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { recordAuthoritative } from './audit-service';
import { DomainError } from './errors';
import { assertOrgWritable } from './organization-service';
import { getTokenPepper } from './token-pepper';

export const TOKEN_PREFIX = 'lops_live_';
export const TOKEN_ID_BYTES = 12;
export const SECRET_BYTES = 32;
export const TOKEN_RE = /^lops_live_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

/** Fixed sentinel for constant-time compare when tokenId is unknown. */
export const DUMMY_TOKEN_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

export interface CliAuthContext {
  organizationId: string;
  credentialId: string;
  scopes: string[];
}

export function hmacToken(plaintext: string): string {
  return createHmac('sha256', getTokenPepper()).update(plaintext).digest('hex');
}

export function generateToken(): { plaintext: string; tokenId: string; hash: string } {
  const tokenId = randomBytes(TOKEN_ID_BYTES).toString('base64url');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const plaintext = `${TOKEN_PREFIX}${tokenId}.${secret}`;
  return { plaintext, tokenId, hash: hmacToken(plaintext) };
}

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export function isValidTokenFormat(token: string): boolean {
  return TOKEN_RE.test(token);
}

const lastUsedDebounce = new Map<string, number>();
const DEBOUNCE_MS = 60_000;

export async function touchLastUsedDebounced(credentialId: string): Promise<void> {
  const now = Date.now();
  const last = lastUsedDebounce.get(credentialId) ?? 0;
  if (now - last < DEBOUNCE_MS) return;
  lastUsedDebounce.set(credentialId, now);
  try {
    await prisma.cliCredential.update({
      where: { id: credentialId },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    // telemetry — best effort
  }
}

export async function verifyCliToken(bearer: string): Promise<CliAuthContext | null> {
  const match = TOKEN_RE.exec(bearer);
  if (!match) return null;
  const tokenId = match[1]!;

  const cred = await prisma.cliCredential.findUnique({ where: { tokenId } });
  const active =
    cred && !cred.revokedAt && (!cred.expiresAt || cred.expiresAt > new Date());

  const presented = hmacToken(bearer);
  const stored = active ? cred!.tokenHash : DUMMY_TOKEN_HASH;

  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  if (!active) return null;

  void touchLastUsedDebounced(cred!.id);

  return {
    organizationId: cred!.organizationId,
    credentialId: cred!.id,
    scopes: cred!.scopes,
  };
}

export function requireScope(ctx: CliAuthContext, scope: string): void {
  if (!ctx.scopes.includes(scope)) {
    throw new DomainError('FORBIDDEN', `Missing required scope: ${scope}`, 403);
  }
}

export async function createCliCredential(params: {
  organizationId: string;
  createdById: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  await assertOrgWritable(params.organizationId);
  const { plaintext, tokenId, hash } = generateToken();

  return prisma.$transaction(async (tx) => {
    const record = await tx.cliCredential.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.createdById,
        name: params.name,
        tokenId,
        tokenHash: hash,
        scopes: params.scopes ?? ['ingest:write'],
        expiresAt: params.expiresAt ?? null,
      },
    });

    await recordAuthoritative(tx, {
      organizationId: params.organizationId,
      actorUserId: params.createdById,
      actorType: 'user',
      action: 'cli_credential.created',
      payload: { credentialId: record.id, name: record.name, tokenId: record.tokenId },
    });

    return { record, token: plaintext };
  });
}

export async function listCliCredentials(organizationId: string) {
  return prisma.cliCredential.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tokenId: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
}

export async function revokeCliCredential(params: {
  organizationId: string;
  credentialId: string;
  actorUserId: string;
}) {
  await assertOrgWritable(params.organizationId);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.cliCredential.findFirst({
      where: { id: params.credentialId, organizationId: params.organizationId },
    });
    if (!existing) throw new DomainError('NOT_FOUND', 'Credential not found', 404);
    if (existing.revokedAt) return existing;

    const updated = await tx.cliCredential.update({
      where: { id: params.credentialId },
      data: { revokedAt: new Date() },
    });

    await recordAuthoritative(tx, {
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      actorType: 'user',
      action: 'cli_credential.revoked',
      payload: { credentialId: updated.id, tokenId: updated.tokenId },
    });

    return updated;
  });
}

export type CliCredentialTx = Prisma.TransactionClient;
