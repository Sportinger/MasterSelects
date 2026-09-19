import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { CASES, exactPath, hashFile, verifyManifest, validateReport, writeOnce } from './campaign.mjs';
import { validateEvidence } from './evidence.mjs';
import { recordSupervisedProcess, validateSupervisor, verifyOwnedQuiescence } from './supervision.mjs';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function event(directory, type, data = {}) {
  const entries = (await readdir(directory)).filter(f => /^\d{8}-.*\.json$/.test(f)).toSorted();
  const sequence = entries.length ? Number(entries.at(-1).slice(0, 8)) + 1 : 1;
  await writeOnce(path.join(directory, `${String(sequence).padStart(8, '0')}-${type}.json`),
    { sequence, type, at: new Date().toISOString(), ...data });
}
export function probePid(identity) {
  if (identity?.hostname !== os.hostname() || !Number.isSafeInteger(identity?.pid) || identity.pid <= 0) return 'unknown';
  try { process.kill(identity.pid, 0); return 'live-identity-unverified'; }
  catch (error) { return error.code === 'ESRCH' ? 'absent' : 'unknown'; }
}
export function validateGrant(grant, manifest, digest, now = Date.now()) {
  if (grant?.exclusive !== true || grant?.desktopAvailable !== true || grant?.allowOwnedBrowserCleanup !== true ||
      grant?.resource !== 'windows-interactive-desktop' || grant?.hostname !== os.hostname() ||
      grant?.workspace !== manifest.workspace || grant?.manifestSha256 !== digest ||
      !grant?.leaseId || !grant?.issuedBy || !Number.isFinite(Date.parse(grant.expiresAt)) ||
      Date.parse(grant.expiresAt) <= now || Date.parse(grant.notBefore) > now || !Number.isFinite(Date.parse(grant.notBefore))) {
    throw new Error('Explicit current exclusive desktop grant required (including existing owned-browser cleanup)');
  }
}
async function portAvailable() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(4187, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}
// Deliberately no inherited provider credentials, NODE_OPTIONS, grep or reporter overrides.
export function childEnvironment(output) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC', 'PATHEXT']) {
    const key = Object.keys(process.env).find(k => k.toLowerCase() === name.toLowerCase());
    if (key) env[key] = process.env[key];
  }
  return { ...env, MS_BETA_OUTPUT: output, CI: '1' };
}
// Small reusable process recorder, not a replacement test runner. Production command is fixed below.
export async function recordProcess({ directory, executable, args, cwd, env, maxRuntimeMs, heartbeatMs = 1000,
  trustedSupervisor, ownership, signal, checkAuthority, rpcTimeoutMs }) {
  if (!Number.isSafeInteger(maxRuntimeMs) || maxRuntimeMs < 1) throw new Error('Finite runtime budget required');
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 1) throw new Error('Finite heartbeat interval required');
  if (trustedSupervisor !== undefined) {
    validateSupervisor(trustedSupervisor);
    return recordSupervisedProcess({ adapter: trustedSupervisor, ownership,
      command: { executable, args, cwd, env, stdoutFile: path.join(directory, 'stdout.log'),
        stderrFile: path.join(directory, 'stderr.log'), windowsHide: true, shell: false },
      maxRuntimeMs, heartbeatMs, signal, checkAuthority, rpcTimeoutMs,
      emit: (type, data) => event(directory, type, data) });
  }
  const stdout = await open(path.join(directory, 'stdout.log'), 'wx');
  const stderr = await open(path.join(directory, 'stderr.log'), 'wx');
  let child, timer, deadline, leaseError;
  const identity = { hostname: os.hostname(), pid: process.pid, nonce: randomUUID(), startedAt: new Date().toISOString(), executable: process.execPath };
  await event(directory, 'launch-intent', { supervisor: identity, executable, args, cwd });
  try {
    child = spawn(executable, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', stdout.fd, stderr.fd] });
    const outcome = new Promise(resolve => {
      child.once('error', error => resolve({ exitCode: null, error: String(error) }));
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    await event(directory, 'process-started', { supervisor: identity,
      child: { hostname: os.hostname(), pid: child.pid ?? null, observedAt: new Date().toISOString(), executable, args,
        identityStrength: 'direct-child-handle-only; persisted PID is never termination authority' } });
    let chain = Promise.resolve();
    timer = setInterval(() => {
      chain = chain.then(() => event(directory, 'heartbeat', { supervisor: identity, childPid: child.pid }))
        .catch(error => { leaseError = String(error); });
    }, heartbeatMs);
    // Do not kill a process tree based on a PID. Deadline retains ownership until external reconciliation.
    const timeout = new Promise(resolve => { deadline = setTimeout(() => resolve({ exitCode: null, interrupted: true,
      reason: 'Runtime/grant deadline; process may still be live, exclusive resource remains held' }), maxRuntimeMs); });
    const result = await Promise.race([outcome, timeout]);
    clearInterval(timer); clearTimeout(deadline); await chain;
    if (leaseError) { result.interrupted = true; result.reason = `Heartbeat persistence failed: ${leaseError}`; }
    if (result.interrupted) child.unref();
    await event(directory, result.interrupted ? 'interrupted' : 'process-exited', result);
    return result;
  } finally { clearInterval(timer); clearTimeout(deadline); await stdout.close(); await stderr.close(); }
}
export async function runCampaign({ manifestFile, manifestSha256, grantFile, stateRoot, runId, maxRuntimeMs },
  { trustedSupervisor, signal } = {}) {
  if (trustedSupervisor !== undefined) validateSupervisor(trustedSupervisor);
  if (process.platform !== 'win32') throw new Error('Windows worker required');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId || '')) throw new Error('Safe unique runId required');
  const manifest = await verifyManifest(manifestFile, manifestSha256);
  const grant = await json(grantFile); validateGrant(grant, manifest, manifestSha256);
  if (!Number.isSafeInteger(maxRuntimeMs) || maxRuntimeMs < 1 || Date.now() + maxRuntimeMs > Date.parse(grant.expiresAt)) throw new Error('Runtime must fit exclusive grant');
  // stateRoot is caller-owned, machine-wide, shared by all adapters (never per-attempt).
  const root = await exactPath(stateRoot);
  const lock = path.join(root, 'desktop-claim');
  await mkdir(lock); // EEXIST always blocks; stale age is never permission to steal.
  await event(lock, 'claimed', { runId, manifestSha256, grant, supervisor: { hostname: os.hostname(), pid: process.pid } });
  try {
    await portAvailable();
    const betaRoot = path.join(manifest.workspace, 'output/windows-beta');
    await mkdir(betaRoot, { recursive: true }); await exactPath(betaRoot);
    const output = path.join(betaRoot, `aq-${runId}`);
    await mkdir(output); await exactPath(output);
    await writeOnce(path.join(lock, 'run.json'), { runId, output, manifestFile: path.resolve(manifestFile), manifestSha256 });
    await writeOnce(path.join(output, 'manifest.json'), manifest);
    await event(lock, 'running', { output });
    validateGrant(await json(grantFile), manifest, manifestSha256);
    const outcome = await recordProcess({ directory: lock, executable: process.execPath,
      args: [path.join(manifest.workspace, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.beta.config.ts'],
      cwd: manifest.workspace, env: childEnvironment(output), maxRuntimeMs: Math.min(maxRuntimeMs, Date.parse(grant.expiresAt) - Date.now()),
      trustedSupervisor, signal,
      ownership: { runId, manifestSha256, workspace: manifest.workspace, leaseId: grant.leaseId, issuedBy: grant.issuedBy },
      checkAuthority: async () => {
        const current = await json(grantFile);
        validateGrant(current, manifest, manifestSha256);
        if (current.revoked === true || !isDeepStrictEqual(current, grant)) throw new Error('Pinned desktop grant changed/revoked');
      } });
    let verdict;
    if (outcome.interrupted) verdict = { verdict: 'interrupted', problems: [outcome.reason], cases: CASES.map(c => ({ ...c, verdict: 'unknown' })) };
    else {
      try {
        await verifyManifest(manifestFile, manifestSha256);
        const reportFile = path.join(output, 'results.json');
        const report = await json(reportFile);
        verdict = { ...validateReport(report, outcome.exitCode), reportSha256: await hashFile(reportFile) };
        const evidence = await validateEvidence(report, output);
        await writeOnce(path.join(lock, 'evidence-index.json'), evidence);
        if (!evidence.complete) {
          verdict.verdict = 'failed'; verdict.problems.push(...evidence.problems);
        }
      } catch (error) { verdict = { verdict: 'infrastructure-error', problems: [String(error)], cases: CASES.map(c => ({ ...c, verdict: 'unknown' })) }; }
    }
    await writeOnce(path.join(lock, 'verdict.json'), { runId, manifestSha256, ...verdict, outcome });
    await event(lock, 'awaiting-resource-reconciliation', { verdict: verdict.verdict });
    return verdict;
  } catch (error) {
    await event(lock, 'blocked', { reason: String(error) });
    throw error;
  }
}
export async function recover(stateRoot, { trustedSupervisor } = {}) {
  const root = await exactPath(stateRoot), lock = path.join(root, 'desktop-claim');
  await exactPath(lock);
  const files = (await readdir(lock)).filter(f => /^\d{8}-.*\.json$/.test(f)).toSorted();
  const events = [];
  for (const file of files) {
    try { events.push(await json(path.join(lock, file))); }
    catch { return { status: 'blocked', reason: `Unreadable durable event: ${file}; retain claim`, mayLaunch: false }; }
  }
  if (trustedSupervisor !== undefined) {
    // Read-only external verification. Never stop from recovery, steal, archive or relaunch.
    const intent = events.findLast(e => e.type === 'supervision-intent');
    const prepared = events.findLast(e => e.type === 'supervision-prepared');
    let result;
    try {
      if (!intent) throw new Error('No durable supervised ownership; PID state is insufficient');
      const quiescence = await verifyOwnedQuiescence(trustedSupervisor, intent.binding, prepared?.identity ?? null);
      result = { status: 'quiescent-awaiting-controller', mayLaunch: false, reconciliationReady: true, quiescence,
        reason: 'External quiescence verified; controller must archive evidence and issue fresh authority' };
    } catch (error) { result = { status: 'blocked', mayLaunch: false, reconciliationReady: false, reason: String(error) }; }
    await writeOnce(path.join(lock, `recovery-${randomUUID()}.json`), { at: new Date().toISOString(), ...result });
    return result;
  }
  const started = events.findLast(e => e.type === 'process-started');
  const supervisor = started?.supervisor || events[0]?.supervisor;
  const supervisorState = probePid(supervisor), childState = probePid(started?.child);
  // Read-only recovery cannot race with a live recorder or pretend descendants are gone.
  const result = { status: supervisorState === 'absent' ? 'interrupted' : 'blocked', mayLaunch: false,
    supervisorState, childState, lastEvent: events.at(-1)?.type ?? 'empty-claim',
    reason: 'Retain all evidence and claim. External supervisor must prove desktop/process-tree quiescence before archiving claim; never auto-retry.' };
  await writeOnce(path.join(lock, `recovery-${randomUUID()}.json`), { at: new Date().toISOString(), ...result });
  return result;
}
