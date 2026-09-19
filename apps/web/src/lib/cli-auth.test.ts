import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveClientIp } from './client-ip';

describe('resolveClientIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not trust X-Forwarded-For by default', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.50' });
    expect(resolveClientIp(headers)).toBe('unknown');
  });

  it('uses X-Forwarded-For first hop when LATCHOPS_TRUST_PROXY=true', () => {
    vi.stubEnv('LATCHOPS_TRUST_PROXY', 'true');
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.50, 10.0.0.1' });
    expect(resolveClientIp(headers)).toBe('203.0.113.50');
  });

  it('falls back to X-Real-IP when trusted', () => {
    vi.stubEnv('LATCHOPS_TRUST_PROXY', 'true');
    const headers = new Headers({ 'x-real-ip': '198.51.100.10' });
    expect(resolveClientIp(headers)).toBe('198.51.100.10');
  });
});

describe('allowAnonymousLegacyIngest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects anonymous in production even when flag is true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LATCHOPS_ALLOW_ANONYMOUS_INGEST', 'true');
    vi.resetModules();
    const { allowAnonymousLegacyIngest } = await import('./cli-auth');
    expect(allowAnonymousLegacyIngest()).toBe(false);
  });

  it('allows anonymous in development only when flag is true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LATCHOPS_ALLOW_ANONYMOUS_INGEST', 'true');
    vi.resetModules();
    const { allowAnonymousLegacyIngest } = await import('./cli-auth');
    expect(allowAnonymousLegacyIngest()).toBe(true);
  });

  it('denies anonymous in development without flag', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LATCHOPS_ALLOW_ANONYMOUS_INGEST', 'false');
    vi.resetModules();
    const { allowAnonymousLegacyIngest } = await import('./cli-auth');
    expect(allowAnonymousLegacyIngest()).toBe(false);
  });
});
