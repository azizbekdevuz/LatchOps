/**
 * Resolve client IP for rate limiting and audit.
 *
 * Trust model: forwarded headers are honored only when LATCHOPS_TRUST_PROXY=true,
 * indicating the app sits behind configured trusted reverse proxy infrastructure.
 * Direct client connections must not be able to spoof X-Forwarded-For.
 */
export function resolveClientIp(
  headers: Headers,
  options?: { trustProxy?: boolean },
): string {
  const trustProxy = options?.trustProxy ?? process.env.LATCHOPS_TRUST_PROXY === 'true';
  if (trustProxy) {
    const forwardedFor = headers.get('x-forwarded-for');
    if (forwardedFor) {
      const first = forwardedFor.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
  }
  return 'unknown';
}
