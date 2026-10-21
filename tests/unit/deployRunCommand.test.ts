// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandNotFoundError, quoteWindowsCmdArgument, resolveInvocation, runCommand } from '../../scripts/run-command.mjs';

const WINDOWS = { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, execPath: 'C:\\node\\node.exe', cwd: 'C:\\repo' };

describe('deploy script command runner', () => {
  it('runs git and gh directly on every platform, without a shell', () => {
    for (const platform of ['win32', 'linux']) {
      expect(resolveInvocation('git', ['rev-parse', 'HEAD'], { ...WINDOWS, platform })).toEqual({ file: 'git', args: ['rev-parse', 'HEAD'], options: {} });
      expect(resolveInvocation('gh', ['run', 'list'], { ...WINDOWS, platform }).options).toEqual({});
    }
  });

  it('runs the installed wrangler entry with node instead of an npx shim', () => {
    const invocation = resolveInvocation('npx', ['wrangler', 'pages', 'deploy', 'dist'], { ...WINDOWS, fileExists: () => true });
    expect(invocation).toEqual({
      file: 'C:\\node\\node.exe',
      args: [path.join('C:\\repo', 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'pages', 'deploy', 'dist'],
      options: {},
    });
  });

  it('starts npm and npx through cmd.exe only on Windows, with every argument quoted and escaped', () => {
    const invocation = resolveInvocation('npx', ['wrangler', 'pages', 'deploy', 'my dist&calc', '--branch', 'a"b%PATH%'], { ...WINDOWS, fileExists: () => false });
    expect(invocation.file).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(invocation.options).toEqual({ windowsVerbatimArguments: true });
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(invocation.args[3]).toBe('"^"npx.cmd^" ^"wrangler^" ^"pages^" ^"deploy^" ^"my^ dist^&calc^" ^"--branch^" ^"a\\^"b^%PATH^%^""');
    expect(resolveInvocation('npm', ['run', 'build:deploy'], { ...WINDOWS, platform: 'linux' }))
      .toEqual({ file: 'npm', args: ['run', 'build:deploy'], options: {} });
  });

  it('doubles backslashes only before quotes', () => {
    expect(quoteWindowsCmdArgument('C:\\dir\\')).toBe('^"C:\\dir\\\\^"');
    expect(quoteWindowsCmdArgument('C:\\a\\b')).toBe('^"C:\\a\\b^"');
  });

  it('names a missing program instead of a bare spawn ENOENT', () => {
    let caught: unknown;
    try { runCommand('masterselects-no-such-program', []); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(CommandNotFoundError);
    expect((caught as Error).message).toBe('masterselects-no-such-program was not found; install it or add it to PATH');
  });
});
