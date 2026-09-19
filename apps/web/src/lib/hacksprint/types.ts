import type {
  RecoveryPlanV1,
  RepoSignalsV1,
  VerificationResultV1,
} from '@latchops/schema';

export const DEMO_SCENARIO_ID = 'merge_conflict_demo' as const;
export type DemoScenarioId = typeof DEMO_SCENARIO_ID;

export type IsolationKind = 'daytona' | 'local';
export type SponsorRuntimeStatus = 'live' | 'configured' | 'missing' | 'unavailable' | 'error';
export type ProofVerdict = 'VERIFIED' | 'FAILED';
export type ProofStageId = 'broken' | 'plan' | 'sandbox' | 'proof' | 'explain';

export interface ExecEvidence {
  display: string;
  executable: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  source: 'plan' | 'demo_orchestration' | 'setup' | 'inspect';
}

export interface TimelineEvent {
  at: string;
  stage: ProofStageId;
  message: string;
}

export interface ConflictEvidence {
  path: string;
  ours: string;
  theirs: string;
  resolved?: string;
}

export interface BrokenEvidence {
  incidentType: string;
  branch: string | null;
  oid: string | null;
  mergeActive: boolean;
  conflictedPaths: string[];
  reasons: string[];
  rawStatus: string;
  conflict: ConflictEvidence | null;
}

export interface DaytonaStatus {
  status: SponsorRuntimeStatus;
  sandboxId: string | null;
  cleanedUp: boolean;
  message: string;
}

export interface NosanaStatus {
  status: SponsorRuntimeStatus;
  model: string | null;
  message: string;
}

export interface NosanaExplanation {
  whatWasBroken: string;
  whatWasAttempted: string;
  checksPassed: string[];
  checksFailed: string[];
  whyItMatters: string;
}

export interface ProofCheck {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ProofResult {
  scenarioId: DemoScenarioId;
  isolation: IsolationKind;
  verdict: ProofVerdict;
  verdictReasons: string[];
  selectedAlternativeId: string;
  broken: BrokenEvidence;
  plan: RecoveryPlanV1;
  signalsBefore: RepoSignalsV1;
  signalsAfter: RepoSignalsV1 | null;
  verification: VerificationResultV1 | null;
  execution: ExecEvidence[];
  timeline: TimelineEvent[];
  daytona: DaytonaStatus;
  nosana: NosanaStatus;
  explanation: NosanaExplanation | null;
  changedSignals: ProofCheck[];
}

export type PreviewSource = 'live_host_git' | 'built_in_fixture';

export interface PreviewResult {
  scenarioId: DemoScenarioId;
  title: string;
  description: string;
  previewSource: PreviewSource;
  previewNote: string;
  broken: BrokenEvidence;
  plan: RecoveryPlanV1;
  selectedAlternativeId: string;
  daytona: { status: 'configured' | 'missing' };
  nosana: { status: 'configured' | 'missing' };
}

export interface SponsorKeyStatus {
  daytona: 'configured' | 'missing';
  nosana: 'configured' | 'missing';
}
