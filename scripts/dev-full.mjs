import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExePath = process.execPath;
const nodeBinDir = path.dirname(nodeExePath);
const viteCliPath = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const wranglerCliPath = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const devVarsPath = path.join(repoRoot, '.dev.vars');
const localWorkerSecretKeys = [
  'OPENAI_API_KEY',
  'KIEAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'ANTHROPIC_API_KEY',
  'PIAPI_API_KEY',
];
const children = [];
let shuttingDown = false;

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

  const syncedKeys = [];

  for (const key of localWorkerSecretKeys) {
    const value = getLocalWorkerSecretValue(key);
    if (!value) {
      continue;
    }

    if (upsertDevVar(lines, key, value)) {
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

function spawnNodeProcess(args, onSuccess) {
  const child = spawn(nodeExePath, args, {
    cwd: repoRoot,
    shell: false,
    stdio: 'inherit',
    env: childEnv,
  });

  registerChild(child, onSuccess);
}

function shutdownAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

function startVite() {
  spawnNodeProcess([ensureFileExists(viteCliPath)]);
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
startVite();
startApi();
