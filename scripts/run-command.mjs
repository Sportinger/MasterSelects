// Runs the external programs of the deploy scripts (git, gh, npm, npx wrangler) without a shell.
//
// Only npm and npx need cmd.exe on Windows, because they are .cmd shims that execFile cannot start
// directly. Those get an explicitly quoted cmd.exe command line (cmd metacharacters escaped), so
// arguments are never concatenated unescaped (Node's DEP0190 for `shell: true` with arguments).
// `npx wrangler` runs the project's own wrangler entry with node when it is installed, so the
// deploy itself needs no shell on any platform.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx']);
// Characters cmd.exe interprets even inside a quoted command line; `^` makes them literal.
const CMD_METACHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

/** Quotes one argument for CommandLineToArgvW and escapes it for cmd.exe (as cross-spawn does). */
export function quoteWindowsCmdArgument(value) {
  const quoted = `"${String(value)
    // Backslashes only need doubling when a quote follows them (inside the argument or the closing one).
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_METACHARACTERS, '^$1');
}

/**
 * How to start `command args`: the file to execute, its arguments and extra execFile options.
 * `platform`, `env`, `execPath` and `cwd` are parameters so tests can describe Windows on Linux.
 */
export function resolveInvocation(command, args, {
  cwd = process.cwd(), platform = process.platform, env = process.env, execPath = process.execPath,
  fileExists = existsSync,
} = {}) {
  if (command === 'npx' && args[0] === 'wrangler') {
    const wranglerEntry = path.join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    if (fileExists(wranglerEntry)) return { file: execPath, args: [wranglerEntry, ...args.slice(1)], options: {} };
  }
  if (platform === 'win32' && WINDOWS_CMD_SHIMS.has(command)) {
    const commandLine = [`${command}.cmd`, ...args].map(quoteWindowsCmdArgument).join(' ');
    return {
      file: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${commandLine}"`],
      options: { windowsVerbatimArguments: true },
    };
  }
  return { file: command, args, options: {} };
}

/** A program that is not installed: the message names it instead of a bare `spawnSync x ENOENT`. */
export class CommandNotFoundError extends Error {
  constructor(command, cause) {
    super(`${command} was not found; install it or add it to PATH`, { cause });
    this.name = 'CommandNotFoundError';
    this.code = 'ENOENT';
    this.command = command;
  }
}

/**
 * Runs a program and returns its stdout, throwing on a non-zero exit. With `inherit` its output
 * goes straight to this terminal.
 */
export function runCommand(command, args, { cwd, inherit = false } = {}) {
  const invocation = resolveInvocation(command, args, { cwd: cwd ?? process.cwd() });
  try {
    return execFileSync(invocation.file, invocation.args, { cwd, encoding: 'utf8', ...invocation.options,
      maxBuffer: 64 * 1024 * 1024, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] }) ?? '';
  } catch (error) {
    if (error?.code === 'ENOENT') throw new CommandNotFoundError(command, error);
    throw error;
  }
}
