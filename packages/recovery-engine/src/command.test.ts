import { describe, expect, it } from 'vitest';
import { git, renderDisplay, shellQuoteForDisplay } from './command.js';

describe('typed command model', () => {
  it('preserves argument boundaries as an array', () => {
    const cmd = git(['add', '--', 'weird name.txt']);
    expect(cmd.executable).toBe('git');
    expect(cmd.args).toEqual(['add', '--', 'weird name.txt']);
  });

  it('never concatenates args into a shell string on the command itself', () => {
    const cmd = git(['commit', '-m', 'latchops checkpoint']);
    // The message argument stays a single array element.
    expect(cmd.args).toContain('latchops checkpoint');
  });

  it('quotes only the display rendering for readability', () => {
    const cmd = git(['add', '--', 'weird name.txt']);
    expect(cmd.display).toContain("'weird name.txt'");
    // Args are unaffected by display quoting.
    expect(cmd.args[2]).toBe('weird name.txt');
  });

  it('renders unicode paths readably in display but keeps raw args', () => {
    const cmd = git(['add', '--', 'wéird — file.txt']);
    expect(cmd.args[2]).toBe('wéird — file.txt');
    expect(cmd.display).toContain('wéird');
  });

  it('marks placeholders and read-only flags', () => {
    expect(git(['switch', '<branch-name>'], { containsPlaceholder: true }).containsPlaceholder).toBe(
      true,
    );
    expect(git(['status'], { readOnly: true }).readOnly).toBe(true);
  });

  it('shellQuoteForDisplay leaves simple tokens unquoted', () => {
    expect(shellQuoteForDisplay('HEAD~1')).toBe('HEAD~1');
    expect(shellQuoteForDisplay('<branch-name>')).toBe('<branch-name>');
    expect(shellQuoteForDisplay('a b')).toBe("'a b'");
  });

  it('renderDisplay joins executable and args', () => {
    expect(renderDisplay('git', ['status', '--short'])).toBe('git status --short');
  });
});
