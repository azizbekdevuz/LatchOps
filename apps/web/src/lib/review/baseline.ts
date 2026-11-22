import { verifyRecovery } from '@latchops/recovery-engine';
import { isExecutablePlanCommand } from '@/lib/hacksprint/execute';
import { buildNosanaEvidence } from '@/lib/hacksprint/redaction';
import { decideVerdict } from '@/lib/hacksprint/verdict';
import type { BrokenEvidence } from '@/lib/hacksprint/types';
import { captureState, createReviewWorkspace, materializeRepo } from './isolated';
import type { ReviewScenario } from './scenarios';

/**
 * Reproduces the pre-existing LatchOps (HackSprint proof) behaviour on a
 * Recovery Review scenario, for baseline measurement only:
 * - executes immediately after planning (no consent, approval or roles),
 * - structural allowlist only (isExecutablePlanCommand), no marker guard,
 *   no coverage check, no stale-state check,
 * - model evidence built by the existing buildNosanaEvidence().
 */
export async function runBaseline(scenario: ReviewScenario) {
  const ws = createReviewWorkspace();
  try {
    await materializeRepo(ws, scenario.repo, { drift: true });
    const { snapshot, signals, plan } = await captureState(ws);
    const file = snapshot.unmergedFiles[0];
    const block = file?.conflictBlocks[0];
    const broken: BrokenEvidence = {
      incidentType: signals.state,
      branch: signals.branch.name,
      oid: signals.branch.oid,
      mergeActive: signals.operations.merge,
      conflictedPaths: signals.worktree.conflictedPaths,
      reasons: signals.reasons,
      rawStatus: snapshot.rawStatus,
      conflict: block ? { path: file.path, ours: block.oursContent, theirs: block.theirsContent } : null,
    };
    const nosanaEvidence = buildNosanaEvidence({
      plan,
      before: signals,
      after: null,
      verification: null,
      broken,
      execution: [],
      isolation: 'local',
      selectedAlternativeId: scenario.selectedAlternativeId,
    });

    const alternative = plan.alternatives.find((alt) => alt.id === scenario.selectedAlternativeId);
    let failed = false;
    let error: string | undefined;
    let commandsRun = 0;
    for (const step of [...plan.steps, ...(alternative?.steps ?? [])]) {
      if (step.id === 'resolve-conflicts') {
        for (const [path, content] of Object.entries(scenario.repo.resolution)) await ws.writeFile(path, content);
      }
      for (const cmd of step.commands) {
        if (!isExecutablePlanCommand(cmd)) continue;
        const row = await ws.execGit(cmd.args, { allowFail: true, source: 'plan' });
        commandsRun++;
        if (!cmd.readOnly && row.exitCode !== 0) {
          failed = true;
          error = `${cmd.display} exited ${row.exitCode}`;
          break;
        }
      }
      if (failed) break;
    }

    let verification = null;
    if (!failed) {
      const after = await captureState(ws);
      verification = verifyRecovery({
        incidentType: plan.incidentType,
        before: signals,
        after: after.signals,
        plan,
        selectedAlternativeId: scenario.selectedAlternativeId,
      });
    }
    const decision = decideVerdict({ verification, executionFailed: failed, executionError: error });
    return { verdict: decision.verdict, reasons: decision.reasons, commandsRun, nosanaEvidence, signals, plan, snapshot };
  } finally {
    await ws.dispose();
  }
}
