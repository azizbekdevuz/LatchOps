import { DomainError } from '@/lib/domain/errors';

export class BodyTooLargeError extends DomainError {
  constructor() {
    super('PAYLOAD_TOO_LARGE', 'Request body exceeds 5 MB limit', 413);
  }
}

export class InvalidJsonBodyError extends DomainError {
  constructor() {
    super('INVALID_JSON', 'Request body is not valid JSON', 400);
  }
}

/**
 * Read the request body with a hard byte cap before JSON parsing.
 * Rejects oversized Content-Length without reading the stream.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<{ raw: string; bytes: number }> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader !== null && contentLengthHeader !== '') {
    const declared = Number(contentLengthHeader);
    if (!Number.isFinite(declared) || declared < 0) {
      throw new DomainError('BAD_REQUEST', 'Invalid Content-Length header', 400);
    }
    if (declared > maxBytes) {
      throw new BodyTooLargeError();
    }
  }

  if (!request.body) {
    return { raw: '', bytes: 0 };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error;
    throw error;
  }

  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { raw: buffer.toString('utf8'), bytes: total };
}

export function parseBoundedJson<T = unknown>(raw: string): T {
  if (!raw.trim()) {
    throw new InvalidJsonBodyError();
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
