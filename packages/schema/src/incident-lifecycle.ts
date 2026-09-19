import { z } from 'zod';

export const IncidentStatusSchema = z.enum([
  'detected',
  'triaged',
  'plan_ready',
  'recovery_in_progress',
  'verification_pending',
  'resolved',
  'dismissed',
]);

export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const LifecycleActionSchema = z.enum([
  'acknowledge',
  'start_recovery',
  'dismiss',
  'reopen',
  'submit_verification',
]);

export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

export const TERMINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set(['resolved', 'dismissed']);

export const VERIFICATION_SOURCE_STATUSES: ReadonlySet<IncidentStatus> = new Set([
  'plan_ready',
  'recovery_in_progress',
  'verification_pending',
]);
