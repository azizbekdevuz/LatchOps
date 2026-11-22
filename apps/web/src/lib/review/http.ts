import { NextResponse } from 'next/server';
import { BodyTooLargeError, InvalidJsonBodyError, parseBoundedJson, readBoundedBody } from '@/lib/http/bounded-body';
import { actorFromToken } from './actors';
import { ReviewError } from './service';
import type { ReviewActor } from './types';

export const ACTOR_HEADER = 'x-review-actor';
const MAX_BODY = 2 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Recovery Review is local-only unless explicitly opened up. */
export function assertLocal(request: Request): void {
  if (process.env.REVIEW_ALLOW_REMOTE === 'true') return;
  const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) throw new ReviewError('Recovery Review accepts only local requests', 403);
}

export function actorOf(request: Request): ReviewActor | null {
  return actorFromToken(request.headers.get(ACTOR_HEADER));
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const { raw } = await readBoundedBody(request, MAX_BODY);
  if (!raw.trim()) return {};
  const parsed = parseBoundedJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ReviewError('Body must be a JSON object', 400);
  return parsed as Record<string, unknown>;
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof BodyTooLargeError || error instanceof InvalidJsonBodyError) {
    return NextResponse.json({ error: error.message }, { status: error instanceof BodyTooLargeError ? 413 : 400 });
  }
  console.error('[review]', error);
  return NextResponse.json({ error: 'Internal error' }, { status: 500 });
}

export async function handle(request: Request, fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    assertLocal(request);
    return NextResponse.json(await fn());
  } catch (error) {
    return errorResponse(error);
  }
}
