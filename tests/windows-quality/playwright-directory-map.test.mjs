import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CASES, SOURCE, CORPUS, verifyCorpus } from '../../scripts/windows-quality/campaign.mjs';
import { qualifyDirectoryMap, loadQualifiedAlgorithm, assertReceiptBinding, sha256 } from '../../scripts/windows-quality/playwright-directory-map.mjs';

const root = path.resolve('.');
const runtimeRoot = process.env.AQ048_RUNTIME_ROOT;
if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) throw new Error('AQ048_RUNTIME_ROOT must pin the read-only runtime checkout');
const evidence = path.join(root, 'output/aq048');
await mkdir(evidence, { recursive: true });
const corpus = JSON.parse(await readFile('scripts/windows-quality/baseline-corpus.git-v2.json'));
const manifest = { schema: 1, campaign: 'existing-windows-beta-eight-v2', planRevision: 'AQ-R3',
  sourceHash: SOURCE, workspace: runtimeRoot, cases: CASES, corpus: await verifyCorpus(runtimeRoot),
  inputs: corpus.inputs, command: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.beta.config.ts'],
  constraints: { workers: 1, retries: 0, port: 4187, nativeDesktop: true, ownsBrowserCleanup: true } };
// Mapping-only manifest fixture: not a freezeCampaign receipt or source/hardware attestation.
function input(m = manifest, runId = 'AQ048-mapping-only') {
  const manifestBytes = Buffer.from(JSON.stringify(m));
  const manifestSha256 = sha256(manifestBytes);
  return { manifestBytes, manifestSha256, runtimeRoot,
    binding: { workspace: m.workspace, runOutput: path.win32.join(m.workspace, 'output/windows-beta', `aq-${runId}`), runId, manifestSha256 } };
}
const algorithm = await loadQualifiedAlgorithm(runtimeRoot);
let qualified;
test('actual pinned source/corpus produces exactly three browser-owning directories', async () => {
  qualified = await qualifyDirectoryMap(input());
  assert.deepEqual(qualified.receipt.cases.map(c => c.id), ['beta-1', 'beta-7', 'beta-8']);
  assert.deepEqual(qualified.receipt.nonBrowserOwningCases, ['beta-2', 'beta-3', 'beta-4', 'beta-5', 'beta-6']);
  assert.deepEqual(qualified.receipt.authority, { cleanup: false, desktopGrant: false, releaseEligible: false });
  await writeFile(path.join(evidence, 'mapping-receipt.json'), JSON.stringify(qualified, null, 2));
  await writeFile(path.join(evidence, 'mapping-only-manifest.json'), JSON.stringify(manifest, null, 2));
});

test('manifest/case/config/retry/command/version/source pin negative controls', async () => {
  const changes = [
    m => m.cases[0].title += ' old', m => m.cases[0].file = 'old.spec.ts',
    m => m.cases[0].project = 'old-project', m => m.sourceHash = '0'.repeat(40),
    m => m.constraints.retries = 1, m => m.command.push('--repeat-each=2'),
    m => m.corpus.version = 'future-aq042',
    m => m.inputs.find(p => p.path === 'playwright.beta.config.ts').sha256 = '0'.repeat(64),
    m => m.inputs.find(p => p.path.endsWith('cleanup.spec.ts')).sha256 = '0'.repeat(64),
  ];
  for (const change of changes) {
    const changed = structuredClone(manifest); change(changed);
    await assert.rejects(qualifyDirectoryMap(input(changed)));
  }
  const badDigest = input(); badDigest.manifestSha256 = '0'.repeat(64);
  await assert.rejects(qualifyDirectoryMap(badDigest), /digest mismatch/);
});

test('exact Windows output/relocation and stale receipt fail closed', async () => {
  const q = await qualifyDirectoryMap(input());
  for (const runOutput of [path.win32.join(runtimeRoot, 'output/windows-beta/run-28'),
    path.win32.join(runtimeRoot, 'output/windows-beta/aq-other'), 'C:\\outside',
    'C:\\x\\..\\outside', '\\\\server\\share\\run', 'C:\\unsafe.\\output']) {
    const changed = input(); changed.binding.runOutput = runOutput;
    await assert.rejects(qualifyDirectoryMap(changed));
  }
  const next = input(manifest, 'fresh-run');
  const derived = await qualifyDirectoryMap(next);
  assert.notEqual(q.receipt.cases[0].outputDir, derived.receipt.cases[0].outputDir);
  assert.deepEqual(q.receipt.expectedCaseDirectories, derived.receipt.expectedCaseDirectories);
  assert.throws(() => assertReceiptBinding(q.receipt, next.binding, q.sha256), /Stale/);
  assert.deepEqual(assertReceiptBinding(derived.receipt, next.binding, derived.sha256), derived.receipt.expectedCaseDirectories);
  const tampered = structuredClone(derived.receipt); tampered.expectedCaseDirectories.push('worker-invented');
  assert.throws(() => assertReceiptBinding(tampered, next.binding, derived.sha256), /digest/);
  const c = CASES[0];
  const relocated = algorithm.derive({ workspace: 'E:\\Isolated Space\\AQ-next', runOutput: 'E:\\Isolated Space\\AQ-next\\output\\windows-beta\\aq-next', ...c });
  assert.equal(path.win32.basename(relocated), q.receipt.expectedCaseDirectories[0]);
  assert.ok(relocated.startsWith('E:\\Isolated Space\\AQ-next\\'));
});

test('actual algorithm distinguishes old shortening, title, project, retry, repeat and file', () => {
  const c = CASES[0], base = { workspace: runtimeRoot, runOutput: input().binding.runOutput, ...c };
  const correct = algorithm.derive(base);
  for (const override of [{ title: c.title + ' old' }, { file: 'wrong.spec.ts' },
    { project: 'other' }, { retry: 1 }, { repeatEachIndex: 1 }]) {
    assert.notEqual(algorithm.derive({ ...base, ...override }), correct);
  }
  // Old plausible 100-char/unhashed slug is not the pinned 60-char SHA1 shortening.
  const old = `${c.file.replace('.spec.ts', '')}-${c.title.replace(/[^a-zA-Z0-9_-]+/g, '-')}`.slice(0, 100) + '-windows-beta';
  assert.notEqual(path.win32.basename(correct), old);
  assert.match(algorithm.derive({ ...base, retry: 1, repeatEachIndex: 2 }), /-windows-beta-retry1-repeat2$/);
});

test('actual changed installed version and worker implementation bytes are rejected', async () => {
  const pins = algorithm.qualification.runtimeInputs;
  for (const target of ['node_modules/playwright/package.json', 'node_modules/playwright/lib/worker/workerProcessEntry.js']) {
    const isolated = await mkdtemp(path.join(evidence, 'bad-runtime-'));
    // Only explicit files preceding the target are copied; never a full node_modules.
    for (const pin of pins) {
      const destination = path.join(isolated, pin.path);
      await mkdir(path.dirname(destination), { recursive: true });
      let bytes = await readFile(path.join(runtimeRoot, pin.path));
      if (pin.path === target) bytes = target.endsWith('package.json')
        ? Buffer.from(bytes.toString().replace('1.62.1', '1.61.0'))
        : Buffer.from(bytes.toString().replace('windowsFilesystemFriendlyLength = 60', 'windowsFilesystemFriendlyLength = 100'));
      await writeFile(destination, bytes);
      if (pin.path === target) break;
    }
    await assert.rejects(loadQualifiedAlgorithm(isolated), /Unqualified Playwright implementation/);
  }
});

test('actual changed source bytes invalidate qualification, preserving frozen reference bytes', async () => {
  const isolated = await mkdtemp(path.join(evidence, 'bad-source-'));
  for (const pin of corpus.inputs) {
    const destination = path.join(isolated, pin.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(runtimeRoot, pin.path), destination);
  }
  await verifyCorpus(isolated);
  for (const target of ['tests/playwright/beta/cleanup.spec.ts', 'playwright.beta.config.ts']) {
    const destination = path.join(isolated, target), original = await readFile(destination);
    await writeFile(destination, Buffer.concat([original, Buffer.from('\n// changed source\n')]));
    await assert.rejects(qualifyDirectoryMap(input({ ...manifest, workspace: isolated })), /corpus changed/);
    await writeFile(destination, original);
  }
  assert.equal(sha256(await readFile('scripts/windows-quality/baseline-corpus.git-v2.json')), CORPUS.referenceSha256);
});

test('THREE synthetic no-browser tests emit actual Playwright testInfo.outputDir', async () => {
  const isolated = await mkdtemp(path.join(evidence, 'synthetic-oracle-'));
  const testDir = path.join(isolated, 'tests/playwright/beta');
  const runOutput = path.join(isolated, 'output/windows-beta/aq-synthetic');
  await mkdir(testDir, { recursive: true });
  const temp = path.join(isolated, 'temp'); await mkdir(temp);
  const testModule = path.join(runtimeRoot, 'node_modules/playwright/test.js');
  for (const file of ['cleanup.spec.ts', 'edit-mask-export.spec.ts']) {
    const cases = CASES.filter(c => ['beta-1', 'beta-7', 'beta-8'].includes(c.id) && c.file === file);
    const source = `// SYNTHETIC NAMING ONLY: no editor imports, browser fixtures, hooks, native actions or cleanup.\n` +
      `import test from ${JSON.stringify(testModule)};\nimport { writeFile } from 'node:fs/promises';\n` +
      cases.map(c => `test(${JSON.stringify(c.title)}, async ({}, testInfo) => {\n` +
        `await writeFile(${JSON.stringify(path.join(isolated, c.id + '.json'))}, JSON.stringify({scope:'SYNTHETIC mapping, NOT browser case',id:${JSON.stringify(c.id)},file:testInfo.file,title:testInfo.title,titlePath:testInfo.titlePath,project:testInfo.project.name,retry:testInfo.retry,repeatEachIndex:testInfo.repeatEachIndex,outputDir:testInfo.outputDir}));\n});`).join('\n');
    await writeFile(path.join(testDir, file), source);
  }
  await writeFile(path.join(isolated, 'oracle.config.cjs'), `module.exports = ${JSON.stringify({
    testDir, testMatch: '**/*.spec.ts', outputDir: path.join(runOutput, 'artifacts'),
    workers: 1, retries: 0, repeatEach: 1, reporter: 'list', projects: [{ name: 'windows-beta' }],
  })};\n`);
  const env = { CI: '1', TEMP: temp, TMP: temp, PWTEST_CACHE_DIR: path.join(isolated, 'transform-cache') };
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key];
  const result = spawnSync(process.execPath, [path.join(runtimeRoot, 'node_modules/@playwright/test/cli.js'),
    'test', '--config', path.join(isolated, 'oracle.config.cjs')],
  { cwd: isolated, env, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  await writeFile(path.join(isolated, 'runner.log'), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  const emitted = [];
  for (const c of CASES.filter(c => ['beta-1', 'beta-7', 'beta-8'].includes(c.id))) {
    const actual = JSON.parse(await readFile(path.join(isolated, c.id + '.json')));
    const expected = algorithm.derive({ workspace: isolated, runOutput, ...c });
    assert.equal(actual.outputDir, expected);
    assert.equal(actual.project, c.project); assert.equal(actual.title, c.title);
    assert.equal(actual.retry, 0); assert.equal(actual.repeatEachIndex, 0);
    assert.deepEqual(actual.titlePath, [c.file, c.title]);
    emitted.push(actual);
  }
  await writeFile(path.join(evidence, 'actual-synthetic-oracle.json'), JSON.stringify({
    scope: 'Three harmless Node tests run by actual pinned Playwright; NOT actual beta/browser execution',
    isolated, command: result.args, status: result.status, emitted,
  }, null, 2));
});
