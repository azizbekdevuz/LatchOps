import { createHash, timingSafeEqual } from 'node:crypto';
import { resolveClientIp } from '@/lib/client-ip';

const PROVE_WINDOW_MS = 15 * 60 * 1000;
const PROVE_LIMIT = 4;

export class DemoAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DemoAccessError';
  }
}

export function configuredDemoToken(): string | null {
  const token = process.env.HACKSPRINT_DEMO_TOKEN?.trim();
  return token || null;
}

export function demoTokenRequired(): boolean {
  return Boolean(configuredDemoToken()) || process.env.VERCEL === '1';
}

export function readPresentedAccess(request: Request): string {
  const header = request.headers.get('x-hacksprint-access')?.trim();
  if (header) return header;
  const auth = request.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

export function assertDemoAccess(presented: string): void {
  const expected = configuredDemoToken();
  if (!expected) {
    if (process.env.VERCEL === '1') {
      throw new DemoAccessError('HACKSPRINT_DEMO_TOKEN is required on Vercel Preview.', 503);
    }
    return;
  }
  if (!presented || !safeEqualUtf8(presented, expected)) {
    throw new DemoAccessError('Shared demo access token required.', 401);
  }
}

export async function assertProveRateLimit(request: Request): Promise<void> {
  const redis = redisConfig();
  if (!redis) return;

  const ip = resolveClientIp(request.headers);
  const window = Math.floor(Date.now() / PROVE_WINDOW_MS);
  const key = `hacksprint:prove:${ip}:${window}`;
  const count = await redisIncr(redis, key, Math.ceil(PROVE_WINDOW_MS / 1000));
  if (count > PROVE_LIMIT) {
    throw new DemoAccessError('Demo proof rate limit reached. Try again in a few minutes.', 429);
  }
}

function redisConfig(): { url: string; token: string } | null {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim();
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisIncr(
  redis: { url: string; token: string },
  key: string,
  expireSeconds: number,
): Promise<number> {
  const response = await fetch(`${redis.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(expireSeconds)],
    ]),
  });
  if (!response.ok) {
    throw new DemoAccessError('Demo proof rate limiter unavailable.', 503);
  }
  const payload = (await response.json()) as Array<{ result?: unknown }>;
  const result = payload[0]?.result;
  const count = typeof result === 'number' ? result : Number(result);
  if (!Number.isFinite(count)) {
    throw new DemoAccessError('Demo proof rate limiter unavailable.', 503);
  }
  return count;
}

function safeEqualUtf8(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
