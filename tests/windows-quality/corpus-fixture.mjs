import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const fixtureRoot = fileURLToPath(new URL('./evidence/', import.meta.url));
const compressed = await readFile(new URL('./fixtures/pinned-git-corpus.json.gz', import.meta.url));
assert.equal(createHash('sha256').update(compressed).digest('hex'),
  'c5294e932af11186f97b44ec221423c6ee8fcc707993bc164998d010ba1bd1b3');
export const fixture = JSON.parse(gunzipSync(compressed));
export async function corpusFixture(version = 'git') {
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, `${version}-`));
  for (const file of fixture.files) {
    let bytes = Buffer.from(file.bytesBase64, 'base64');
    // Only reconstruct the declared old fixture. No runtime source normalization.
    if (version === 'archive') bytes = Buffer.from(bytes.toString('utf8').replace(/(?<!\r)\n/g, '\r\n'));
    const destination = path.join(root, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return root;
}
