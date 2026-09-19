import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SOURCE, CORPUS, CASES, inventory, verifyCorpus, verifyManifest, hashFile, writeOnce } from '../../scripts/windows-quality/campaign.mjs';
import { corpusFixture, fixture, fixtureRoot } from './corpus-fixture.mjs';

const old = JSON.parse(await readFile(new URL('../../scripts/windows-quality/baseline-corpus.json', import.meta.url)));
const proposed = JSON.parse(await readFile(new URL('../../scripts/windows-quality/baseline-corpus.git-v2.json', import.meta.url)));
// Frozen AQ-004 validator body, with only its reference read relocated to this test.
async function oldValidator(workspace) {
  const actual = [...await inventory(workspace, 'tests/playwright'), ...await inventory(workspace, 'playwright.beta.config.ts')];
  if (old.sourceHash !== SOURCE || JSON.stringify(actual) !== JSON.stringify(old.inputs)) {
    throw new Error('Existing beta corpus changed; a separately reviewed campaign revision is required');
  }
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const results = [];
async function outcome(validator, root) {
  try { await validator(root); return 'accepted'; } catch { return 'rejected'; }
}
test('old and proposed validators: declared good fixtures and identical seeded defects', async () => {
  assert.deepEqual(old.inputs.map(x => x.path), proposed.inputs.map(x => x.path));
  assert.equal(sha(await readFile(new URL('../../scripts/windows-quality/baseline-corpus.json', import.meta.url))), proposed.provenance.historicalSha256);
  assert.equal(fixture.files.length, 38);
  assert.equal(fixture.sourceHash, SOURCE);
  for (const file of fixture.files) {
    const bytes = Buffer.from(file.bytesBase64, 'base64');
    assert.equal(sha(bytes), proposed.inputs.find(x => x.path === file.path).sha256);
    const gitBlob = createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
    assert.equal(gitBlob, file.gitBlob);
    assert.equal(gitBlob, proposed.provenance.blobs.find(x => x.path === file.path).gitBlob);
  }
  for (const version of ['archive', 'git']) {
    const root = await corpusFixture(version);
    const target = path.join(root, 'tests/playwright/beta/readiness.ts');
    const original = await readFile(target);
    const checks = [
      ['known-good', async () => {}, async () => {}, version === 'archive' ? 'accepted' : 'rejected', version === 'git' ? 'accepted' : 'rejected'],
      ['byte-alteration', async () => { const bytes = Buffer.from(original); bytes[0] ^= 1; await writeFile(target, bytes); }, async () => writeFile(target, original)],
      ['byte-addition', async () => writeFile(target, Buffer.concat([original, Buffer.from([0x20])])), async () => writeFile(target, original)],
      ['byte-deletion', async () => writeFile(target, original.subarray(1)), async () => writeFile(target, original)],
      ['file-deletion', async () => unlink(target), async () => writeFile(target, original)],
      ['executable-addition', async () => writeFile(path.join(root, 'tests/playwright/beta/seeded.spec.ts'), 'throw new Error("seeded")'), async () => unlink(path.join(root, 'tests/playwright/beta/seeded.spec.ts'))],
    ];
    for (const [seed, mutate, restore, expectedOld = 'rejected', expectedProposed = 'rejected'] of checks) {
      await mutate();
      const row = { fixture: version, seed, old: await outcome(oldValidator, root), proposed: await outcome(verifyCorpus, root) };
      assert.equal(row.old, expectedOld, JSON.stringify(row)); assert.equal(row.proposed, expectedProposed, JSON.stringify(row));
      results.push(row); await restore();
    }
  }
  const evidence = { task: 'AQ-009', revision: 'AQ-R3', scope: 'offline corpus qualification; no runtime/editor evidence',
    source: SOURCE, corpus: CORPUS, cases: CASES, pinnedFiles: 38, results };
  const evidenceDirectory = await mkdtemp(path.join(fixtureRoot, 'qualification-'));
  await writeOnce(path.join(evidenceDirectory, 'matrix.json'), evidence);
  console.log(`Retained corpus qualification evidence: ${evidenceDirectory}`);
});

test('every pinned file rejects a one-byte change and a deletion', async () => {
  const root = await corpusFixture();
  for (const file of fixture.files) {
    const target = path.join(root, file.path), original = await readFile(target);
    const changed = Buffer.from(original); changed[0] ^= 1;
    await writeFile(target, changed); await assert.rejects(verifyCorpus(root), /corpus changed/);
    await unlink(target); await assert.rejects(verifyCorpus(root));
    await writeFile(target, original);
  }
  await verifyCorpus(root);
});

test('inventory metadata is explicit, object JSON only, and retained in run inventory', async () => {
  const root = await corpusFixture(), dir = path.join(root, 'tests/playwright/campaigns');
  await mkdir(dir);
  const file = path.join(dir, 'aq005-inventory.json');
  await writeFile(file, '{"scope":"inventory-only","status":"pending"}\n');
  await assert.rejects(oldValidator(root), /corpus changed/);
  const receipt = await verifyCorpus(root);
  assert.deepEqual(receipt.metadata, [{ path: 'tests/playwright/campaigns/aq005-inventory.json', sha256: await hashFile(file) }]);
  assert.ok((await inventory(root, 'tests/playwright')).some(x => x.path === receipt.metadata[0].path));
  await writeFile(file, '{"scope":"inventory-only","status":"changed"}');
  assert.notDeepEqual((await verifyCorpus(root)).metadata, receipt.metadata);
  for (const bad of ['null', '[]', '"code"', 'export default {}']) {
    await writeFile(file, bad); await assert.rejects(verifyCorpus(root));
  }
  await writeFile(file, '{}');
  for (const name of ['new.ts', 'new.js', 'new.ps1', 'new.cs', 'new.json.ts', 'new.JSON']) {
    const added = path.join(dir, name); await writeFile(added, '{}');
    await assert.rejects(verifyCorpus(root), /corpus changed/); await unlink(added);
  }
  await mkdir(path.join(dir, 'nested')); await writeFile(path.join(dir, 'nested/new.json'), '{}');
  await assert.rejects(verifyCorpus(root), /corpus changed/);
});

test('new executable import of metadata cannot enter the pinned corpus unnoticed', async () => {
  const root = await corpusFixture();
  const file = path.join(root, 'playwright.beta.config.ts');
  await writeFile(file, Buffer.concat([Buffer.from("import './tests/playwright/campaigns/inventory.json';\n"), await readFile(file)]));
  await assert.rejects(verifyCorpus(root), /corpus changed/);
});

test('campaign verifier rejects legacy, missing, and tampered corpus identity before workspace access', async () => {
  const root = await corpusFixture();
  for (const [i, corpus] of [undefined, { version: 'aq004-crlf-archive-v1' }, { ...CORPUS, referenceSha256: '0'.repeat(64) }].entries()) {
    const file = path.join(root, `manifest-${i}.json`);
    await writeOnce(file, { schema: 1, sourceHash: SOURCE, cases: CASES, campaign: 'existing-windows-beta-eight-v2', planRevision: 'AQ-R3', corpus });
    await assert.rejects(verifyManifest(file, await hashFile(file)), /Unqualified corpus identity/);
  }
});

test('actual campaign verifier rejects unqualified source even with a qualified manifest identity', async () => {
  const root = await corpusFixture();
  for (const name of ['@playwright/test/cli.js', 'playwright/package.json', 'vite/bin/vite.js']) {
    const file = path.join(root, 'node_modules', name);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, '{}');
  }
  const readiness = path.join(root, 'tests/playwright/beta/readiness.ts');
  await writeFile(readiness, Buffer.concat([await readFile(readiness), Buffer.from(' ')]));
  const manifest = path.join(root, 'unqualified-manifest.json');
  await writeOnce(manifest, { schema: 1, sourceHash: SOURCE, cases: CASES,
    campaign: 'existing-windows-beta-eight-v2', planRevision: 'AQ-R3', corpus: { ...CORPUS, metadata: [] },
    workspace: root, workspaceId: 'synthetic-unqualified-corpus' });
  await assert.rejects(verifyManifest(manifest, await hashFile(manifest)), /corpus changed/);
});

test('changing reference bytes cannot qualify a modified corpus', async () => {
  const root = await corpusFixture();
  const adapter = path.join(root, 'campaign.mjs');
  await writeFile(adapter, await readFile(new URL('../../scripts/windows-quality/campaign.mjs', import.meta.url)));
  const altered = structuredClone(proposed); altered.inputs[0].sha256 = '0'.repeat(64);
  await writeFile(path.join(root, 'baseline-corpus.git-v2.json'), JSON.stringify(altered));
  const { pathToFileURL } = await import('node:url');
  const isolated = await import(pathToFileURL(adapter).href);
  await assert.rejects(isolated.verifyCorpus(root), /Unqualified corpus reference/);
});
