import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DUMMY_TOKEN_HASH,
  TOKEN_PREFIX,
  TOKEN_RE,
  generateToken,
  hmacToken,
  isValidTokenFormat,
  parseBearerToken,
} from './cli-credential-service';

describe('cli-credential-service (token format)', () => {
  it('generates tokens matching the canonical format', () => {
    const { plaintext, tokenId, hash } = generateToken();
    expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(TOKEN_RE.test(plaintext)).toBe(true);
    expect(tokenId).toHaveLength(16);
    expect(plaintext.split('.')[1]).toHaveLength(43);
    expect(hash).toHaveLength(64);
    expect(hmacToken(plaintext)).toBe(hash);
  });

  it('rejects malformed token lengths', () => {
    expect(isValidTokenFormat(`${TOKEN_PREFIX}short.tooshort`)).toBe(false);
    expect(isValidTokenFormat('bearer-not-valid')).toBe(false);
    expect(isValidTokenFormat('')).toBe(false);
  });

  it('parses Bearer header', () => {
    const { plaintext } = generateToken();
    expect(parseBearerToken(`Bearer ${plaintext}`)).toBe(plaintext);
    expect(parseBearerToken('Basic abc')).toBeNull();
    expect(parseBearerToken(null)).toBeNull();
  });

  it('uses dummy hash sentinel of correct length', () => {
    expect(DUMMY_TOKEN_HASH).toHaveLength(64);
  });
});

describe('token pepper production guard', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it('fails closed in production without LATCHOPS_TOKEN_PEPPER', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LATCHOPS_TOKEN_PEPPER', '');
    const { getTokenPepper } = await import('./token-pepper');
    expect(() => getTokenPepper()).toThrow(/LATCHOPS_TOKEN_PEPPER/);
    vi.unstubAllEnvs();
  });

  it('allows dev fallback when pepper unset', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LATCHOPS_TOKEN_PEPPER', '');
    vi.stubEnv('NEXTAUTH_SECRET', '');
    const { getTokenPepper } = await import('./token-pepper');
    expect(getTokenPepper()).toBeTruthy();
    vi.unstubAllEnvs();
  });
});

describe('cli auth rate limit', () => {
  it('blocks after 10 failures in window for a single limit key', async () => {
    const { recordFailedAuth, clearRateLimitState } = await import('./cli-auth-rate-limit');
    clearRateLimitState();
    const key = 'unknown:AAAAAAAAAAAAAAAA';
    for (let i = 0; i < 10; i++) {
      expect(recordFailedAuth(key)).toBe(false);
    }
    expect(recordFailedAuth(key)).toBe(true);
    clearRateLimitState();
  });
});

describe('idempotency hash', () => {
  it('produces stable hashes for identical bodies', async () => {
    const { hashRequestBody } = await import('./idempotency-service');
    const body = { snapshot: { version: 1, foo: 'bar' } };
    expect(hashRequestBody(body)).toBe(hashRequestBody(body));
    expect(hashRequestBody({ snapshot: { version: 1, foo: 'baz' } })).not.toBe(hashRequestBody(body));
  });
});
