import type { RecoveryCommandV1, RecoveryPlanV1 } from '@latchops/schema';
import { isExecutablePlanCommand } from '@/lib/isolation/commands';
import { planFingerprint } from './evidence';
import { REVIEW_INCIDENT_TYPE, type ActorRole, type ReviewActor } from './types';

export const APPROVAL_TTL_MS = 30 * 60 * 1000;

/** Never runnable, regardless of plan contents or approval. */
const DENY_SUBCOMMANDS = new Set([
  'push', 'pull', 'fetch', 'remote', 'clone', 'clean', 'gc', 'prune', 'filter-branch', 'update-ref',
  'config', 'submodule', 'worktree', 'rebase', 'cherry-pick', 'revert', 'stash', 'checkout', 'switch', 'restore',
]);

export function isDeniedCommand(cmd: RecoveryCommandV1): string | null {
  if (cmd.executable !== 'git') return `executable "${cmd.executable}" is not git`;
  const [sub, ...rest] = cmd.args;
  if (!sub) return 'empty git command';
  if (DENY_SUBCOMMANDS.has(sub)) return `git ${sub} is never allowed`;
  if (rest.some((arg) => arg === '--force' || arg === '-f' || arg === '--hard' || arg.startsWith('--exec'))) {
    return `forbidden flag in "${cmd.display}"`;
  }
  if (sub === 'reset') return 'git reset is never executed by Recovery Review';
  if (sub === 'merge' && !(rest.length === 1 && rest[0] === '--abort')) return `only "git merge --abort" is allowed`;
  return null;
}

export interface DecisionLike {
  id: string;
  decision: 'approve' | 'reject';
  selectedAlternativeId: string | null;
  actorId: string;
  actorRole: string;
  evidenceHash: string;
  planHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface AuthorizationInput {
  actor: ReviewActor | null;
  incident: { incidentType: string; requestedBy: string; source: string; executed: boolean };
  approvedSnapshot: { evidenceHash: string; planHash: string };
  /** Plan as stored; re-fingerprinted here so DB tampering is detected. */
  plan: RecoveryPlanV1;
  /** Hash of the state re-captured from the isolated workspace right before execution. */
  currentEvidenceHash: string | null;
  /** From the approved evidence; a gap means the plan does not cover every unmerged path. */
  coverage: { rawUnmerged: number; captured: number };
  decisions: DecisionLike[];
  requestedAlternativeId: string;
  now: Date;
}

export interface AuthorizationResult {
  allowed: boolean;
  reasons: string[];
  decisionId: string | null;
  /** Exactly the commands that may run, all taken from the deterministic plan. */
  commands: RecoveryCommandV1[];
}

const EXECUTE_ROLES: ActorRole[] = ['requester', 'approver'];

export function canApprove(actor: ReviewActor | null, requestedBy: string): string | null {
  if (!actor) return 'unauthenticated';
  if (actor.role !== 'approver') return `role "${actor.role}" cannot approve or reject`;
  if (actor.id === requestedBy) return 'the requester cannot approve their own review (four-eyes rule)';
  return null;
}

/**
 * Pure, deterministic gate in front of isolated execution. Model output is not
 * an input: commands come only from the plan alternative a human approved.
 */
export function authorizeExecution(input: AuthorizationInput): AuthorizationResult {
  const reasons: string[] = [];
  const deny = (reason: string) => reasons.push(reason);

  if (!input.actor) deny('unauthenticated');
  else if (!EXECUTE_ROLES.includes(input.actor.role)) deny(`role "${input.actor.role}" cannot execute`);

  if (input.incident.incidentType !== REVIEW_INCIDENT_TYPE) {
    deny(`incident type ${input.incident.incidentType} is out of scope`);
  }
  if (input.incident.source !== 'scenario') {
    deny('no isolated replay is available for imported snapshots; execution is disabled');
  }
  if (input.incident.executed) deny('this approval was already used for an execution');

  const latest = [...input.decisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  if (!latest) deny('no human decision recorded');
  else {
    if (latest.decision !== 'approve') deny('latest decision is a rejection');
    if (latest.actorRole !== 'approver') deny('latest decision was not made by an approver');
    if (latest.actorId === input.incident.requestedBy) deny('decision violates the four-eyes rule');
    if (latest.expiresAt.getTime() <= input.now.getTime()) deny('approval expired');
    if (latest.evidenceHash !== input.approvedSnapshot.evidenceHash) deny('approval refers to different evidence');
    if (latest.planHash !== input.approvedSnapshot.planHash) deny('approval refers to a different plan');
    if (latest.selectedAlternativeId !== input.requestedAlternativeId) {
      deny(`approved alternative is ${latest.selectedAlternativeId ?? 'none'}, requested ${input.requestedAlternativeId}`);
    }
  }

  if (planFingerprint(input.plan) !== input.approvedSnapshot.planHash) {
    deny('stored plan does not match the approved plan fingerprint (tampered)');
  }
  if (input.currentEvidenceHash === null) deny('current repository state could not be captured');
  else if (input.currentEvidenceHash !== input.approvedSnapshot.evidenceHash) {
    deny('repository state changed since approval (stale evidence)');
  }

  if (input.coverage.rawUnmerged > input.coverage.captured) {
    deny(
      `plan covers ${input.coverage.captured} of ${input.coverage.rawUnmerged} unmerged paths (capture limit); resolve manually`,
    );
  }

  const alternative = input.plan.alternatives.find((alt) => alt.id === input.requestedAlternativeId);
  if (!alternative) deny(`alternative ${input.requestedAlternativeId} is not in the plan`);

  const commands: RecoveryCommandV1[] = [];
  const steps = [...input.plan.steps, ...(alternative?.steps ?? [])];
  for (const step of steps) {
    for (const cmd of step.commands) {
      const denied = isDeniedCommand(cmd);
      if (denied) {
        deny(`plan step ${step.id}: ${denied}`);
        continue;
      }
      if (isExecutablePlanCommand(cmd)) commands.push(cmd);
    }
  }

  const allowed = reasons.length === 0;
  return { allowed, reasons, decisionId: latest?.id ?? null, commands: allowed ? commands : [] };
}
