// AQ-048: reviewed mapping data only. Never launches, observes, or cleans resources.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CASES, SOURCE, CORPUS, verifyCorpus, exactPath } from './campaign.mjs';

const qualificationURL = new URL('./playwright-directory-qualification.json', import.meta.url);
export const QUALIFICATION_SHA256 = 'c1d3e41f9fb6061575b0bb310fbde6eea05ef1309d3c57c2c0fbd2535ac3ba79';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b, reason) => { if (!isDeepStrictEqual(a, b)) throw new Error(reason); };
const owners = ['beta-1', 'beta-7', 'beta-8'];
const win = path.win32;

function absoluteWindows(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]:\\/.test(value) ||
      win.normalize(value) !== value || /[<>"|?*\x00-\x1f]/.test(value) ||
      value.slice(2).includes(':') || value.split('\\').some(s => /[. ]$/.test(s))) {
    throw new Error('Canonical absolute Windows path required');
  }
  return value;
}

export async function loadQualifiedAlgorithm(runtimeRoot) {
  if (process.platform !== 'win32') throw new Error('Qualified Windows runtime required');
  const qualificationBytes = await readFile(qualificationURL);
  equal(sha256(qualificationBytes), QUALIFICATION_SHA256, 'Unreviewed qualification document');
  const qualification = JSON.parse(qualificationBytes);
  const buffers = new Map();
  for (const pin of qualification.runtimeInputs) {
    const file = await exactPath(path.join(runtimeRoot, pin.path));
    const bytes = await readFile(file);
    equal(sha256(bytes), pin.sha256, `Unqualified Playwright implementation: ${pin.path}`);
    buffers.set(pin.path, bytes);
  }
  const version = JSON.parse(buffers.get('node_modules/playwright/package.json')).version;
  equal(version, qualification.playwrightVersion, 'Unqualified Playwright version');
  const worker = buffers.get('node_modules/playwright/lib/worker/workerProcessEntry.js').toString();
  const start = worker.indexOf('    this.outputDir = (() => {');
  const end = worker.indexOf('    this.snapshotDir =', start);
  if (start < 0 || end < 0) throw new Error('Pinned outputDir block missing');
  const block = worker.slice(start, end);
  equal(sha256(block), qualification.algorithmSha256, 'Unqualified outputDir algorithm');
  const length = Number(worker.match(/var windowsFilesystemFriendlyLength = (\d+);/)?.[1]);
  equal(length, 60, 'Unqualified directory length');
  // Execute ONLY the exact hashed outputDir assignment, not the worker entrypoint.
  // Sanitization, SHA1 shortening and suffix ordering are the installed implementation.
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  const { sanitizeForFilePath, trimLongString } = require('playwright-core/lib/coreBundle').utils;
  const evaluate = new Function('import_path3', 'projectInternal', 'sanitizeForFilePath2',
    'trimLongString', 'windowsFilesystemFriendlyLength', `${block}\nreturn this.outputDir;`);
  return { qualification, derive({ workspace, runOutput, file, title, project, retry = 0, repeatEachIndex = 0 }) {
    const state = { project: { testDir: win.join(workspace, 'tests/playwright/beta'),
      outputDir: win.join(runOutput, 'artifacts') },
    _requireFile: win.join(workspace, 'tests/playwright/beta', file),
    titlePath: [file, title], retry, repeatEachIndex };
    return evaluate.call(state, { default: win }, { id: project }, sanitizeForFilePath, trimLongString, length);
  } };
}

// Controller inputs must come from its immutable manifest and run binding, never worker JSON.
// This deliberately does not replace verifyManifest, desktop grants, or the registry.
export async function qualifyDirectoryMap({ manifestBytes, manifestSha256, binding, runtimeRoot }) {
  equal(sha256(manifestBytes), manifestSha256, 'Manifest digest mismatch');
  equal(binding.manifestSha256, manifestSha256, 'Controller manifest binding mismatch');
  const manifest = JSON.parse(manifestBytes);
  const workspace = absoluteWindows(binding.workspace);
  const runOutput = absoluteWindows(binding.runOutput);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(binding.runId || '')) throw new Error('Invalid run ID');
  equal(runOutput, win.join(workspace, 'output/windows-beta', `aq-${binding.runId}`), 'Run output binding mismatch');
  equal(manifest.workspace, workspace, 'Workspace binding mismatch');
  equal(manifest.sourceHash, SOURCE, 'Unqualified source revision');
  equal(manifest.schema, 1, 'Unknown manifest schema');
  equal(manifest.campaign, 'existing-windows-beta-eight-v2', 'Unqualified campaign');
  equal(manifest.planRevision, 'AQ-R3', 'Unqualified plan revision');
  equal(manifest.cases, CASES, 'Unqualified case file/title/project');
  equal(manifest.corpus?.version, CORPUS.version, 'Unqualified corpus version');
  equal(manifest.corpus?.referenceSha256, CORPUS.referenceSha256, 'Unqualified corpus digest');
  equal(manifest.constraints, { workers: 1, retries: 0, port: 4187, nativeDesktop: true,
    ownsBrowserCleanup: true }, 'Unqualified runner constraints');
  equal(manifest.command, ['node_modules/@playwright/test/cli.js', 'test', '--config',
    'playwright.beta.config.ts'], 'Unqualified command/overrides');
  equal(await verifyCorpus(workspace), manifest.corpus, 'Source corpus metadata changed');
  // The frozen worker launches the workspace-relative CLI; an unrelated good install
  // cannot qualify the executable that it will actually use.
  equal(path.resolve(runtimeRoot), workspace, 'Runtime checkout must match manifest workspace');
  const { qualification, derive } = await loadQualifiedAlgorithm(runtimeRoot);
  equal(sha256(await readFile(new URL('./campaign.mjs', import.meta.url))),
    qualification.campaignSha256, 'Controller campaign source changed');
  const corpus = JSON.parse(await readFile(new URL('./baseline-corpus.git-v2.json', import.meta.url)));
  for (const pin of corpus.inputs) {
    const entries = manifest.inputs?.filter(p => p.path === pin.path);
    equal(entries, [pin], `Manifest source pin mismatch: ${pin.path}`);
  }
  const rows = CASES.filter(c => owners.includes(c.id)).map(c => {
    const outputDir = derive({ workspace, runOutput, ...c });
    return { ...c, retry: 0, repeatEachIndex: 0, titlePath: [c.file, c.title], outputDir,
      directory: win.basename(outputDir), browserRecord: win.join(outputDir, 'browser.json'),
      cleanupRecord: win.join(outputDir, 'cleanup.json') };
  });
  if (new Set(rows.map(r => r.directory)).size !== 3) throw new Error('Case directory collision');
  const receipt = { schema: 1, kind: 'reviewed-playwright-resource-directory-map',
    qualificationSha256: sha256(await readFile(qualificationURL)), manifestSha256,
    binding: { workspace, runOutput, runId: binding.runId, manifestSha256 },
    sourceHash: SOURCE, corpus: manifest.corpus, playwrightVersion: qualification.playwrightVersion,
    runtimeRoot: workspace, nodeVersion: process.version, platform: process.platform,
    runtimeInputs: qualification.runtimeInputs, algorithmSha256: qualification.algorithmSha256,
    cases: rows, expectedCaseDirectories: rows.map(c => c.directory),
    nonBrowserOwningCases: CASES.filter(c => !owners.includes(c.id)).map(c => c.id),
    authority: { cleanup: false, desktopGrant: false, releaseEligible: false },
    scope: 'Naming only; actual beta cases NOT executed; registry and full manifest verification still required' };
  return { receipt, sha256: sha256(JSON.stringify(receipt)) };
}

export function assertReceiptBinding(receipt, expectedBinding, controllerPinnedReceiptSha256) {
  equal(sha256(JSON.stringify(receipt)), controllerPinnedReceiptSha256, 'Mapping receipt digest mismatch');
  equal(receipt.binding, expectedBinding, 'Stale mapping receipt binding');
  return receipt.expectedCaseDirectories.slice();
}
