#!/usr/bin/env node
import { program } from 'commander';
import { snapshotCommand } from './commands/snapshot.js';
import { sendCommand } from './commands/send.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { planCommand } from './commands/plan.js';
import { verifyCommand } from './commands/verify.js';
import { doctorCommand } from './commands/doctor.js';

program
  .name('latchops')
  .description('LatchOps CLI - inspect repository state and generate deterministic recovery diagnostics')
  .version('1.0.0');

program
  .command('snapshot')
  .description('Generate a read-only diagnostic snapshot of the current git repository state')
  .option('-o, --output <file>', 'Write snapshot to file instead of stdout')
  .option('--pretty', 'Pretty-print JSON output')
  .action(snapshotCommand);

program
  .command('send')
  .description('Capture repository state and send it to LatchOps for incident analysis')
  .option('-u, --api-url <url>', 'LatchOps API URL (default: http://localhost:3000)')
  .option('-o, --open', 'Open the incident room in browser after upload')
  .option('--idempotency-key <key>', 'Explicit Idempotency-Key (for CI); default uses retry-safe pending state')
  .option('--discard-pending', 'Abandon a stale pending submission and capture a new incident')
  .action(sendCommand);

program
  .command('diagnose')
  .description('Capture repository state and print the deterministic classification')
  .option('--json', 'Output signals as JSON')
  .action(diagnoseCommand);

program
  .command('plan')
  .description('Generate a deterministic, advisory recovery plan (never executes commands)')
  .option('--json', 'Output the plan artifact as JSON')
  .option('-o, --output <file>', 'Write the plan artifact to a file for later verification')
  .option('-a, --alternative <id>', 'Select a specific alternative path where applicable')
  .action(planCommand);

program
  .command('verify')
  .description('Verify recovery progress against a previously saved plan artifact')
  .option('-p, --plan <file>', 'Path to a plan artifact produced by `latchops plan --output`')
  .option('--json', 'Output the verification result as JSON')
  .action(verifyCommand);

program
  .command('doctor')
  .description('Check the local environment (git, repository, read-only commands, runtime)')
  .option('--json', 'Output the checks as JSON')
  .option('-u, --api-url <url>', 'Validate an API URL format (optional)')
  .option('--check-api', 'Also check API reachability (requires --api-url)')
  .action(doctorCommand);

program.parse();
