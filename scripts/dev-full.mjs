import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeExePath = process.execPath;
const nodeBinDir = path.dirname(nodeExePath);
const viteCliPath = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const wranglerCliPath = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
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

startVite();
startApi();
