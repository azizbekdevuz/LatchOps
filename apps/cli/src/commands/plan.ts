import { writeFileSync } from 'node:fs';
import type { PlanArtifactV1 } from '@latchops/schema';
import { PlanArtifactV1Schema } from '@latchops/schema';
import { captureRepoState } from '@latchops/state-engine';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { ExitCode, exitCodeForPlan } from '../exit-codes.js';
import { reportCaptureError } from '../errors.js';
import { renderPlan } from '../render.js';

interface PlanOptions {
  json?: boolean;
  output?: string;
  alternative?: string;
}

/**
 * Generate a deterministic, advisory recovery plan for the current repository.
 * Never executes any command. Writes a round-trippable plan artifact with
 * `--output` for later `latchops verify --plan`.
 */
export async function planCommand(options: PlanOptions): Promise<void> {
  try {
    const { snapshot, signals } = await captureRepoState();
    const plan = generateRecoveryPlan({ snapshot, signals });

    const selectedAlternativeId: string | null = options.alternative ?? null;
    if (selectedAlternativeId) {
      const known = plan.alternatives.some((a) => a.id === selectedAlternativeId);
      if (!known) {
        const available = plan.alternatives.map((a) => a.id).join(', ') || '(none)';
        console.error(
          `error: unknown alternative '${selectedAlternativeId}'. Available: ${available}`,
        );
        process.exit(ExitCode.INVALID_INPUT);
      }
    }

    const artifact: PlanArtifactV1 = PlanArtifactV1Schema.parse({
      version: 1,
      kind: 'latchops-plan-artifact',
      generatedAt: plan.generatedAt,
      repoRoot: snapshot.repoRoot,
      incidentType: plan.incidentType,
      selectedAlternativeId,
      plan,
      beforeSignals: signals,
    });

    if (options.output) {
      writeFileSync(options.output, JSON.stringify(artifact, null, 2), 'utf-8');
      console.error(`Plan artifact written to ${options.output}`);
      console.error('Verify later with: latchops verify --plan ' + options.output);
    }

    if (options.json) {
      console.log(JSON.stringify(artifact, null, 2));
    } else {
      console.log(renderPlan(plan, selectedAlternativeId));
    }

    process.exit(exitCodeForPlan(plan));
  } catch (error) {
    reportCaptureError(error);
  }
}
