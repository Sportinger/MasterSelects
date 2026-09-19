// Maintainer evidence tool. Updates a PROPOSED qualification; independent review required.
// This reads the pinned checkout; it never runs its config or beta tests.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './playwright-directory-map.mjs';
const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runtimeRoot = process.argv[2];
if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) throw new Error('Explicit read-only runtime checkout required');
const files = [
  '@playwright/test/package.json', '@playwright/test/cli.js', '@playwright/test/index.js',
  'playwright/package.json', 'playwright/test.js', 'playwright/lib/index.js',
  'playwright/lib/common/index.js', 'playwright/lib/worker/workerProcessEntry.js',
  'playwright/lib/runner/index.js', 'playwright/lib/loader/loaderProcessEntry.js',
  'playwright/lib/transform/babelBundle.js', 'playwright/lib/transform/esmLoader.js',
  'playwright-core/package.json', 'playwright-core/lib/coreBundle.js',
].map(p => `node_modules/${p}`);
const runtimeInputs = [];
for (const file of files) runtimeInputs.push({ path: file, sha256: sha256(await readFile(path.join(runtimeRoot, file))) });
const worker = await readFile(path.join(runtimeRoot, 'node_modules/playwright/lib/worker/workerProcessEntry.js'), 'utf8');
const start = worker.indexOf('    this.outputDir = (() => {');
const block = worker.slice(start, worker.indexOf('    this.snapshotDir =', start));
const qualification = { schema: 1, task: 'AQ-048', planRevision: 'AQ-R3',
  status: 'candidate requiring independent controller review',
  playwrightVersion: JSON.parse(await readFile(path.join(runtimeRoot, 'node_modules/playwright/package.json'))).version,
  campaignSha256: sha256(await readFile(path.join(root, 'scripts/windows-quality/campaign.mjs'))),
  algorithmSha256: sha256(block), runtimeInputs,
  structure: { testDir: 'tests/playwright/beta', project: 'windows-beta', projectId: 'windows-beta',
    retries: 0, repeatEach: 1, titlePath: '[file basename, exact top-level title]', browserOwningCases: ['beta-1', 'beta-7', 'beta-8'] },
  citations: [
    'playwright.beta.config.ts:5-25: guarded output root, testDir, project, retries, webServer and teardown',
    'tests/playwright/beta/cleanup.spec.ts:9-48: beta-1 owns profile and browser.json; beta-2 owns no Chrome profile',
    'tests/playwright/beta/edit-mask-export.spec.ts:19-21: top-level false/true loop produces beta-7/8 titles',
    'tests/playwright/beta/windowsFixture.ts:54-66: profile/workspace and testInfo.outputPath(browser.json)',
    'tests/playwright/beta/readiness.spec.ts and temporalOracle.spec.ts: plain Node oracle/readiness cases',
    'node_modules/playwright/lib/worker/workerProcessEntry.js:72,900-914: exact outputDir algorithm',
    'node_modules/playwright-core/lib/coreBundle.js:8037-8048: sanitizer and SHA1 middle shortening',
    'node_modules/playwright/lib/common/index.js:603-616: unique project IDs; sole project keeps its name',
  ] };
await writeFile(path.join(root, 'scripts/windows-quality/playwright-directory-qualification.json'), JSON.stringify(qualification, null, 2) + '\n');
await mkdir(path.join(root, 'output/aq048'), { recursive: true });
const sourceFiles = ['scripts/windows-quality/campaign.mjs', 'playwright.beta.config.ts',
  'tests/playwright/beta/cleanup.spec.ts', 'tests/playwright/beta/edit-mask-export.spec.ts',
  'tests/playwright/beta/windowsFixture.ts', 'tests/playwright/beta/cleanup.ts',
  'tests/playwright/beta/readiness.spec.ts', 'tests/playwright/beta/temporalOracle.spec.ts'];
const sourceInputs = [];
for (const file of sourceFiles) {
  const location = file.startsWith('scripts/') ? path.join(root, file) : path.join(runtimeRoot, file);
  sourceInputs.push({ path: location, sha256: sha256(await readFile(location)) });
}
await writeFile(path.join(root, 'output/aq048/source-pins.json'), JSON.stringify({ runtimeRoot, sourceInputs,
  frozenCorpora: await Promise.all(['baseline-corpus.json', 'baseline-corpus.git-v2.json'].map(async file => ({ file,
    sha256: sha256(await readFile(path.join(root, 'scripts/windows-quality', file))) }))) }, null, 2) + '\n');
console.log(JSON.stringify({ playwrightVersion: qualification.playwrightVersion, algorithmSha256: qualification.algorithmSha256, runtimeInputs: runtimeInputs.length }));
