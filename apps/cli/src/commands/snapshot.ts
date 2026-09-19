import { writeFileSync } from 'node:fs';
import {
  captureSnapshot,
  GitNotInstalledError,
  NotARepositoryError,
} from '@latchops/state-engine';

interface SnapshotOptions {
  output?: string;
  pretty?: boolean;
}

export async function snapshotCommand(options: SnapshotOptions): Promise<void> {
  const requestId = `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  console.error(`[CLI:SNAPSHOT:${requestId}] ========================================`);
  console.error(`[CLI:SNAPSHOT:${requestId}] 📸 Starting snapshot generation`);
  console.error(`[CLI:SNAPSHOT:${requestId}] Output: ${options.output || 'stdout'}`);
  console.error(`[CLI:SNAPSHOT:${requestId}] Pretty: ${options.pretty || false}`);

  try {
    console.error(`[CLI:SNAPSHOT:${requestId}] 📥 Capturing repository state via state-engine...`);
    const snapshot = await captureSnapshot();
    console.error(`[CLI:SNAPSHOT:${requestId}] ✅ Snapshot captured and validated`);
    console.error(
      `[CLI:SNAPSHOT:${requestId}]    Snapshot size: ${JSON.stringify(snapshot).length} bytes`,
    );

    const jsonOutput = options.pretty
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);

    if (options.output) {
      writeFileSync(options.output, jsonOutput, 'utf-8');
      console.error(`[CLI:SNAPSHOT:${requestId}] ✅ Snapshot written to: ${options.output}`);
    } else {
      console.log(jsonOutput);
      console.error(`[CLI:SNAPSHOT:${requestId}] ✅ Snapshot output to stdout`);
    }
    console.error(`[CLI:SNAPSHOT:${requestId}] ========================================`);
  } catch (error) {
    console.error(`[CLI:SNAPSHOT:${requestId}] ❌ Snapshot generation failed`);
    reportError(error, requestId);
    console.error(`[CLI:SNAPSHOT:${requestId}] ========================================`);
    process.exit(1);
  }
}

function reportError(error: unknown, requestId: string): void {
  if (error instanceof NotARepositoryError) {
    console.error(`[CLI:SNAPSHOT:${requestId}]    ${error.message}`);
    console.error('Please run this command from within a git repository.');
    return;
  }
  if (error instanceof GitNotInstalledError) {
    console.error(`[CLI:SNAPSHOT:${requestId}]    ${error.message}`);
    return;
  }
  if (error instanceof Error) {
    console.error(`[CLI:SNAPSHOT:${requestId}]    Error: ${error.message}`);
  }
}
