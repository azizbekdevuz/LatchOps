import { describe, expect, it } from 'vitest';
import { classifySendHttpStatus } from './response-policy.js';

describe('classifySendHttpStatus', () => {
  it('clears pending on success', () => {
    expect(classifySendHttpStatus(201)).toBe('success');
    expect(classifySendHttpStatus(200)).toBe('success');
  });

  it('retains pending on timeout-like statuses', () => {
    expect(classifySendHttpStatus(408)).toBe('uncertain');
    expect(classifySendHttpStatus(502)).toBe('uncertain');
    expect(classifySendHttpStatus(503)).toBe('uncertain');
  });

  it('clears pending on non-retryable 400/401/413', () => {
    expect(classifySendHttpStatus(400)).toBe('clear_pending');
    expect(classifySendHttpStatus(401)).toBe('clear_pending');
    expect(classifySendHttpStatus(413)).toBe('clear_pending');
  });
});
