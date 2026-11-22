import { describe, expect, it } from 'vitest';
import { git } from '@latchops/recovery-engine';
import { isExecutablePlanCommand } from './commands';

describe('allowlisted recovery commands', () => {
  it('allows the concrete inspect and recovery shapes used by the demo', () => {
    expect(isExecutablePlanCommand(git(['status', '--short', '--branch']))).toBe(true);
    expect(isExecutablePlanCommand(git(['diff', '--name-only', '--diff-filter=U']))).toBe(true);
    expect(isExecutablePlanCommand(git(['ls-files', '-u']))).toBe(true);
    expect(isExecutablePlanCommand(git(['add', '--', 'deploy.env']))).toBe(true);
    expect(isExecutablePlanCommand(git(['add', '-A']))).toBe(true);
    expect(isExecutablePlanCommand(git(['commit', '--no-edit']))).toBe(true);
    expect(isExecutablePlanCommand(git(['merge', '--abort']))).toBe(true);
  });

  it('does not authorize a command merely because readOnly is true', () => {
    expect(isExecutablePlanCommand(git(['reset', '--hard', 'HEAD'], { readOnly: true }))).toBe(false);
    expect(isExecutablePlanCommand(git(['checkout', '.'], { readOnly: true }))).toBe(false);
    expect(isExecutablePlanCommand(git(['branch', '-D', 'main'], { readOnly: true }))).toBe(false);
    expect(isExecutablePlanCommand(git(['clean', '-fd'], { readOnly: true }))).toBe(false);
  });

  it('rejects mutating branch, reset, checkout, switch, push, and amend', () => {
    expect(isExecutablePlanCommand(git(['branch']))).toBe(false);
    expect(isExecutablePlanCommand(git(['branch', '-vv']))).toBe(false);
    expect(isExecutablePlanCommand(git(['branch', '-D', 'feature']))).toBe(false);
    expect(isExecutablePlanCommand(git(['branch', 'rescue']))).toBe(false);
    expect(isExecutablePlanCommand(git(['reset', '--hard', 'HEAD']))).toBe(false);
    expect(isExecutablePlanCommand(git(['reset']))).toBe(false);
    expect(isExecutablePlanCommand(git(['checkout', 'main']))).toBe(false);
    expect(isExecutablePlanCommand(git(['switch', 'main']))).toBe(false);
    expect(isExecutablePlanCommand(git(['push', '--force']))).toBe(false);
    expect(isExecutablePlanCommand(git(['commit', '--amend']))).toBe(false);
    expect(isExecutablePlanCommand(git(['commit', '-m', 'x']))).toBe(false);
    expect(isExecutablePlanCommand(git(['merge', 'feature/scale']))).toBe(false);
    expect(isExecutablePlanCommand(git(['rebase', '--abort']))).toBe(false);
  });

  it('rejects placeholders and non-git executables', () => {
    expect(
      isExecutablePlanCommand(git(['checkout', '--merge', '--', '<file>'], { containsPlaceholder: true })),
    ).toBe(false);
    expect(
      isExecutablePlanCommand({
        executable: 'bash',
        args: ['-c', 'rm -rf /'],
        cwdStrategy: 'repo_root',
        display: 'bash -c rm',
        containsPlaceholder: false,
        readOnly: false,
      }),
    ).toBe(false);
  });
});
