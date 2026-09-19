import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAuthRateLimitKey,
  clearRateLimitState,
  extractTokenIdFromBearer,
  getFailedAuthCount,
  recordFailedAuth,
  resolveAuthRateLimitIdentity,
} from './cli-auth-rate-limit';

const TOKEN_A = 'lops_live_AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_B = 'lops_live_BBBBBBBBBBBBBBBB.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

afterEach(() => {
  clearRateLimitState();
});

describe('auth rate limit keys', () => {
  it('never includes full token in limit keys', () => {
    const identity = resolveAuthRateLimitIdentity({
      bearer: TOKEN_A,
      ip: 'unknown',
      trustProxy: false,
    });
    const key = buildAuthRateLimitKey(identity);
    expect(key).toBe('unknown:AAAAAAAAAAAAAAAA');
    expect(key).not.toContain(TOKEN_A);
    expect(key).not.toContain('.');
  });

  it('uses independent buckets per token id when proxy trust is disabled', () => {
    const keyA = buildAuthRateLimitKey(
      resolveAuthRateLimitIdentity({ bearer: TOKEN_A, ip: 'unknown', trustProxy: false }),
    );
    const keyB = buildAuthRateLimitKey(
      resolveAuthRateLimitIdentity({ bearer: TOKEN_B, ip: 'unknown', trustProxy: false }),
    );
    expect(keyA).not.toBe(keyB);

    for (let i = 0; i < 10; i++) recordFailedAuth(keyA);
    expect(recordFailedAuth(keyA)).toBe(true);
    expect(getFailedAuthCount(keyB)).toBe(0);
  });

  it('uses trusted-ip composite keys when proxy trust is enabled', () => {
    const key = buildAuthRateLimitKey(
      resolveAuthRateLimitIdentity({
        bearer: TOKEN_A,
        ip: '203.0.113.10',
        trustProxy: true,
      }),
    );
    expect(key).toBe('trusted-ip:203.0.113.10:AAAAAAAAAAAAAAAA');
  });

  it('bounds malformed tokens in a coarse global bucket', () => {
    const key = buildAuthRateLimitKey(
      resolveAuthRateLimitIdentity({ bearer: 'not-a-valid-token', ip: 'unknown', trustProxy: false }),
    );
    expect(key).toBe('malformed-token:global');

    for (let i = 0; i < 10; i++) recordFailedAuth(key);
    expect(recordFailedAuth(key)).toBe(true);

    const validKey = buildAuthRateLimitKey(
      resolveAuthRateLimitIdentity({ bearer: TOKEN_B, ip: 'unknown', trustProxy: false }),
    );
    expect(getFailedAuthCount(validKey)).toBe(0);
  });

  it('extracts token id only from valid bearer format', () => {
    expect(extractTokenIdFromBearer(TOKEN_A)).toBe('AAAAAAAAAAAAAAAA');
    expect(extractTokenIdFromBearer('lops_live_short.bad')).toBeNull();
    expect(extractTokenIdFromBearer(null)).toBeNull();
  });
});
