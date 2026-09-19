export type SendOutcome = 'success' | 'uncertain' | 'clear_pending';

/**
 * Decide whether to clear the pending-send record after an HTTP response.
 * Uncertain outcomes retain the idempotency key for safe client retries.
 */
export function classifySendHttpStatus(status: number): SendOutcome {
  if (status === 200 || status === 201) return 'success';
  if (status === 400 || status === 401 || status === 403 || status === 413) return 'clear_pending';
  if (status === 409) return 'clear_pending';
  // 408, 429, 5xx, etc. — retain pending for retry
  return 'uncertain';
}

export function isNetworkUncertainty(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket') ||
    msg.includes('aborted')
  );
}
