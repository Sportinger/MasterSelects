import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CASES, SOURCE, exactPath, hashFile, inventory, writeOnce, validateReport, verifyCorpus, workspaceReceipt, verifyManifest } from '../../scripts/windows-quality/campaign.mjs';
import { event, probePid, validateGrant, recordProcess, recover, childEnvironment } from '../../scripts/windows-quality/worker.mjs';
import { validateEvidence } from '../../scripts/windows-quality/evidence.mjs';
import { corpusFixture } from './corpus-fixture.mjs';

const root = new URL('./evidence/adapter/', import.meta.url);
await mkdir(root, { recursive: true });
const evidence = await mkdtemp(new URL('adapter-', root));
console.log(`Retained adapter test evidence: ${evidence}`);
let index = 0;
async function directory() { const dir = path.join(evidence, String(++index)); await mkdir(dir); return dir; }
function report() {
  return { errors: [], stats: { expected: 8, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ title: 'root', suites: [{ specs: CASES.map(c => ({ title: c.title, file: c.file, ok: true,
      tests: [{ projectName: c.project, expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }] })) }] }] };
}
const specs = r => r.suites[0].suites[0].specs;

test('exact pinned Git fixture matches qualified eight-test corpus', async () => {
  await verifyCorpus(await corpusFixture());
  assert.equal(CASES.length, 8);
  assert.throws(() => { CASES[0].title = 'weaken'; }, TypeError);
});
test('exact report passes, retained JSON is parsed from real filesystem', async () => {
  const dir = await directory(), file = path.join(dir, 'results.json');
  await writeOnce(file, report());
  assert.equal(validateReport(JSON.parse(await readFile(file, 'utf8')), 0).verdict, 'passed');
});
for (const [name, mutate] of [
  ['missing', r => specs(r).pop()],
  ['duplicate', r => specs(r).push(structuredClone(specs(r)[0]))],
  ['wrong identity', r => specs(r)[0].title = 'different'],
  ['wrong project', r => specs(r)[0].tests[0].projectName = 'other'],
  ['skipped', r => specs(r)[0].tests[0].results[0].status = 'skipped'],
  ['flaky retry', r => { specs(r)[0].tests[0].status = 'flaky'; specs(r)[0].tests[0].results.unshift({ status: 'failed', retry: 0 }); }],
  ['hidden retry', r => specs(r)[0].tests[0].results[0].retry = 1],
  ['expected failure', r => specs(r)[0].tests[0].expectedStatus = 'failed'],
  ['empty results', r => specs(r)[0].tests[0].results = []],
  ['global teardown failure', r => r.errors.push({ message: 'cleanup failed' })],
  ['incomplete stats', r => delete r.stats],
  ['masked error', r => specs(r)[0].tests[0].results[0].errors.push({ message: 'failed' })],
]) test(`report rejects ${name}`, () => {
  const r = report(); mutate(r); assert.equal(validateReport(r, 0).verdict, 'failed');
});
test('missing report and nonzero/null exits never green', () => {
  assert.equal(validateReport(null, 0).verdict, 'infrastructure-error');
  for (const code of [1, null]) assert.equal(validateReport(report(), code).verdict, 'failed');
});
test('write-once manifest cannot overwrite prior bytes, digest detects mutation', async () => {
  const dir = await directory(), file = path.join(dir, 'manifest.json');
  await writeOnce(file, { sourceHash: SOURCE }); const original = await hashFile(file);
  await assert.rejects(writeOnce(file, { changed: true }), { code: 'EEXIST' });
  assert.equal(await hashFile(file), original);
  await writeFile(file, '{}');
  await assert.rejects(verifyManifest(file, original), /digest mismatch/);
});
test('unknown or shared dependency workspace fails without starting anything', async () => {
  await assert.rejects(workspaceReceipt({ workspace: process.cwd() }), /explicit isolated/);
  const dir = await directory();
  await assert.rejects(workspaceReceipt({ workspace: dir, isolated: true, sourceHash: SOURCE, workspaceId: 'test' }), { code: 'ENOENT' });
});
test('inventory records byte changes and additions; junctions are refused', async () => {
  const dir = await directory(); await mkdir(path.join(dir, 'source'));
  await writeFile(path.join(dir, 'source/a.txt'), 'before');
  const before = await inventory(dir, 'source');
  await writeFile(path.join(dir, 'source/a.txt'), 'after');
  await writeFile(path.join(dir, 'source/b.txt'), 'new');
  const after = await inventory(dir, 'source'); assert.equal(after.length, 2); assert.notEqual(before[0].sha256, after[0].sha256);
  await symlink(path.join(dir, 'source'), path.join(dir, 'linked'), 'junction');
  await assert.rejects(exactPath(path.join(dir, 'linked')), /Reparse|symlink/);
});
test('explicit lease binds machine, workspace, manifest, time and cleanup authority', () => {
  const manifest = { workspace: process.cwd() }, hash = 'a'.repeat(64);
  const grant = { exclusive: true, desktopAvailable: true, allowOwnedBrowserCleanup: true,
    resource: 'windows-interactive-desktop', hostname: os.hostname(), workspace: process.cwd(), manifestSha256: hash,
    leaseId: 'exclusive-1', issuedBy: 'trusted-test-controller', notBefore: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
  validateGrant(grant, manifest, hash);
  for (const change of [{ exclusive: false }, { desktopAvailable: false }, { allowOwnedBrowserCleanup: false },
    { hostname: 'other' }, { workspace: 'other' }, { manifestSha256: 'other' }, { expiresAt: 'bad' }, { expiresAt: '2000-01-01' }]) {
    assert.throws(() => validateGrant({ ...grant, ...change }, manifest, hash), /grant required/);
  }
  assert.throws(() => validateGrant(undefined, manifest, hash), /grant required/);
});
test('real child failure, heartbeat, stdout and stderr survive recorder restart', async () => {
  const dir = await directory();
  const result = await recordProcess({ directory: dir, executable: process.execPath,
    args: ['-e', 'console.log("failure-evidence"); console.error("outage-evidence"); setTimeout(() => process.exit(7), 140)'],
    cwd: dir, env: {}, maxRuntimeMs: 5000, heartbeatMs: 20 });
  assert.equal(result.exitCode, 7);
  assert.match(await readFile(path.join(dir, 'stdout.log'), 'utf8'), /failure-evidence/);
  assert.match(await readFile(path.join(dir, 'stderr.log'), 'utf8'), /outage-evidence/);
  assert.ok((await readdir(dir)).some(file => file.includes('heartbeat')));
  const startedFile = (await readdir(dir)).find(file => file.includes('process-started'));
  const started = JSON.parse(await readFile(path.join(dir, startedFile), 'utf8'));
  assert.equal(probePid(started.child), 'absent');
});
test('spawn outage is durably nonzero/unknown, never successful', async () => {
  const dir = await directory();
  const result = await recordProcess({ directory: dir, executable: path.join(dir, 'missing.exe'), args: [], cwd: dir, env: {}, maxRuntimeMs: 1000 });
  assert.equal(result.exitCode, null); assert.match(result.error, /ENOENT/);
});
test('deadline preserves interrupted state without killing live child', async () => {
  const dir = await directory();
  const result = await recordProcess({ directory: dir, executable: process.execPath,
    args: ['-e', 'setTimeout(() => { console.log("survived-deadline"); }, 160)'], cwd: dir, env: {}, maxRuntimeMs: 50, heartbeatMs: 15 });
  assert.equal(result.interrupted, true);
  await new Promise(resolve => setTimeout(resolve, 260));
  assert.match(await readFile(path.join(dir, 'stdout.log'), 'utf8'), /survived-deadline/);
});
test('unknown live handle blocks recovery and never steals claim; evidence retained', async () => {
  const dir = await directory(), lock = path.join(dir, 'desktop-claim'); await mkdir(lock);
  await event(lock, 'process-started', { supervisor: { hostname: os.hostname(), pid: process.pid }, child: { hostname: os.hostname(), pid: process.pid } });
  await writeOnce(path.join(lock, 'verdict.json'), { verdict: 'failed', reason: 'receiver offline' });
  const original = await hashFile(path.join(lock, 'verdict.json'));
  const result = await recover(dir);
  assert.equal(result.status, 'blocked'); assert.equal(result.mayLaunch, false);
  assert.equal(result.childState, 'live-identity-unverified');
  assert.equal(await hashFile(path.join(lock, 'verdict.json')), original);
  await assert.rejects(mkdir(lock), { code: 'EEXIST' });
  assert.equal(probePid({ hostname: 'unreachable-machine', pid: process.pid }), 'unknown');
});
test('crash window with no child identity and corrupt journal remain blocked', async () => {
  const dir = await directory(), lock = path.join(dir, 'desktop-claim'); await mkdir(lock);
  assert.equal((await recover(dir)).mayLaunch, false);
  await writeFile(path.join(lock, '00000001-launch-intent.json'), '{truncated');
  const result = await recover(dir); assert.equal(result.status, 'blocked'); assert.match(result.reason, /Unreadable/);
});
test('process environment forwards no arbitrary parent settings or secrets', () => {
  const env = childEnvironment('campaign-output');
  assert.equal(env.MS_BETA_OUTPUT, 'campaign-output');
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.MASTERSELECTS_BRIDGE_TOKEN_FILE, undefined);
});
test('successful test status without required beta artifacts fails evidence completeness', async () => {
  const result = await validateEvidence(report(), await directory());
  assert.equal(result.complete, false); assert.ok(result.problems.some(p => p.includes('frame-sequence')));
});
test('artifact hashes survive receiver outage; missing/external paths rejected', async () => {
  const dir = await directory(), artifact = path.join(dir, 'artifact.txt');
  await writeFile(artifact, 'synthetic artifact, not browser evidence');
  const r = report();
  const names = ['hardware', 'active-gpu', 'media-provenance', 'download-name', 'export-path', 'export-verification',
    'audio-verification', 'export', 'frame-sequence', 'export-playback', 'final-runtime', 'cleanup', 'trace'];
  for (const spec of specs(r)) spec.tests[0].results[0].attachments = names.map(name => ({ name, path: artifact }));
  const good = await validateEvidence(r, dir); assert.equal(good.complete, true);
  assert.equal(good.records[0].sha256, await hashFile(artifact));
  specs(r)[0].tests[0].results[0].attachments[0].path = path.join(dir, 'missing.txt');
  assert.equal((await validateEvidence(r, dir)).complete, false);
  specs(r)[0].tests[0].results[0].attachments[0].path = path.join(dir, '..', 'outside.txt');
  assert.ok((await validateEvidence(r, dir)).problems.some(p => p.includes('outside campaign')));
});
test('fresh recovery process reads prior interrupted state without relaunching child', async () => {
  const dir = await directory(), lock = path.join(dir, 'desktop-claim'); await mkdir(lock);
  const writer = await directory();
  const moduleUrl = new URL('../../scripts/windows-quality/worker.mjs', import.meta.url).href;
  const code = `import { event } from ${JSON.stringify(moduleUrl)}; import os from 'node:os'; await event(${JSON.stringify(lock)}, 'launch-intent', { supervisor: { hostname: os.hostname(), pid: process.pid } });`;
  assert.equal((await recordProcess({ directory: writer, executable: process.execPath,
    args: ['--input-type=module', '-e', code], cwd: dir, env: {}, maxRuntimeMs: 5000 })).exitCode, 0);
  const recoveryDir = await directory();
  const recoveryCode = `import { recover } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await recover(${JSON.stringify(dir)})));`;
  assert.equal((await recordProcess({ directory: recoveryDir, executable: process.execPath,
    args: ['--input-type=module', '-e', recoveryCode], cwd: dir, env: {}, maxRuntimeMs: 5000 })).exitCode, 0);
  const recovered = JSON.parse(await readFile(path.join(recoveryDir, 'stdout.log'), 'utf8'));
  assert.equal(recovered.status, 'interrupted'); assert.equal(recovered.mayLaunch, false);
  assert.equal(recovered.childState, 'unknown');
  assert.ok((await readdir(lock)).some(f => f.startsWith('recovery-')));
});
