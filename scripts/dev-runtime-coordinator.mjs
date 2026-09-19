import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

function wait(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeFileIfPresent(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function terminateProcessTree(pid) {
  if (!isProcessRunning(pid)) return;
  if (process.platform === 'win32') {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  process.kill(pid, 'SIGTERM');
}

function findLegacyWindowsDevFullRoots(repoRoot) {
  if (process.platform !== 'win32') return [];
  const escapedRepoRoot = repoRoot.replace(/'/g, "''");
  const script = `
$repoRoot = '${escapedRepoRoot}'
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
$candidates = @($processes | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[\\\\/]+dev-full\\.mjs'
})
$roots = @()
foreach ($candidate in $candidates) {
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $queue.Enqueue([int]$candidate.ProcessId)
  $seen = @{}
  $ownsMasterSelectsChild = $false
  while ($queue.Count -gt 0) {
    $parentPid = $queue.Dequeue()
    if ($seen.ContainsKey($parentPid)) { continue }
    $seen[$parentPid] = $true
    foreach ($child in @($processes | Where-Object ParentProcessId -eq $parentPid)) {
      $queue.Enqueue([int]$child.ProcessId)
      $line = [string]$child.CommandLine
      if ($line -like "*$repoRoot*" -and (
        $line -like '*node_modules\\vite\\bin\\vite.js*' -or
        $line -like '*node_modules\\wrangler\\bin\\wrangler.js*'
      )) {
        $ownsMasterSelectsChild = $true
      }
    }
  }
  if ($ownsMasterSelectsChild) { $roots += [int]$candidate.ProcessId }
}
@($roots | Sort-Object -Unique) | ConvertTo-Json -Compress
`;
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(Number.isInteger);
  } catch {
    return [];
  }
}

async function isTcpPortListening(port) {
  return new Promise((resolvePromise) => {
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
}

export function createDevRuntimeCoordinator({ repoRoot, servicePorts, onStopRequested }) {
  const normalizedRepoRoot = process.platform === 'win32' ? repoRoot.toLowerCase() : repoRoot;
  const runtimeKey = crypto
    .createHash('sha256')
    .update(normalizedRepoRoot)
    .digest('hex')
    .slice(0, 16);
  const runtimeDirectory = path.join(os.tmpdir(), `masterselects-dev-full-${runtimeKey}`);
  const statePath = path.join(runtimeDirectory, 'state.json');
  const stopRequestPath = path.join(runtimeDirectory, 'stop-request');
  let ownsState = false;
  let stopRequestTimer = null;

  function readState() {
    if (!fs.existsSync(statePath)) return null;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const stateRepoRoot = process.platform === 'win32'
        ? state?.repoRoot?.toLowerCase()
        : state?.repoRoot;
      return stateRepoRoot === normalizedRepoRoot && Number.isInteger(state?.pid) ? state : null;
    } catch {
      return null;
    }
  }

  function cleanup() {
    if (stopRequestTimer) {
      clearInterval(stopRequestTimer);
      stopRequestTimer = null;
    }
    if (!ownsState) return;
    const state = readState();
    if (state?.pid === process.pid) {
      removeFileIfPresent(statePath);
      removeFileIfPresent(stopRequestPath);
    }
    ownsState = false;
  }

  async function waitForProcessExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isProcessRunning(pid)) return true;
      await wait(100);
    }
    return !isProcessRunning(pid);
  }

  async function requestManagedShutdown(state) {
    if (!state || state.pid === process.pid || !isProcessRunning(state.pid)) return;
    console.log(`[dev-full] Existing MasterSelects dev stack found (PID ${state.pid}); requesting clean shutdown...`);
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    fs.writeFileSync(stopRequestPath, `${process.pid}\n`, 'utf8');
    if (await waitForProcessExit(state.pid, 8_000)) return;

    console.warn('[dev-full] Previous stack did not stop within 8 seconds; terminating its verified process tree.');
    terminateProcessTree(state.pid);
    await waitForProcessExit(state.pid, 3_000);
  }

  async function getBusyPorts() {
    const states = await Promise.all(servicePorts.map(async port => ({
      port,
      busy: await isTcpPortListening(port),
    })));
    return states.filter(state => state.busy).map(state => state.port);
  }

  async function waitForPortsToClose(timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    let busyPorts = await getBusyPorts();
    while (busyPorts.length > 0 && Date.now() < deadline) {
      await wait(100);
      busyPorts = await getBusyPorts();
    }
    return busyPorts;
  }

  function claimState() {
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    removeFileIfPresent(stopRequestPath);
    fs.writeFileSync(statePath, JSON.stringify({
      pid: process.pid,
      repoRoot,
      startedAt: new Date().toISOString(),
    }), { encoding: 'utf8', flag: 'wx' });
    ownsState = true;
    stopRequestTimer = setInterval(() => {
      if (fs.existsSync(stopRequestPath)) onStopRequested();
    }, 200);
  }

  async function prepare() {
    fs.mkdirSync(runtimeDirectory, { recursive: true });
    const existingState = readState();
    if (existingState && existingState.pid !== process.pid) {
      await requestManagedShutdown(existingState);
    }

    if (!existingState || !isProcessRunning(existingState.pid)) {
      removeFileIfPresent(statePath);
      removeFileIfPresent(stopRequestPath);
    }

    const legacyRoots = findLegacyWindowsDevFullRoots(repoRoot).filter(pid => pid !== process.pid);
    for (const pid of legacyRoots) {
      console.log(`[dev-full] Existing legacy MasterSelects dev stack found (PID ${pid}); stopping its verified process tree...`);
      try {
        terminateProcessTree(pid);
      } catch {
        if (isProcessRunning(pid)) {
          throw new Error(`[dev-full] Could not stop the existing MasterSelects dev stack (PID ${pid}).`);
        }
      }
    }

    const busyPorts = await waitForPortsToClose();
    if (busyPorts.length > 0) {
      throw new Error(
        `[dev-full] Cannot start because port${busyPorts.length === 1 ? '' : 's'} ${busyPorts.join(', ')} ` +
        'remain occupied by a process that was not verified as this MasterSelects dev stack.',
      );
    }

    claimState();
  }

  return { cleanup, prepare };
}
