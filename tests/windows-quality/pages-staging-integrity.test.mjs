import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, unlink, rename, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fixed from '../../scripts/windows-quality/pages-artifact.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
const parent = path.join(workspace, 'output/adaptive-quality/pages-artifact-tests');
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(path.join(parent, 'aq038-controls-'));
const originalFile = fileURLToPath(new URL('./fixtures/pages-artifact-v1.original.mjs', import.meta.url));
const originalBytes = await readFile(originalFile, 'utf8');
assert.equal(fixed.sha(originalBytes), 'cc2f98d6eb3326b71bb95c2ba5b6e7c742f20153e79adf7aef453cfa9ec03684',
  'original adapter fixture must retain the independently captured bytes');
const fixedBytes = await readFile(new URL('../../scripts/windows-quality/pages-artifact.mjs', import.meta.url), 'utf8');
const modules = {};
for (const [version, source] of Object.entries({ original: originalBytes, fixed: fixedBytes })) {
  // Identical test-only checkpoints, no production hook or mocked filesystem.
  const before = "const assets = path.join(destination, 'assets'); await mkdir(assets);";
  const during = "  await writeFile(path.join(assets, '_routes.json'), routeBytes, { flag: 'wx' });";
  assert.equal(source.split(before).length, 2);
  assert.equal(source.split(during).length, 2);
  const instrumented = source.replace(before, before + "\n  await globalThis.aqCheckpoint?.('beforecopy');")
    .replace(during, "  await globalThis.aqCheckpoint?.('duringstaging');\n" + during);
  const file = path.join(evidence, `${version}-probe.mjs`);
  await writeFile(file, instrumented, { flag: 'wx' });
  modules[version] = await import(pathToFileURL(file));
}
await fixed.save(path.join(evidence, 'provenance.json'), {
  synthetic: true, originalFile, originalSha256: fixed.sha(originalBytes), fixedSha256: fixed.sha(fixedBytes),
  checkpoints: ['after input checks and assets mkdir, before first copy', 'after worker copy, before routes write'],
});
const results = [];
async function fixture(label) {
  const root = await mkdtemp(path.join(evidence, label + '-'));
  for (const dir of ['functions', 'src', 'content', 'migrations', 'frontend', 'server']) await mkdir(path.join(root, dir));
  for (let i = 0; i < 109; i++) await writeFile(path.join(root, 'functions', `${i}.ts`), '// synthetic fixture\n');
  for (const name of ['wrangler.toml', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.functions.json']) await writeFile(path.join(root, name), '{}');
  const frontend = path.join(root, 'frontend'), server = path.join(root, 'server');
  const routes = path.join(root, 'routes.json'), routeConfig = path.join(root, 'route-config.json');
  await writeFile(path.join(frontend, 'index.html'), 'original frontend');
  await writeFile(path.join(server, 'index.js'), 'export default {}');
  await writeFile(routes, JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
  await writeFile(routeConfig, '{"routes":[]}');
  const sourceFiles = await fixed.sourceInputs(root);
  const contract = { synthetic: true, configSha256: fixed.sha(await readFile(path.join(root, 'wrangler.toml'))) };
  const inputs = { baseline: fixed.BASELINE, wranglerVersion: '4.118.0', sourceFiles, sourceDigest: fixed.digest(sourceFiles),
    frontendFiles: await fixed.inventory(frontend), serverFiles: await fixed.inventory(server),
    routesDigest: fixed.sha(await readFile(routes)), routeConfigDigest: fixed.sha(await readFile(routeConfig)),
    bindingDigest: fixed.digest(contract), bundlerInputs: [], bundlerDigest: fixed.digest([]) };
  return { workspace: root, frontend, server, routes, routeConfig, contract, inputs, destination: path.join(root, 'stage') };
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function reseal(api, directory) {
  const seal = await api.json(path.join(directory, 'seal.json'));
  seal.files = (await api.inventory(directory)).filter(f => f.path !== 'seal.json');
  seal.artifactDigest = api.digest(seal.files);
  await writeFile(path.join(directory, 'seal.json'), JSON.stringify(seal, null, 2) + '\n');
  return api.sha(await readFile(path.join(directory, 'seal.json')));
}

for (const phase of ['beforecopy', 'duringstaging']) {
  for (const target of ['frontend', 'server']) {
    for (const action of ['mutation', 'deletion', 'addition']) {
      test(`${phase}: identical original/fixed ${target} ${action}`, async () => {
        for (const version of ['original', 'fixed']) {
          const api = modules[version], f = await fixture(`${version}-${phase}-${target}-${action}`);
          const file = path.join(f[target], target === 'frontend' ? 'index.html' : 'index.js');
          globalThis.aqCheckpoint = async point => {
            if (point !== phase) return;
            if (action === 'mutation') await writeFile(file, 'changed after input check');
            if (action === 'deletion') await unlink(file);
            if (action === 'addition') await writeFile(path.join(f[target], 'added.txt'), 'added during staging');
          };
          let error, accepted = false;
          try { await api.prepare(f); accepted = !!await api.verify(f.destination, api.sha(await readFile(path.join(f.destination, 'seal.json')))); }
          catch (e) { error = e.message; }
          finally { delete globalThis.aqCheckpoint; }
          const sealed = await exists(path.join(f.destination, 'seal.json'));
          results.push({ version, phase, target, action, accepted, error, sealed, fixture: f.workspace });
          if (version === 'fixed') {
            assert.equal(accepted, false); assert.equal(sealed, false);
            assert.equal(await exists(f.destination), true);
            // Restoring sources must not cause a retry to overwrite retained evidence.
            await writeFile(file, target === 'frontend' ? 'original frontend' : 'export default {}');
            if (action === 'addition') await unlink(path.join(f[target], 'added.txt'));
            await assert.rejects(api.prepare(f), /EEXIST/);
          } else if (action !== 'deletion' || phase === 'duringstaging') assert.equal(accepted, true);
        }
      });
    }
  }
}
for (const relative of ['assets/index.html', 'assets/_worker.js/index.js', 'assets/_routes.json', 'bindings.json', 'wrangler.source.toml', 'routes-config.json']) {
  test(`trusted reseal still rejects input mismatch: ${relative}`, async () => {
    for (const version of ['original', 'fixed']) {
      const api = modules[version], f = await fixture(`${version}-reseal`);
      await api.prepare(f);
      const value = relative === 'bindings.json' ? '{}' : relative.endsWith('.json') ? '{"version":1,"include":["/*"],"exclude":[],"changed":true}' : 'changed bytes';
      await writeFile(path.join(f.destination, relative), value);
      const trusted = await reseal(api, f.destination);
      if (version === 'original') await api.verify(f.destination, trusted);
      else await assert.rejects(api.verify(f.destination, trusted), /input_artifact_mismatch|binding_contract_changed/);
      results.push({ version, resealedMismatch: relative, accepted: version === 'original' });
    }
  });
}
for (const target of ['frontend', 'server']) test(`staged ${target} mutation with unchanged sources fails mapping`, async () => {
  const api = modules.fixed, f = await fixture(`staged-${target}`);
  globalThis.aqCheckpoint = async point => {
    if (point === 'duringstaging') await writeFile(path.join(f.destination, target === 'frontend' ? 'assets/index.html' : 'assets/_worker.js/index.js'), 'staged mutation');
  };
  try { await assert.rejects(api.prepare(f), /input_artifact_mismatch/); }
  finally { delete globalThis.aqCheckpoint; }
  assert.equal(await exists(path.join(f.destination, 'seal.json')), false);
});
for (const action of ['addition', 'deletion']) test(`trusted reseal rejects public file ${action}`, async () => {
  for (const version of ['original', 'fixed']) {
    const api = modules[version], f = await fixture(`${version}-resealed-${action}`);
    await api.prepare(f);
    if (action === 'addition') await writeFile(path.join(f.destination, 'assets/unaccepted.txt'), 'not an input');
    else await unlink(path.join(f.destination, 'assets/index.html'));
    const trusted = await reseal(api, f.destination);
    if (version === 'original') await api.verify(f.destination, trusted);
    else await assert.rejects(api.verify(f.destination, trusted), /input_artifact_mismatch/);
    results.push({ version, resealedPublicFile: action, accepted: version === 'original' });
  }
});
for (const target of ['routes', 'routeConfig', 'source', 'dependency']) test(`${target} changes during staging leave no success seal`, async () => {
  const api = modules.fixed, f = await fixture(target);
  if (target === 'dependency') {
    f.runtime = path.join(f.workspace, 'runtime');
    for (const name of ['wrangler', 'esbuild', '@esbuild', 'path-to-regexp']) await mkdir(path.join(f.runtime, 'node_modules', name), { recursive: true });
    await writeFile(path.join(f.runtime, 'node_modules/wrangler/a.js'), 'pinned');
    f.inputs.bundlerInputs = [{ path: 'node_modules/wrangler/a.js', size: 6, sha256: fixed.sha('pinned') }];
    f.inputs.bundlerDigest = fixed.digest(f.inputs.bundlerInputs);
  }
  globalThis.aqCheckpoint = async point => {
    if (point !== 'duringstaging') return;
    await writeFile(target === 'source' ? path.join(f.workspace, 'src/added.ts') : target === 'dependency'
      ? path.join(f.runtime, 'node_modules/wrangler/added.js') : f[target], 'changed');
  };
  try { await assert.rejects(api.prepare(f), /changed/); }
  finally { delete globalThis.aqCheckpoint; }
  assert.equal(await exists(path.join(f.destination, 'seal.json')), false);
});

// Preserve all twelve original control intents on a small synthetic filesystem.
test('original twelve control intents retained', async t => {
  const f = await fixture('original-twelve');
  await fixed.prepare(f);
  const trusted = fixed.sha(await readFile(path.join(f.destination, 'seal.json')));
  await t.test('complete artifact', async () => { assert.equal((await fixed.verify(f.destination, trusted)).files.length, 6); });
  for (const [name, relative] of [['server tamper', 'assets/_worker.js/index.js'], ['route narrowing', 'assets/_routes.json'],
    ['binding tamper', 'bindings.json'], ['config tamper', 'wrangler.source.toml'], ['untrusted seal', 'seal.json']]) {
    await t.test(name, async () => {
      const file = path.join(f.destination, relative), bytes = await readFile(file);
      try { await writeFile(file, '{"tampered":true}'); await assert.rejects(fixed.verify(f.destination, trusted)); }
      finally { await writeFile(file, bytes); }
    });
  }
  await t.test('wrong or missing entry', async () => {
    const file = path.join(f.destination, 'assets/_worker.js/index.js');
    await rename(file, file + '.wrong');
    try { await assert.rejects(fixed.verify(f.destination, trusted)); } finally { await rename(file + '.wrong', file); }
  });
  await t.test('stale source', () => assert.rejects(fixed.prepare({ ...f, inputs: { ...f.inputs, sourceDigest: '0'.repeat(64) } }), /source_changed/));
  await t.test('missing bundle', () => assert.rejects(fixed.prepare({ ...f, server: path.join(f.workspace, 'missing') }), /ENOENT/));
  await t.test('outside output', () => assert.rejects(fixed.prepare({ ...f, destination: path.dirname(f.workspace) }), /output_outside/));
  await t.test('stale bundle', () => assert.rejects(fixed.prepare({ ...f, inputs: { ...f.inputs, serverFiles: [{ ...f.inputs.serverFiles[0], sha256: '0'.repeat(64) }] } }), /missing_or_stale/));
  await t.test('restored verifies', () => fixed.verify(f.destination, trusted));
});
test.after(async () => {
  await fixed.save(path.join(evidence, 'results.json'), { synthetic: true, results });
  console.log(`Retained filesystem evidence: ${evidence}`);
});

test('host pins a new source revision without relabeling historical baseline', async () => {
  const f=await fixture('selected-source');const revision='f30de92d41d7b6097ed97799c454824f0ddca09e';
  f.inputs.baseline=revision;
  await assert.rejects(fixed.prepare(f), /incorrect_baseline/);
  const seal=await fixed.prepare({...f,expectedBaseline:revision});
  assert.equal(seal.baseline, revision);
  const hash=fixed.sha(await readFile(path.join(f.destination,'seal.json')));
  await assert.rejects(fixed.verify(f.destination,hash), /invalid_seal/);
  assert.equal((await fixed.verify(f.destination,hash,revision)).baseline,revision);
  await assert.rejects(fixed.verify(f.destination,hash,'0'.repeat(40)), /invalid_seal/);
});
