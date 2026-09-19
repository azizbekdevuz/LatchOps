import { describe, expect, it } from 'vitest';
import { canSubmitVerification, canTransition, nextStatus } from './lifecycle';

describe('lifecycle', () => {
  it('auto-transitions detected to plan_ready on plan_persisted', () => {
    expect(nextStatus('detected', 'plan_persisted')).toBe('plan_ready');
  });

  it('allows verification from plan_ready', () => {
    expect(canTransition('plan_ready', 'submit_verification', 'member')).toBe(true);
    expect(nextStatus('plan_ready', 'submit_verification')).toBe('verification_pending');
  });

  it('allows verification from recovery_in_progress', () => {
    expect(canTransition('recovery_in_progress', 'submit_verification', 'member')).toBe(true);
  });

  it('allows repeated verification from verification_pending', () => {
    expect(canTransition('verification_pending', 'submit_verification', 'member')).toBe(true);
    expect(nextStatus('verification_pending', 'submit_verification')).toBe('verification_pending');
  });

  it('rejects verification from detected', () => {
    expect(canSubmitVerification('detected')).toBe(false);
    expect(canTransition('detected', 'submit_verification', 'member')).toBe(false);
  });

  it('rejects verification from triaged', () => {
    expect(canSubmitVerification('triaged')).toBe(false);
  });

  it('rejects verification from terminal states', () => {
    expect(canSubmitVerification('resolved')).toBe(false);
    expect(canSubmitVerification('dismissed')).toBe(false);
  });

  it('requires admin to reopen terminal incidents', () => {
    expect(canTransition('resolved', 'reopen', 'member')).toBe(false);
    expect(canTransition('resolved', 'reopen', 'admin')).toBe(true);
    expect(nextStatus('resolved', 'reopen')).toBe('triaged');
  });

  it('rejects invalid transition resolved to detected', () => {
    expect(nextStatus('resolved', 'plan_persisted')).toBeNull();
  });
});
