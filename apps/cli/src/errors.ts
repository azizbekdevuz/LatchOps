import { GitNotInstalledError, NotARepositoryError } from '@latchops/state-engine';
import { ExitCode } from './exit-codes.js';

/**
 * Print a capture/runtime error in a concise operational form and exit with the
 * appropriate code. Never returns.
 */
export function reportCaptureError(error: unknown): never {
  if (error instanceof NotARepositoryError) {
    console.error(`error: ${error.message}`);
    console.error('Run this command from within a git repository.');
    process.exit(ExitCode.OPERATIONAL_FAILURE);
  }
  if (error instanceof GitNotInstalledError) {
    console.error(`error: ${error.message}`);
    console.error('Install git and ensure it is on your PATH.');
    process.exit(ExitCode.OPERATIONAL_FAILURE);
  }
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(ExitCode.OPERATIONAL_FAILURE);
}
