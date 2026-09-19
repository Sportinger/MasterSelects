// Offline provenance tool. Reads only the named, immutable Git tree; never candidate bytes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const source = '82631b1d2a58cdf33fe8256127adb9053294a9f3';
const [repo, mode] = process.argv.slice(2);
if (!repo || !['--write', '--check'].includes(mode)) throw new Error('Usage: node derive-corpus.mjs <original-git-repo> --write|--check');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const oldUrl = new URL('../../scripts/windows-quality/baseline-corpus.json', import.meta.url);
const oldBytes = readFileSync(oldUrl), old = JSON.parse(oldBytes);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 16 * 1024 * 1024 });
const paths = git('ls-tree', '-r', '--name-only', source, '--', 'tests/playwright', 'playwright.beta.config.ts')
  .toString('utf8').trim().split('\n');
assert.deepEqual(paths.toSorted(), old.inputs.map(x => x.path).toSorted());
const files = [], inputs = [];
for (const entry of old.inputs) {
  const bytes = git('show', `${source}:${entry.path}`);
  const blob = git('rev-parse', `${source}:${entry.path}`).toString('utf8').trim();
  // Declared historical fixture only. This transformation is NEVER used by a validator.
  const archive = Buffer.from(bytes.toString('utf8').replace(/(?<!\r)\n/g, '\r\n'));
  assert.equal(sha(archive), entry.sha256, `Historical archive reconstruction: ${entry.path}`);
  inputs.push({ path: entry.path, sha256: sha(bytes) });
  files.push({ path: entry.path, gitBlob: blob, bytesBase64: bytes.toString('base64') });
}
const reference = {
  schema: 2, version: 'git-object-v2', sourceHash: source,
  provenance: { authority: 'exact pinned Git blob bytes; git show, no checkout conversion',
    historicalVersion: 'aq004-crlf-archive-v1', historicalFile: 'baseline-corpus.json', historicalSha256: sha(oldBytes),
    task: 'AQ-009', planRevision: 'AQ-R3', blobs: files.map(({ path, gitBlob }) => ({ path, gitBlob })) },
  metadataPolicy: 'direct-object-json-under-tests/playwright/campaigns-v1', inputs,
};
const fixture = { schema: 1, sourceHash: source, encoding: 'base64 exact Git bytes', files };
const outputs = [
  [new URL('../../scripts/windows-quality/baseline-corpus.git-v2.json', import.meta.url), Buffer.from(JSON.stringify(reference, null, 2) + '\n')],
  [new URL('./fixtures/pinned-git-corpus.json.gz', import.meta.url), gzipSync(Buffer.from(JSON.stringify(fixture) + '\n'))],
];
for (const [url, bytes] of outputs) {
  if (mode === '--write') writeFileSync(url, bytes);
  else assert.deepEqual(readFileSync(url), bytes, url.pathname);
  console.log(JSON.stringify({ file: url.pathname, sha256: sha(bytes), bytes: bytes.length }));
}
console.log(JSON.stringify({ source, files: files.length, historicalHashesReproduced: files.length,
  readiness: inputs.find(x => x.path.endsWith('/readiness.ts')) }));
