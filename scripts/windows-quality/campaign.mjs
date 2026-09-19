import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const SOURCE = '82631b1d2a58cdf33fe8256127adb9053294a9f3';
export const CORPUS = Object.freeze({ version: 'git-object-v2',
  referenceSha256: 'fce890385d9afeb4ce999528a29689babdb3b0a2b3dbbbbd01dc5bc33ce36b8b' });
export const CASES = Object.freeze([
  ['cleanup.spec.ts', 'Cleanup closes owned Chrome after a failure and preserves evidence @cleanup'],
  ['cleanup.spec.ts', 'Cleanup rejects an ordinary directory without deleting its contents @cleanup'],
  ['readiness.spec.ts', 'Readiness waits beyond a visible placeholder @readiness'],
  ['readiness.spec.ts', 'Readiness rejects an observation that never finishes @readiness'],
  ['temporalOracle.spec.ts', 'Frame oracle accepts known motion and rejects freezes, skips, reorder and invalid timing @oracle'],
  ['temporalOracle.spec.ts', 'Frame oracle reads compressed-looking counters and rejects absent/color-corrupted cells @oracle'],
  ['edit-mask-export.spec.ts', 'Real footage: import, drag, trim, mask, undo, export @beta'],
  ['edit-mask-export.spec.ts', 'Pattern oracle: import, drag, trim, mask, undo, export @beta'],
].map(([file, title], i) => Object.freeze({ id: `beta-${i + 1}`, file, title, project: 'windows-beta' })));
const MEDIA = [
  ['fpv-freestyle.mp4', '96ffd7900e32efcc0d1470aff8af7a00d30e595a2a34657bc811187db7db863e'],
  ['striped-motion.mp4', 'fd40ab6c208de9a39820df5e2f239a81991dcd8998fad4111a07bf976b1d56e5'],
  ['tueftenbacchus.mp4', '10dd7326d45249da86eca75a88760d793ce9864b78e21442bd690059ba365d37'],
  ['x-rays-safe.mp4', '0eebf268d7abfed511cdcbf04bb588b0d192bbe27751d8cf0c34d3734ec52be6'],
  ['time-traveler-cover.mp3', '7b7da54579c309d5829edc93607ca0913dc914e19170758ce2c75f6029e4c9f1'],
];
const INPUT_ROOTS = ['src', 'tools/devBridge', 'tests/playwright', 'playwright.beta.config.ts', 'vite.config.ts',
  'index.html', 'tsconfig.json', 'tsconfig.app.json', 'package.json', 'package-lock.json',
  'node_modules/@playwright/test/cli.js', 'node_modules/playwright/package.json', 'node_modules/vite/bin/vite.js'];
export async function verifyCorpus(workspace) {
  const referenceBytes = await readFile(new URL('./baseline-corpus.git-v2.json', import.meta.url));
  if (createHash('sha256').update(referenceBytes).digest('hex') !== CORPUS.referenceSha256) {
    throw new Error('Unqualified corpus reference; independent review required');
  }
  const baseline = JSON.parse(referenceBytes);
  const actual = [...await inventory(workspace, 'tests/playwright'), ...await inventory(workspace, 'playwright.beta.config.ts')];
  const pinned = [], metadata = [];
  for (const entry of actual) {
    // AQ-005 inventory descriptions are inert data, outside the pinned executable corpus.
    // No recursive directory/extension exclusion: additions of scripts, nested files or
    // any previously pinned JSON still require qualification. Manifest inputs retain ALL files.
    if (/^tests\/playwright\/campaigns\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(entry.path) &&
        !baseline.inputs.some(input => input.path === entry.path)) {
      const data = JSON.parse(await readFile(path.join(workspace, entry.path), 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Inventory metadata must be a JSON object');
      metadata.push(entry);
    } else pinned.push(entry);
  }
  if (baseline.sourceHash !== SOURCE || baseline.version !== CORPUS.version ||
      JSON.stringify(pinned) !== JSON.stringify(baseline.inputs)) {
    throw new Error('Existing beta corpus changed; a separately reviewed campaign revision is required');
  }
  return { ...CORPUS, metadata };
}
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function writeOnce(file, value) {
  const fd = await open(file, 'wx');
  try { await fd.writeFile(JSON.stringify(value, null, 2) + '\n'); await fd.sync(); }
  finally { await fd.close(); }
}
export async function exactPath(file) {
  const absolute = path.resolve(file);
  let cursor = absolute;
  while (true) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Reparse/symlink path refused: ${cursor}`);
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if ((await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error('Ambiguous workspace path');
  return absolute;
}
export async function inventory(root, relative) {
  const file = path.join(root, relative);
  const stat = await lstat(file);
  if (stat.isSymbolicLink()) throw new Error(`Linked input refused: ${relative}`);
  if (stat.isFile()) return [{ path: relative.replaceAll('\\', '/'), sha256: await hashFile(file) }];
  if (!stat.isDirectory()) throw new Error(`Unsupported input: ${relative}`);
  const entries = (await readdir(file)).toSorted();
  const records = [];
  for (const entry of entries) records.push(...await inventory(root, path.join(relative, entry)));
  return records;
}
export async function workspaceReceipt(options) {
  if (options.isolated !== true || options.sourceHash !== SOURCE || !options.workspaceId || !path.isAbsolute(options.workspace || '')) {
    throw new Error('Caller must supply an explicit isolated workspace, workspaceId and pinned sourceHash');
  }
  const workspace = await exactPath(options.workspace);
  await exactPath(path.join(workspace, 'node_modules'));
  for (const file of ['node_modules/@playwright/test/cli.js', 'node_modules/playwright/package.json', 'node_modules/vite/bin/vite.js']) {
    await exactPath(path.join(workspace, file));
  }
  return workspace;
}
export async function freezeCampaign(options, destination) {
  const workspace = await workspaceReceipt(options);
  const corpus = await verifyCorpus(workspace);
  const environment = options.environment;
  for (const key of ['browserVersion', 'gpu', 'driver', 'ffmpegVersion', 'dependencyDigest']) {
    if (typeof environment?.[key] !== 'string' || !environment[key].trim()) throw new Error(`Missing environment.${key}`);
  }
  const inputs = [];
  // Explicit source roots avoid reading .env, tokens, unrelated output or Git ancestors.
  for (const relative of INPUT_ROOTS) {
    inputs.push(...await inventory(workspace, relative));
  }
  const fixtures = [];
  for (const [name, expected] of MEDIA) {
    const relative = `fixtures/playwright-reference-project/media/${name}`;
    await exactPath(path.join(workspace, relative));
    const sha256 = await hashFile(path.join(workspace, relative));
    if (sha256 !== expected) throw new Error(`Reference media mismatch: ${name} (LFS pointers are not fixtures)`);
    fixtures.push({ path: relative, sha256 });
  }
  const manifest = { schema: 1, campaign: 'existing-windows-beta-eight-v2', planRevision: 'AQ-R3', corpus,
    sourceHash: SOURCE, sourceHashAuthority: 'caller isolated archive receipt; no ancestor git lookup',
    workspace, workspaceId: options.workspaceId, cases: CASES, inputs, fixtures,
    environment: { ...environment, node: process.version, platform: process.platform, arch: process.arch,
      hostname: os.hostname(), osRelease: os.release() },
    command: ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.beta.config.ts'],
    constraints: { workers: 1, retries: 0, port: 4187, nativeDesktop: true, ownsBrowserCleanup: true },
    gaps: ['Small beta campaign only; no save/reopen, full inventory, production artifact or other-platform qualification',
      'GPU/browser/driver/dependency environment supplied by trusted caller; hardware attachments require independent reconciliation'],
  };
  await writeOnce(destination, manifest);
  return { manifest, sha256: await hashFile(destination) };
}
export async function verifyManifest(file, expectedDigest) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest || '') || await hashFile(file) !== expectedDigest) throw new Error('Manifest digest mismatch');
  const m = JSON.parse(await readFile(file, 'utf8'));
  if (m.sourceHash !== SOURCE || m.schema !== 1 || JSON.stringify(m.cases) !== JSON.stringify(CASES)) throw new Error('Unknown campaign');
  if (m.campaign !== 'existing-windows-beta-eight-v2' || m.planRevision !== 'AQ-R3' ||
      m.corpus?.version !== CORPUS.version || m.corpus?.referenceSha256 !== CORPUS.referenceSha256) {
    throw new Error('Unqualified corpus identity; freeze a separately reviewed campaign revision');
  }
  await workspaceReceipt({ ...m, isolated: true });
  const corpus = await verifyCorpus(m.workspace);
  if (JSON.stringify(corpus) !== JSON.stringify(m.corpus)) throw new Error('Pinned corpus metadata changed');
  if (m.environment.platform !== process.platform || m.environment.hostname !== os.hostname() ||
      m.environment.node !== process.version || m.environment.arch !== process.arch || m.environment.osRelease !== os.release()) {
    throw new Error('Pinned machine/runtime changed');
  }
  for (const entry of [...m.inputs, ...m.fixtures]) {
    const filePath = path.resolve(m.workspace, entry.path);
    if (!filePath.startsWith(m.workspace + path.sep)) throw new Error('Input outside workspace');
    await exactPath(filePath);
    if (await hashFile(filePath) !== entry.sha256) throw new Error(`Pinned input changed: ${entry.path}`);
  }
  const current = [];
  for (const relative of INPUT_ROOTS) current.push(...await inventory(m.workspace, relative));
  if (JSON.stringify(current) !== JSON.stringify(m.inputs)) throw new Error('Pinned source inventory changed (including added/deleted files)');
  return m;
}

export function validateReport(report, exitCode) {
  const problems = [], rows = [];
  function visit(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) rows.push({ spec, test });
      visit(suite.suites);
    }
  }
  if (!report || !Array.isArray(report.suites)) return { verdict: 'infrastructure-error', problems: ['Missing/malformed report'], cases: CASES.map(c => ({ ...c, verdict: 'missing' })) };
  visit(report.suites);
  if (exitCode !== 0) problems.push(`Runner exit: ${exitCode}`);
  if (!Array.isArray(report.errors) || report.errors.length) problems.push('Global report errors or missing errors field');
  if (rows.length !== CASES.length) problems.push(`Expected eight results, received ${rows.length}`);
  const cases = CASES.map(c => {
    const matches = rows.filter(({ spec, test }) => spec.title === c.title &&
      typeof spec.file === 'string' && path.posix.basename(spec.file.replaceAll('\\', '/')) === c.file && test.projectName === c.project);
    let verdict = 'missing';
    if (matches.length > 1) verdict = 'duplicate';
    if (matches.length === 1) {
      const { spec, test } = matches[0], results = test.results;
      verdict = spec.ok === true && test.expectedStatus === 'passed' && test.status === 'expected' &&
        Array.isArray(results) && results.length === 1 && results[0].status === 'passed' &&
        results[0].retry === 0 && !(results[0].errors?.length) && !results[0].error ? 'passed' : 'failed';
    }
    if (verdict !== 'passed') problems.push(`${c.id}: ${verdict}`);
    return { ...c, verdict };
  });
  const stats = report.stats;
  if (!stats || stats.expected !== 8 || stats.unexpected !== 0 || stats.flaky !== 0 || stats.skipped !== 0) problems.push('Incomplete/non-green report statistics');
  return { verdict: problems.length ? 'failed' : 'passed', problems, cases };
}
