import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordProcess, recover } from '../../scripts/windows-quality/worker.mjs';
import { SUPERVISION_PROTOCOL } from '../../scripts/windows-quality/supervision.mjs';

const evidenceRoot = new URL('./evidence/supervision/', import.meta.url);
await mkdir(evidenceRoot, { recursive: true });
const evidence = await mkdtemp(new URL('aq018-', evidenceRoot));
console.log(`Retained supervision contract evidence (NOT native qualification): ${evidence}`);
let index = 0;
async function directory() { const dir = path.join(evidence, String(++index)); await mkdir(dir); return dir; }
async function events(dir) {
  return Promise.all((await readdir(dir)).filter(f => /^\d{8}-/.test(f)).toSorted()
    .map(async f => JSON.parse(await readFile(path.join(dir, f), 'utf8'))));
}
const ownership = { runId: 'aq018-test', manifestSha256: 'a'.repeat(64),
  workspace: fileURLToPath(new URL('.', import.meta.url)),
  leaseId: 'test-lease', issuedBy: 'test-controller' };

// Simulated external service. Only optional harmless finite Node children; no kill API,
// descendants, native Job Objects, browser, UI, lease service or security proof.
function service({ realChild = false, changeReceipt = receipt => receipt, prepareDelay = 0 } = {}) {
  const calls = [], jobs = new Map();
  const adapter = {
    protocol: SUPERVISION_PROTOCOL,
    async prepare({ binding }) {
      calls.push('prepare');
      if (prepareDelay) await new Promise(resolve => setTimeout(resolve, prepareDelay));
      const prior = jobs.get(binding.ownershipId);
      if (prior?.sealed) throw new Error('Ownership sealed');
      const identity = { binding, serviceInstanceId: 'test-service-epoch', jobId: randomUUID() };
      jobs.set(binding.ownershipId, { identity, sealed: false });
      return identity;
    },
    async launch({ binding, identity, command }) {
      calls.push('launch');
      const job = jobs.get(binding.ownershipId);
      assert.equal(job.sealed, false);
      assert.deepEqual(job.identity, identity);
      const journal = await events(path.dirname(command.stdoutFile));
      assert.deepEqual(journal.find(e => e.type === 'supervision-prepared').identity, identity);
      if (!realChild) return { completion: new Promise(resolve => { job.resolve = resolve; }) };
      assert.equal(command.executable, process.execPath);
      const stdout = await open(command.stdoutFile, 'wx'), stderr = await open(command.stderrFile, 'wx');
      const child = spawn(command.executable, command.args, { cwd: command.cwd, env: command.env,
        shell: false, windowsHide: true, stdio: ['ignore', stdout.fd, stderr.fd] });
      job.completion = new Promise(resolve => {
        child.once('error', () => resolve({ exitCode: null }));
        child.once('close', exitCode => resolve({ exitCode }));
      }).finally(async () => { await stdout.close(); await stderr.close(); });
      return { completion: job.completion };
    },
    async stop({ binding }) {
      calls.push('stop');
      const job = jobs.get(binding.ownershipId) || { identity: { binding, serviceInstanceId: 'test-service-epoch', jobId: randomUUID() } };
      job.sealed = true; jobs.set(binding.ownershipId, job);
      job.resolve?.({ exitCode: null });
      await job.completion;
    },
    async verifyQuiescence({ binding, challenge }) {
      calls.push('verify');
      const job = jobs.get(binding.ownershipId);
      return changeReceipt({ binding, challenge, identity: job?.identity, verificationId: randomUUID(),
        observedAt: new Date().toISOString(), launchSealed: job?.sealed === true,
        ownedProcessesAbsent: true, ownedResourcesQuiescent: true });
    },
  };
  return { adapter, calls, jobs };
}
async function run(dir, adapter, options = {}) {
  return recordProcess({ directory: dir, executable: process.execPath,
    args: ['-e', 'console.log("harmless-owned-child"); setTimeout(() => {}, 40)'],
    cwd: dir, env: {}, maxRuntimeMs: 2000, heartbeatMs: 10,
    ownership, trustedSupervisor: adapter, ...options });
}

test('real harmless Node child uses injected launch after synced identity; root exit separately verified', async () => {
  const dir = await directory(), { adapter, calls } = service({ realChild: true });
  const result = await run(dir, adapter);
  assert.equal(result.exitCode, 0); assert.equal(result.interrupted, undefined);
  assert.equal(result.quiescence.launchSealed, true);
  assert.deepEqual(calls, ['prepare', 'launch', 'stop', 'verify']);
  assert.match(await readFile(path.join(dir, 'stdout.log'), 'utf8'), /harmless-owned-child/);
  const journal = await events(dir);
  assert.equal(journal[0].type, 'supervision-intent');
  assert.equal(journal.at(-1).type, 'process-exited');
});

test('deadline requests supervisor stop, records quiescence, preserves interrupted verdict', async () => {
  const dir = await directory(), { adapter, calls } = service();
  const result = await run(dir, adapter, { maxRuntimeMs: 50 });
  assert.equal(result.interrupted, true); assert.match(result.reason, /deadline/);
  assert.ok(result.quiescence); assert.deepEqual(calls, ['prepare', 'launch', 'stop', 'verify']);
});

test('controller abort revokes running ownership; pre-aborted signal never launches', async () => {
  for (const preAborted of [false, true]) {
    const dir = await directory(), { adapter, calls } = service(), controller = new AbortController();
    if (preAborted) controller.abort();
    const timer = preAborted ? null : setTimeout(() => controller.abort(), 40);
    const result = await run(dir, adapter, { signal: controller.signal }); clearTimeout(timer);
    assert.equal(result.interrupted, true); assert.match(result.reason, /revoked/);
    assert.ok(calls.includes('stop')); assert.equal(calls.includes('launch'), !preAborted);
  }
});

test('failed authority polling stops ownership and cannot return successful campaign state', async () => {
  const dir = await directory(), { adapter, calls } = service(); let checks = 0;
  const result = await run(dir, adapter, { checkAuthority: async () => { if (++checks >= 3) throw new Error('lease revoked'); } });
  assert.equal(result.interrupted, true); assert.match(result.reason, /lease revoked/); assert.ok(calls.includes('stop'));
});

for (const [name, mutate] of [
  ['root exit alone', r => ({ ...r, ownedProcessesAbsent: false })],
  ['resource leak', r => ({ ...r, ownedResourcesQuiescent: false })],
  ['unsealed launch', r => ({ ...r, launchSealed: false })],
  ['replayed challenge', r => ({ ...r, challenge: 'old' })],
  ['stale observation', r => ({ ...r, observedAt: '2000-01-01T00:00:00.000Z' })],
  ['wrong ownership', r => ({ ...r, binding: { ...r.binding, ownershipId: 'other' } })],
  ['wrong service epoch', r => ({ ...r, identity: { ...r.identity, serviceInstanceId: 'other' } })],
]) test(`quiescence rejects ${name}`, async () => {
  const dir = await directory(), { adapter } = service({ realChild: true, changeReceipt: mutate });
  const result = await run(dir, adapter);
  assert.equal(result.interrupted, true); assert.equal(result.quiescence, undefined);
});

test('late prepare is fenced by stop after deadline; no late launch', async () => {
  const dir = await directory(), { adapter, calls } = service({ prepareDelay: 90 });
  const result = await run(dir, adapter, { maxRuntimeMs: 25 });
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(result.interrupted, true); assert.equal(calls.includes('launch'), false);
  assert.ok(result.quiescence);
});

test('missing/malformed injected adapter never silently falls back to spawn', async () => {
  const dir = await directory();
  await assert.rejects(run(dir, {}), /trusted owned-process/);
  assert.deepEqual(await readdir(dir), []);
});

test('supervisor outage and malformed identity remain interrupted, without direct launch', async () => {
  for (const mode of ['outage', 'identity']) {
    const dir = await directory(), { adapter, calls } = service();
    adapter.prepare = async () => { if (mode === 'outage') throw new Error('offline'); return { pid: process.pid }; };
    const result = await run(dir, adapter);
    assert.equal(result.interrupted, true); assert.equal(calls.includes('launch'), false);
    assert.ok(calls.includes('stop'));
  }
});

test('hung supervisor RPC is bounded and leaves unresolved cleanup interrupted', async () => {
  const dir = await directory(), { adapter } = service();
  adapter.stop = () => new Promise(() => {});
  const result = await run(dir, adapter, { maxRuntimeMs: 25, rpcTimeoutMs: 30 });
  assert.equal(result.interrupted, true); assert.match(result.reason, /RPC timeout/);
  assert.equal(result.quiescence, undefined);
});

test('restart recovery freshly verifies durable identity but never clears or permits launch', async () => {
  const root = await directory(), lock = path.join(root, 'desktop-claim'); await mkdir(lock);
  const { adapter, calls } = service({ realChild: true }); await run(lock, adapter);
  const journal = await events(lock), before = JSON.stringify(journal);
  const defaultResult = await recover(root); assert.equal(defaultResult.mayLaunch, false);
  const result = await recover(root, { trustedSupervisor: adapter });
  assert.equal(result.status, 'quiescent-awaiting-controller'); assert.equal(result.mayLaunch, false);
  assert.equal(result.reconciliationReady, true);
  assert.equal(calls.filter(c => c === 'verify').length, 2);
  assert.equal(JSON.stringify(await events(lock)), before);
  await assert.rejects(mkdir(lock), { code: 'EEXIST' });
  adapter.verifyQuiescence = async () => { throw new Error('external verifier offline'); };
  assert.equal((await recover(root, { trustedSupervisor: adapter })).reconciliationReady, false);
});
