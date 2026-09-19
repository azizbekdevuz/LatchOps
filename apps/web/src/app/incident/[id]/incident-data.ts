import type {
  RecoveryPlanV1,
  RepoSignalsV1,
  VerificationResultV1,
} from '@latchops/schema';

/** Canonical incident payload returned by GET /api/incident/[id]. */
export interface IncidentData {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  incidentType: RepoSignalsV1['state'];
  risk: RecoveryPlanV1['risk'] | null;
  reasons: string[];
  summary: string | null;
  branch: { name: string | null; oid: string | null; isDetached: boolean };
  signals: RepoSignalsV1 | null;
  plan: RecoveryPlanV1 | null;
  conflicts: Array<{
    id: string;
    path: string;
    hunks: Array<{
      id: string;
      index: number;
      baseText: string;
      oursText: string;
      theirsText: string;
    }>;
  }>;
  verification: VerificationResultV1 | null;
  traces: Array<{
    id: string;
    stage: string;
    outputJson: unknown;
    durationMs: number | null;
    success: boolean;
    createdAt: string;
  }>;
}

export type { RecoveryPlanV1, RepoSignalsV1, VerificationResultV1 };
