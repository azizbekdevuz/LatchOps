import { computeRepoSignals } from '@latchops/state-engine';
import { generateRecoveryPlan, verifyRecovery } from '@latchops/recovery-engine';
import { captureSnapshotFromWorkspace } from './capture';
import { createDaytonaSession, daytonaKeyPresent, isolationPreference } from './daytona';
import { brokenFromSignals, executeRecovery, materializeBrokenRepo } from './execute';
import { explainWithNosana } from './nosana';
import { buildNosanaEvidence, publicRepoLabel, redactBroken } from './redaction';
import { hostGitAvailable } from './host-git';
import { builtInBrokenSnapshot, FIXTURE_PREVIEW_NOTE, LIVE_PREVIEW_NOTE } from './preview-fixture';
import { MERGE_CONFLICT_DEMO, resolveScenario } from './scenario';
import { readSponsorKeys } from './status';
import type {
  DaytonaStatus,
  IsolationKind,
  PreviewResult,
  ProofResult,
  TimelineEvent,
} from './types';
import { decideVerdict } from './verdict';
import { createLocalWorkspace, type ProofWorkspace } from './workspace';

export interface OpenedWorkspace {
  workspace: ProofWorkspace;
  isolation: IsolationKind;
  sandboxId?: string;
  fallbackReason?: string;
}

export interface ProofDeps {
  createWorkspace?: () => Promise<OpenedWorkspace>;
  explain?: typeof explainWithNosana;
  hostGitAvailable?: () => Promise<boolean>;
}

function event(stage: TimelineEvent['stage'], message: string): TimelineEvent {
  return { at: new Date().toISOString(), stage, message };
}

export async function previewProof(
  deps: Pick<ProofDeps, 'hostGitAvailable'> = {},
): Promise<PreviewResult> {
  const keys = readSponsorKeys();
  const scenario = MERGE_CONFLICT_DEMO;
  const gitOk = await (deps.hostGitAvailable ?? hostGitAvailable)();
  if (!gitOk) {
    const snapshot = builtInBrokenSnapshot();
    const signals = computeRepoSignals(snapshot);
    const plan = generateRecoveryPlan({ snapshot, signals });
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      description: scenario.description,
      previewSource: 'built_in_fixture',
      previewNote: FIXTURE_PREVIEW_NOTE,
      broken: redactBroken(brokenFromSignals(signals, snapshot, scenario)),
      plan,
      selectedAlternativeId: scenario.selectedAlternativeId,
      daytona: { status: keys.daytona },
      nosana: { status: keys.nosana },
    };
  }

  const workspace = createLocalWorkspace();
  try {
    await materializeBrokenRepo(workspace, scenario);
    const snapshot = await captureSnapshotFromWorkspace(workspace);
    const signals = computeRepoSignals(snapshot);
    const plan = generateRecoveryPlan({ snapshot, signals });
    return {
      scenarioId: scenario.id,
      title: scenario.title,
      description: scenario.description,
      previewSource: 'live_host_git',
      previewNote: LIVE_PREVIEW_NOTE,
      broken: redactBroken(brokenFromSignals(signals, snapshot, scenario)),
      plan,
      selectedAlternativeId: scenario.selectedAlternativeId,
      daytona: { status: keys.daytona },
      nosana: { status: keys.nosana },
    };
  } finally {
    await workspace.dispose();
  }
}

export async function runProof(
  input: { scenarioId?: unknown } = {},
  deps: ProofDeps = {},
): Promise<ProofResult> {
  const scenario = resolveScenario(input.scenarioId);
  const keys = readSponsorKeys();
  const timeline: TimelineEvent[] = [];
  const explain = deps.explain ?? explainWithNosana;

  let workspace: ProofWorkspace | null = null;
  let isolation: IsolationKind = 'local';
  const daytona: DaytonaStatus = {
    status: keys.daytona === 'configured' ? 'configured' : 'missing',
    sandboxId: null,
    cleanedUp: false,
    message: keys.daytona === 'configured' ? 'Daytona key present' : 'DAYTONA_API_KEY is not set',
  };

  try {
    const created = deps.createWorkspace
      ? await deps.createWorkspace()
      : await openWorkspace({ hostGitAvailable: deps.hostGitAvailable });
    workspace = created.workspace;
    isolation = created.isolation;

    if (created.isolation === 'daytona' && created.sandboxId) {
      daytona.status = 'live';
      daytona.sandboxId = created.sandboxId;
      daytona.message = `Daytona sandbox ${created.sandboxId}`;
      timeline.push(event('sandbox', `Created disposable Daytona sandbox ${created.sandboxId}`));
    } else if (created.fallbackReason) {
      daytona.status = 'error';
      daytona.message = created.fallbackReason;
      timeline.push(event('sandbox', created.fallbackReason));
      timeline.push(event('sandbox', 'Fell back to isolated local workspace'));
    } else {
      daytona.status = keys.daytona === 'configured' ? 'configured' : 'missing';
      daytona.message =
        keys.daytona === 'configured'
          ? 'Daytona key present but local isolation was selected'
          : 'DAYTONA_API_KEY is not set — isolated local proof only';
      timeline.push(event('sandbox', 'Isolated local workspace (not the host LatchOps repository)'));
    }

    timeline.push(event('broken', `Materializing ${scenario.id} merge conflict`));
    await materializeBrokenRepo(workspace, scenario);

    const beforeSnapshot = await captureSnapshotFromWorkspace(workspace);
    const signalsBefore = computeRepoSignals(beforeSnapshot);
    const plan = generateRecoveryPlan({ snapshot: beforeSnapshot, signals: signalsBefore });
    const broken = redactBroken(brokenFromSignals(signalsBefore, beforeSnapshot, scenario));
    timeline.push(
      event(
        'plan',
        `Deterministic LatchOps plan: ${plan.incidentType} · recommended ${scenario.selectedAlternativeId}`,
      ),
    );

    timeline.push(event('sandbox', 'Executing allowlisted recovery steps in isolation'));
    const executed = await executeRecovery(workspace, plan, scenario);

    let signalsAfter = null;
    let verification = null;
    if (!executed.failed) {
      const afterSnapshot = await captureSnapshotFromWorkspace(workspace);
      signalsAfter = computeRepoSignals(afterSnapshot);
      verification = verifyRecovery({
        incidentType: plan.incidentType,
        before: signalsBefore,
        after: signalsAfter,
        plan,
        selectedAlternativeId: scenario.selectedAlternativeId,
      });
    }

    const decision = decideVerdict({
      verification,
      executionFailed: executed.failed,
      executionError: executed.error,
    });
    timeline.push(event('proof', `${decision.verdict} — ${decision.reasons[0] ?? 'checked'}`));

    const nosanaResult = await explain(
      buildNosanaEvidence({
        plan,
        before: signalsBefore,
        after: signalsAfter,
        verification,
        broken,
        execution: executed.execution,
        isolation,
        selectedAlternativeId: scenario.selectedAlternativeId,
      }),
    );

    timeline.push(
      event(
        'explain',
        nosanaResult.explanation
          ? `Nosana explained evidence via ${nosanaResult.status.model ?? 'discovered model'}`
          : nosanaResult.status.message || 'Nosana unavailable',
      ),
    );

    return {
      scenarioId: scenario.id,
      isolation,
      verdict: decision.verdict,
      verdictReasons: decision.reasons,
      selectedAlternativeId: scenario.selectedAlternativeId,
      broken: {
        ...broken,
        conflict: broken.conflict
          ? { ...broken.conflict, resolved: scenario.resolvedEnv }
          : null,
      },
      plan,
      signalsBefore,
      signalsAfter,
      verification,
      execution: executed.execution.filter((row) => row.source !== 'setup'),
      timeline,
      daytona,
      nosana: nosanaResult.status,
      explanation: nosanaResult.explanation,
      changedSignals: (verification?.changedSignals ?? []).map((change) => ({
        field: change.field,
        before: change.before,
        after: change.after,
      })),
    };
  } finally {
    if (workspace) {
      const cleanup = await workspace.dispose();
      daytona.cleanedUp = cleanup.cleanedUp;
      if (!cleanup.cleanedUp && cleanup.error) {
        daytona.message = `${daytona.message} · cleanup: ${cleanup.error}`;
      }
    }
  }
}

export async function openWorkspace(
  deps: Pick<ProofDeps, 'hostGitAvailable'> = {},
): Promise<OpenedWorkspace> {
  const gitOk = await (deps.hostGitAvailable ?? hostGitAvailable)();

  if (isolationPreference() === 'local' || !daytonaKeyPresent()) {
    if (!gitOk) {
      throw new Error(
        'Host git is not available in this runtime. Set DAYTONA_API_KEY so Prove recovery can run in a real Daytona sandbox.',
      );
    }
    return { workspace: createLocalWorkspace(), isolation: 'local' };
  }

  try {
    const session = await createDaytonaSession();
    return {
      workspace: session.workspace,
      isolation: 'daytona',
      sandboxId: session.sandboxId,
    };
  } catch (error) {
    const reason = `Daytona create failed: ${error instanceof Error ? error.message : 'unknown error'}`;
    if (!gitOk) {
      throw new Error(`${reason} Host git is not available, so the demo cannot fall back to a local capture.`);
    }
    return {
      workspace: createLocalWorkspace(),
      isolation: 'local',
      fallbackReason: reason,
    };
  }
}

export function displayRepoRoot(): string {
  return publicRepoLabel();
}
