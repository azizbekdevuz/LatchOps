import { describe, expect, it } from 'vitest';
import { BodyTooLargeError, readBoundedBody, parseBoundedJson } from './bounded-body';

const MAX = 1024;

function requestWithBody(
  body: string | Uint8Array,
  headers: Record<string, string> = {},
): Request {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: bytes,
    duplex: 'half',
  } as RequestInit);
}

describe('readBoundedBody', () => {
  it('accepts body just below limit', async () => {
    const payload = 'a'.repeat(MAX - 10);
    const { raw, bytes } = await readBoundedBody(requestWithBody(payload), MAX);
    expect(bytes).toBe(payload.length);
    expect(raw).toBe(payload);
  });

  it('accepts body exactly at limit', async () => {
    const payload = 'b'.repeat(MAX);
    const { bytes } = await readBoundedBody(requestWithBody(payload), MAX);
    expect(bytes).toBe(MAX);
  });

  it('rejects body above limit', async () => {
    const payload = 'c'.repeat(MAX + 1);
    await expect(readBoundedBody(requestWithBody(payload), MAX)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it('rejects false small Content-Length with larger streamed body', async () => {
    const payload = 'd'.repeat(MAX + 50);
    await expect(
      readBoundedBody(requestWithBody(payload, { 'content-length': '10' }), MAX),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('rejects oversized Content-Length before reading body', async () => {
    await expect(
      readBoundedBody(requestWithBody('{}', { 'content-length': String(MAX + 1) }), MAX),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('handles missing Content-Length', async () => {
    const { raw } = await readBoundedBody(requestWithBody('{"ok":true}'), MAX);
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });

  it('parseBoundedJson rejects malformed JSON within limit', () => {
    expect(() => parseBoundedJson('{not json')).toThrow();
  });
});
