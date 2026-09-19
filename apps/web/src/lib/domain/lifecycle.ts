import {
  type IncidentStatus,
  type LifecycleAction,
  TERMINAL_STATUSES,
  VERIFICATION_SOURCE_STATUSES,
} from '@latchops/schema';
import type { MembershipRole } from '@latchops/schema';

export type TransitionAction = LifecycleAction | 'plan_persisted' | 'plan_incomplete' | 'verification_succeeded' | 'verification_failed';

const LIFECYCLE_TRANSITIONS: Record<IncidentStatus, Partial<Record<TransitionAction, IncidentStatus>>> = {
  detected: {
    plan_persisted: 'plan_ready',
    plan_incomplete: 'detected',
    acknowledge: 'triaged',
    dismiss: 'dismissed',
  },
  triaged: {
    start_recovery: 'recovery_in_progress',
    dismiss: 'dismissed',
  },
  plan_ready: {
    start_recovery: 'recovery_in_progress',
    submit_verification: 'verification_pending',
    dismiss: 'dismissed',
  },
  recovery_in_progress: {
    submit_verification: 'verification_pending',
    dismiss: 'dismissed',
  },
  verification_pending: {
    submit_verification: 'verification_pending',
    verification_succeeded: 'resolved',
    verification_failed: 'recovery_in_progress',
    dismiss: 'dismissed',
  },
  resolved: {
    reopen: 'triaged',
  },
  dismissed: {
    reopen: 'triaged',
  },
};

const ACTION_MIN_ROLE: Partial<Record<TransitionAction, MembershipRole>> = {
  acknowledge: 'member',
  start_recovery: 'member',
  dismiss: 'member',
  submit_verification: 'member',
  reopen: 'admin',
};

export function nextStatus(from: IncidentStatus, action: TransitionAction): IncidentStatus | null {
  return LIFECYCLE_TRANSITIONS[from][action] ?? null;
}

export function canTransition(
  from: IncidentStatus,
  action: TransitionAction,
  role: MembershipRole,
): boolean {
  const required = ACTION_MIN_ROLE[action];
  if (required && !roleMeetsMin(role, required)) return false;
  if (action === 'reopen' && !TERMINAL_STATUSES.has(from)) return false;
  if (action === 'submit_verification' && !VERIFICATION_SOURCE_STATUSES.has(from)) return false;
  return nextStatus(from, action) !== null;
}

export function canSubmitVerification(status: IncidentStatus): boolean {
  return VERIFICATION_SOURCE_STATUSES.has(status);
}

function roleMeetsMin(actual: MembershipRole, required: MembershipRole): boolean {
  const rank: Record<MembershipRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };
  return rank[actual] >= rank[required];
}
