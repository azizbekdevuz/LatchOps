import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDemoAccess, assertProveRateLimit, DemoAccessError } from './access';

afterEach(() => {
  delete process.env.HACKSPRINT_DEMO_TOKEN;
  delete process.env.VERCEL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.LATCHOPS_TRUST_PROXY;
  vi.unstubAllGlobals();
});

describe('assertDemoAccess', () => {
  it('allows local requests when no demo token is configured', () => {
    expect(() => assertDemoAccess('')).not.toThrow();
  });

  it('rejects a missing token on Vercel', () => {
    process.env.VERCEL = '1';
    expect(() => assertDemoAccess('')).toThrow(DemoAccessError);
  });

  it('accepts the shared demo token and rejects a wrong one', () => {
    process.env.HACKSPRINT_DEMO_TOKEN = 'judge-link';
    expect(() => assertDemoAccess('judge-link')).not.toThrow();
    expect(() => assertDemoAccess('nope')).toThrow(/Shared demo access token/);
  });
});

describe('assertProveRateLimit', () => {
  it('is a no-op without a durable Redis/KV endpoint', async () => {
    await expect(assertProveRateLimit(new Request('http://localhost/prove'))).resolves.toBeUndefined();
  });

  it('rejects after the durable window is exceeded', async () => {
    process.env.KV_REST_API_URL = 'https://kv.example';
    process.env.KV_REST_API_TOKEN = 'kv-token';
    process.env.LATCHOPS_TRUST_PROXY = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify([{ result: 5 }, { result: 1 }]), { status: 200 })),
    );
    await expect(
      assertProveRateLimit(
        new Request('http://localhost/prove', { headers: { 'x-forwarded-for': '203.0.113.9' } }),
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});
