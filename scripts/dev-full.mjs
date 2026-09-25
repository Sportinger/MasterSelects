import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevRuntimeCoordinator } from './dev-runtime-coordinator.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExePath = process.execPath;
const nodeBinDir = path.dirname(nodeExePath);
const viteCliPath = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const wranglerCliPath = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const devVarsPath = path.join(repoRoot, '.dev.vars');
const kernelRepoRoot = path.resolve(
  process.env.MASTERSELECTS_KERNEL_ROOT?.trim() || path.join(repoRoot, '..', 'masterselects-kernel'),
);
const kernelTsxCliPath = path.join(kernelRepoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const kernelServePath = path.join(kernelRepoRoot, 'scripts', 'serveKernel.ts');
const logicAgentEndpoint = 'ws://127.0.0.1:4500';
const logicAgentPort = 4500;
const logicDevEnabled = process.env.MASTERSELECTS_LOGIC_DEV_ENABLED?.trim().toLowerCase() !== 'false';
const localWorkerSecretKeys = [
  'ADMIN_PASSWORD_HASH_B64',
  'ADMIN_SESSION_SECRET',
  'MS_SOCIAL_AGENT_TOKEN',
  'MS_SOCIAL_BLUESKY_APP_PASSWORD',
  'MS_SOCIAL_FACEBOOK_PAGE_ACCESS_TOKEN',
  'MS_SOCIAL_INSTAGRAM_ACCESS_TOKEN',
  'MS_SOCIAL_LINKEDIN_ACCESS_TOKEN',
  'MS_SOCIAL_THREADS_ACCESS_TOKEN',
  'MS_SOCIAL_TIKTOK_ACCESS_TOKEN',
  'MS_SOCIAL_YOUTUBE_CLIENT_ID',
  'MS_SOCIAL_YOUTUBE_CLIENT_SECRET',
  'MS_SOCIAL_YOUTUBE_REFRESH_TOKEN',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'DEEPGRAM_API_KEY',
  'KIEAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
];
const replaceableLocalWorkerSecretKeys = new Set([
  'ADMIN_PASSWORD_HASH_B64',
]);
const children = [];
let shuttingDown = false;
let logicAgentToken = null;
let logicCodexHomePath = null;
let logicCredentialDirectory = null;
let logicCredentialPath = null;
let logicWorkspacePath = null;
const devRuntimeCoordinator = createDevRuntimeCoordinator({
  repoRoot,
  servicePorts: [4500, 5173, 8787, 8788],
  onStopRequested: () => {
    if (shuttingDown) return;
    console.log('[dev-full] Restart requested; stopping the current MasterSelects dev stack...');
    shuttingDown = true;
    shutdownAll();
    process.exit(0);
  },
});

const inheritedPath = process.env.Path ?? process.env.PATH ?? '';
const resolvedPath = `${nodeBinDir}${path.delimiter}${inheritedPath}`;
const childEnv = {
  ...process.env,
  PATH: resolvedPath,
  Path: resolvedPath,
};

function ensureFileExists(filePath) {
  return filePath;
}

function isPlaceholderSecret(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
  return normalized.length === 0 || normalized === 'replace-me' || normalized.startsWith('replace-me-');
}

function quoteDevVarValue(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function readDevVars() {
  if (!fs.existsSync(devVarsPath)) {
    return [];
  }

  return fs.readFileSync(devVarsPath, 'utf8').split(/\r?\n/);
}

function parseDevVarValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readDevVarsEnvironment() {
  return Object.fromEntries(readDevVars().flatMap((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    return match ? [[match[1], parseDevVarValue(match[2])]] : [];
  }));
}

function readBridgeToken() {
  const tokenPath = path.join(repoRoot, '.ai-bridge-token');
  if (!fs.existsSync(tokenPath)) return null;
  const value = fs.readFileSync(tokenPath, 'utf8').trim();
  return value || null;
}

async function waitForBridgeTokenRefresh(previousToken, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = readBridgeToken();
    if (token && token !== previousToken) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('Vite did not publish a fresh local bridge token within 15 seconds.');
}

function getDevVarName(line) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] ?? null;
}

function upsertDevVar(lines, key, value) {
  const index = lines.findIndex(line => getDevVarName(line) === key);
  const nextLine = `${key}=${quoteDevVarValue(value)}`;

  if (index >= 0) {
    const [, currentValue = ''] = lines[index].split(/=(.*)/s);
    if (isPlaceholderSecret(currentValue)) {
      lines[index] = nextLine;
      return true;
    }

    return false;
  }

  lines.push(nextLine);
  return true;
}

function setDevVar(lines, key, value) {
  const index = lines.findIndex(line => getDevVarName(line) === key);
  const nextLine = `${key}=${quoteDevVarValue(value)}`;
  if (index >= 0) {
    if (lines[index] === nextLine) return false;
    lines[index] = nextLine;
    return true;
  }
  lines.push(nextLine);
  return true;
}

function readWindowsEnvValue(key, scope) {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const output = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `[Environment]::GetEnvironmentVariable('${key.replace(/'/g, "''")}', '${scope}')`,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    ).trim();

    return output || null;
  } catch {
    return null;
  }
}

function getLocalWorkerSecretValue(key) {
  return process.env[key]?.trim()
    || readWindowsEnvValue(key, 'User')
    || readWindowsEnvValue(key, 'Machine');
}

function ensureLocalDevVars() {
  const lines = readDevVars().filter((line, index, allLines) => index < allLines.length - 1 || line.trim() !== '');
  let changed = false;

  if (!lines.some(line => getDevVarName(line) === 'ENVIRONMENT')) {
    lines.push('ENVIRONMENT=development');
    changed = true;
  }

  if (!lines.some(line => getDevVarName(line) === 'SESSION_SECRET')) {
    lines.push(`SESSION_SECRET=${quoteDevVarValue(crypto.randomBytes(32).toString('base64'))}`);
    changed = true;
  }

  if (!lines.some(line => getDevVarName(line) === 'KERNEL_ORIGIN')) {
    lines.push(`KERNEL_ORIGIN=${quoteDevVarValue('http://127.0.0.1:8787')}`);
    changed = true;
  }

  if (!lines.some(line => getDevVarName(line) === 'KERNEL_HOSTED_AGENT_CALLBACK_ORIGIN')) {
    lines.push(`KERNEL_HOSTED_AGENT_CALLBACK_ORIGIN=${quoteDevVarValue('http://127.0.0.1:8788')}`);
    changed = true;
  }

  if (setDevVar(lines, 'HOSTED_AGENT_LOGIC_ENABLED', logicDevEnabled ? 'true' : 'false')) {
    changed = true;
  }

  if (upsertDevVar(
    lines,
    'KERNEL_AUTH_TOKEN',
    crypto.randomBytes(32).toString('base64url'),
  )) {
    changed = true;
  }

  if (upsertDevVar(
    lines,
    'KERNEL_SERVICE_ASSERTION_SECRET',
    crypto.randomBytes(32).toString('base64url'),
  )) {
    changed = true;
  }

  const syncedKeys = [];

  for (const key of localWorkerSecretKeys) {
    const value = getLocalWorkerSecretValue(key);
    if (!value) {
      continue;
    }

    const updated = replaceableLocalWorkerSecretKeys.has(key)
      ? setDevVar(lines, key, value)
      : upsertDevVar(lines, key, value);
    if (updated) {
      syncedKeys.push(key);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(devVarsPath, `${lines.join('\n')}\n`, 'utf8');
  }

  if (syncedKeys.length > 0) {
    console.log(`[dev-full] Synced local Worker secrets into .dev.vars: ${syncedKeys.join(', ')}`);
  }
}

function registerChild(child, onSuccess) {
  children.push(child);

  child.on('exit', (code, signal) => {
    const index = children.indexOf(child);
    if (index >= 0) {
      children.splice(index, 1);
    }

    if (shuttingDown) {
      return;
    }

    if (signal) {
      shuttingDown = true;
      shutdownAll();
      process.kill(process.pid, signal);
      return;
    }

    if (code === 0 && onSuccess) {
      onSuccess();
      return;
    }

    shuttingDown = true;
    shutdownAll();
    process.exit(code ?? 0);
  });
}

function spawnNodeProcess(args, onSuccess, envOverrides, cwd = repoRoot) {
  const child = spawn(nodeExePath, args, {
    cwd,
    shell: false,
    stdio: 'inherit',
    env: envOverrides ? { ...childEnv, ...envOverrides } : childEnv,
  });

  registerChild(child, onSuccess);
}

function resolveCodexJavaScriptCli() {
  const explicitPath = process.env.MASTERSELECTS_CODEX_CLI_PATH?.trim();
  const candidates = [
    explicitPath,
    process.env.APPDATA
      ? path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      : null,
    path.resolve(nodeBinDir, '..', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) ?? null;
}

async function waitForTcpPort(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise((resolvePromise) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolvePromise(result);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(250, () => finish(false));
    });
    if (ready) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Logic Codex app-server did not listen on ${logicAgentEndpoint} within 15 seconds.`);
}

async function startLogicAgent() {
  if (!logicDevEnabled) return;

  logicAgentToken = crypto.randomBytes(32).toString('base64url');
  logicCredentialDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'masterselects-logic-dev-'));
  logicCredentialPath = path.join(logicCredentialDirectory, 'capability-token');
  logicCodexHomePath = path.join(logicCredentialDirectory, 'codex-home');
  logicWorkspacePath = path.join(logicCredentialDirectory, 'workspace');
  fs.mkdirSync(logicCodexHomePath, { mode: 0o700 });
  fs.mkdirSync(logicWorkspacePath, { mode: 0o700 });
  fs.writeFileSync(logicCredentialPath, `${logicAgentToken}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const inheritedCodexHome = path.resolve(
    process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex'),
  );
  const inheritedAuthPath = path.join(inheritedCodexHome, 'auth.json');
  if (!fs.existsSync(inheritedAuthPath)) {
    throw new Error(`Logic Codex authentication is unavailable at ${inheritedAuthPath}.`);
  }
  const isolatedAuthPath = path.join(logicCodexHomePath, 'auth.json');
  fs.copyFileSync(inheritedAuthPath, isolatedAuthPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(isolatedAuthPath, 0o600);
  fs.writeFileSync(path.join(logicCodexHomePath, 'config.toml'), [
    'include_apps_instructions = false',
    'include_collaboration_mode_instructions = false',
    'include_environment_context = false',
    'include_permissions_instructions = false',
    'web_search = "disabled"',
    '',
    '[features]',
    'apps = false',
    'browser_use = false',
    'code_mode = false',
    'computer_use = false',
    'connectors = false',
    'enable_mcp_apps = false',
    'goals = false',
    'hooks = false',
    'image_generation = false',
    'in_app_browser = false',
    'js_repl = false',
    'memories = false',
    'multi_agent = false',
    'plugins = false',
    'search_tool = false',
    'shell_tool = false',
    'skill_mcp_dependency_install = false',
    'tool_search = false',
    'tool_suggest = false',
    'unified_exec = false',
    'web_search = false',
    '',
    '[mcp_servers]',
    '',
  ].join('\n'), {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const logicAgentEnvironment = {
    ...childEnv,
    CODEX_HOME: logicCodexHomePath,
  };

  const codexArgs = [
    'app-server',
    '--listen',
    logicAgentEndpoint,
    '--ws-auth',
    'capability-token',
    '--ws-token-file',
    logicCredentialPath,
  ];
  const codexJavaScriptCli = resolveCodexJavaScriptCli();
  const child = codexJavaScriptCli
    ? spawn(nodeExePath, [codexJavaScriptCli, ...codexArgs], {
        cwd: kernelRepoRoot,
        shell: false,
        stdio: 'inherit',
        env: logicAgentEnvironment,
      })
    : spawn('codex', codexArgs, {
        cwd: kernelRepoRoot,
        shell: false,
        stdio: 'inherit',
        env: logicAgentEnvironment,
      });
  registerChild(child);
  await waitForTcpPort(logicAgentPort);
  console.log(`[dev-full] Logic Codex app-server ready on ${logicAgentEndpoint}.`);
}

function assertKernelWorkspaceAvailable() {
  if (!fs.existsSync(kernelServePath) || !fs.existsSync(kernelTsxCliPath)) {
    throw new Error(
      `Local kernel workspace is unavailable at ${kernelRepoRoot}. ` +
      'Set MASTERSELECTS_KERNEL_ROOT to the private masterselects-kernel checkout.',
    );
  }
}

function startKernel() {
  const kernelEnvironment = {
    ...readDevVarsEnvironment(),
    BRIDGE_TOKEN_FILE: path.join(repoRoot, '.ai-bridge-token'),
    KERNEL_AUDIT_DIR: path.join(kernelRepoRoot, '.dev-data', 'audits'),
    ...(logicDevEnabled && logicAgentToken
      ? {
          KERNEL_LOGIC_AGENT_TOKEN: logicAgentToken,
          KERNEL_LOGIC_AGENT_WORKSPACE: logicWorkspacePath,
        }
      : {}),
    PORT: '8787',
  };
  spawnNodeProcess(
    [kernelTsxCliPath, kernelServePath],
    undefined,
    kernelEnvironment,
    kernelRepoRoot,
  );
}

function shutdownAll() {
  for (const child of children) {
    if (!child.killed) {
      if (process.platform === 'win32' && child.pid) {
        try {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } catch {
          child.kill('SIGTERM');
        }
      } else {
        child.kill('SIGTERM');
      }
    }
  }
  devRuntimeCoordinator.cleanup();
  if (logicCredentialPath && fs.existsSync(logicCredentialPath)) {
    fs.unlinkSync(logicCredentialPath);
  }
  if (logicWorkspacePath && fs.existsSync(logicWorkspacePath)) {
    fs.rmdirSync(logicWorkspacePath);
  }
  if (
    logicCodexHomePath
    && logicCredentialDirectory
    && path.dirname(path.resolve(logicCodexHomePath)) === path.resolve(logicCredentialDirectory)
    && fs.existsSync(logicCodexHomePath)
  ) {
    const sessionSource = path.join(logicCodexHomePath, 'sessions');
    if (fs.existsSync(sessionSource)) {
      const archive = path.join(repoRoot, '.codex-usage', 'direct-codex-sessions', path.basename(logicCredentialDirectory));
      try {
        fs.mkdirSync(archive, { recursive: true });
        fs.cpSync(sessionSource, archive, { recursive: true, force: true });
      } catch (error) {
        console.warn('[dev-full] Could not archive local Codex session logs:', error);
      }
    }
    fs.rmSync(logicCodexHomePath, { recursive: true, force: true });
  }
  if (logicCredentialDirectory && fs.existsSync(logicCredentialDirectory)) {
    fs.rmdirSync(logicCredentialDirectory);
  }
}

// `--lan` exposes the dev server to devices on the same Wi-Fi (iPad/phone
// testing). `--lan=<ip>` pins an address; bare `--lan` picks the first
// private IPv4. The TLS pair in .certs/ must cover whichever address wins,
// so a DHCP move needs a regenerated certificate — vite.config.ts fails
// loudly when the pair is missing entirely.
function detectPrivateIpv4() {
  const candidates = Object.values(os.networkInterfaces())
    .flat()
    .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
    .map(entry => entry.address)
    .filter(address => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address));

  return candidates[0] ?? null;
}

function resolveLanHost() {
  const flag = process.argv.find(argument => argument === '--lan' || argument.startsWith('--lan='));
  if (!flag) {
    return null;
  }

  const explicit = flag.startsWith('--lan=') ? flag.slice('--lan='.length).trim() : '';
  const host = explicit || detectPrivateIpv4();
  if (!host) {
    throw new Error('[dev-full] --lan found no private IPv4 address. Pass one explicitly: --lan=192.168.x.x');
  }

  return host;
}

function startVite(lanHost) {
  const devVarsEnvironment = readDevVarsEnvironment();
  const hasLocalTelegramDevChat = Boolean(
    devVarsEnvironment.TELEGRAM_BOT_TOKEN?.trim()
      && devVarsEnvironment.TELEGRAM_DEV_CHAT_ID?.trim(),
  );
  const devChatProxyOrigin = process.env.MASTERSELECTS_DEV_CHAT_PROXY_ORIGIN?.trim()
    || devVarsEnvironment.MASTERSELECTS_PUBLIC_URL?.trim()
    || 'https://www.masterselects.com';
  const viteEnvironment = {
    ...(lanHost ? { MASTERSELECTS_LAN_HOST: lanHost } : {}),
    ...(logicAgentToken ? { MASTERSELECTS_DIRECT_CODEX_KERNEL_TOKEN: devVarsEnvironment.KERNEL_AUTH_TOKEN } : {}),
    ...(!hasLocalTelegramDevChat ? { MASTERSELECTS_DEV_CHAT_PROXY_ORIGIN: devChatProxyOrigin } : {}),
  };
  spawnNodeProcess(
    [ensureFileExists(viteCliPath)],
    undefined,
    viteEnvironment,
  );
}

function startApi() {
  spawnNodeProcess(
    [
      ensureFileExists(wranglerCliPath),
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
    ],
    () => {
      spawnNodeProcess([
        ensureFileExists(wranglerCliPath),
        'pages',
        'dev',
        '.',
        '--port',
        '8788',
        '--persist-to',
        '.wrangler/state',
      ]);
    },
    // Run the migration non-interactively. vite is spawned with the same
    // inherited stdin, so an interactive Y/n prompt here can never be
    // confirmed (vite steals the keypress). CI=true makes wrangler auto-apply.
    { CI: 'true' },
  );
}

process.on('SIGINT', () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  shutdownAll();
  process.exit(0);
});

ensureLocalDevVars();
if (process.argv.includes('--sync-secrets-only')) {
  process.exit(0);
}

try {
  assertKernelWorkspaceAvailable();
  const lanHost = resolveLanHost();
  await devRuntimeCoordinator.prepare();
  await startLogicAgent();
  const previousBridgeToken = readBridgeToken();
  startVite(lanHost);
  await waitForBridgeTokenRefresh(previousBridgeToken);
  if (lanHost) {
    console.log(`[dev-full] LAN testing enabled: https://${lanHost}:5173 (device needs the mkcert root CA installed and trusted).`);
  }
  startKernel();
  startApi();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  shuttingDown = true;
  shutdownAll();
  process.exit(1);
}
