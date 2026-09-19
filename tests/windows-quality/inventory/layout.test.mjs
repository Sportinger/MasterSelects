import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyCorpus } from '../../../scripts/windows-quality/campaign.mjs';

const tooling = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(process.env.AQ_INVENTORY_CORPUS_ROOT ?? path.resolve(tooling, '../../..'));
const campaigns = path.join(workspace, 'tests/playwright/campaigns');
const expected = [
  { path: 'tests/playwright/campaigns/windows-inventory.v1.json', sha256: '8ce27302d98d1c2f9104a6cf1afaca91399ee0c79e949238ebe6c05be8c38a5f' },
  { path: 'tests/playwright/campaigns/windows-inventory.v2.json', sha256: '436d81040a4c5dae2ae858e73ea63e71f956848420bccea404c7b47e5862dfc1' },
];

test('actual workspace accepts only retained inventory metadata and rejects added Python', async () => {
  const before = await verifyCorpus(workspace);
  assert.deepEqual(before.metadata, expected);
  assert.deepEqual((await readdir(campaigns)).toSorted(), expected.map(x => path.basename(x.path)));
  const fixture = path.join(campaigns, 'aq014-negative-control.py');
  const handle = await open(fixture, 'wx');
  let rejection;
  try {
    await handle.writeFile('# Inert negative fixture: executable extension must remain rejected.\n');
    await handle.close();
    await assert.rejects(() => verifyCorpus(workspace), error => {
      rejection = error.message;
      return /Existing beta corpus changed/.test(error.message);
    });
  } finally {
    await handle.close();
    await unlink(fixture);
  }
  const after = await verifyCorpus(workspace);
  assert.deepEqual(after, before);
  assert.deepEqual((await readdir(campaigns)).toSorted(), expected.map(x => path.basename(x.path)));
  const ignore = await readFile(path.join(tooling, '.gitignore'), 'utf8');
  assert.deepEqual(ignore.trim().split(/\r?\n/), ['evidence/', '__pycache__/']);
  await mkdir(path.join(tooling, 'evidence'), { recursive: true });
  const evidence = await mkdtemp(path.join(tooling, 'evidence/layout-'));
  await writeFile(path.join(evidence, 'corpus-layout.json'), JSON.stringify({
    task: 'AQ-014', workspace, command: 'node --test tests/windows-quality/inventory/layout.test.mjs',
    before, pythonAddition: { path: fixture, verdict: 'REJECTED_AS_REQUIRED', rejection },
    after, fixtureRemoved: true, runtime: 'NOT_EXECUTED', release_eligibility: false,
  }, null, 2) + '\n');
});
