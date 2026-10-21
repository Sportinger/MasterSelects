import { describe, expect, it } from 'vitest';
import { extractZip, writeZip, type ArchiveEntry } from '../../src/services/project/repository/archive/streamZip';

// Production: importing a .msproj repository archive hung at "Reading selected
// project 10%". A tiny finished entry and the next entry started in the same
// 1KiB push window; the next entry's write took the serialized backend first
// and waited for bytes, while the producer waited for the tiny entry to drain.

async function archive(files: Array<[string, Uint8Array]>): Promise<Uint8Array[]> {
  async function* entries(): AsyncGenerator<ArchiveEntry> {
    for (const [path, bytes] of files) yield { path, length: bytes.length, chunks: (async function* () { yield bytes; })() };
  }
  const output: Uint8Array[] = [];
  await writeZip(entries(), async chunk => { output.push(chunk.slice()); });
  return output;
}
const pattern = (length: number, seed: number) => Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 251);
/** Like readFileChunks over a stored .msproj: 256KiB reads that ignore entry boundaries. */
const source = (parts: Uint8Array[]) => (async function* () {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  for (let start = 0; start < bytes.length; start += 256 * 1024) yield bytes.subarray(start, start + 256 * 1024);
})();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Like directoryBackend: one write at a time, each streaming its whole entry. */
function serializedBackend() {
  const files = new Map<string, Uint8Array>(); let queue = Promise.resolve();
  async function writeNew(path: string, chunks: AsyncIterable<Uint8Array>) {
    const task = queue.then(async () => {
      const parts: Uint8Array[] = [];
      for await (const chunk of chunks) { parts.push(chunk.slice()); await delay(0); }
      const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      files.set(path, bytes);
    });
    queue = task.catch(() => {}); await task;
  }
  return { files, writeNew };
}

describe('streaming ZIP extraction backpressure', () => {
  it('restores a tiny entry followed by a larger one through a serialized backend', async () => {
    const tiny = pattern(340, 1); const larger = pattern(600_000, 7); const last = pattern(2_000, 3);
    const zip = await archive([['views/a.json', tiny], ['archive-manifest.json', larger], ['segments/b.bin', last]]);
    const backend = serializedBackend();
    // The tiny entry's consumer is slower to reach the backend (a stat call in production).
    await extractZip(source(zip), async entry => {
      if (entry.path === 'views/a.json') await delay(5);
      await backend.writeNew(entry.path, entry.chunks);
    }, undefined, { stallMs: 5_000 });
    expect(backend.files.get('views/a.json')).toEqual(tiny);
    expect(backend.files.get('archive-manifest.json')).toEqual(larger);
    expect(backend.files.get('segments/b.bin')).toEqual(last);
  });

  it('hands buffered input to a consumer in large blocks instead of 1KiB slices', async () => {
    const zip = await archive([['segments/big.bin', pattern(1_000_000, 5)]]);
    const sizes: number[] = [];
    await extractZip(source(zip), async entry => {
      for await (const chunk of entry.chunks) { sizes.push(chunk.length); await delay(0); }
    });
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(1_000_000);
    expect(sizes.length).toBeLessThan(40);
  });

  it('fails with a clear error instead of hanging when a consumer stops reading', async () => {
    const zip = await archive([['views/a.json', pattern(340, 1)], ['segments/b.bin', pattern(400_000, 2)]]);
    const started = Date.now();
    await expect(extractZip(source(zip), async entry => {
      if (entry.path === 'segments/b.bin') await new Promise(() => {});
      for await (const _chunk of entry.chunks) { /* drain */ }
    }, undefined, { stallMs: 100 })).rejects.toMatchObject({ code: 'io', message: expect.stringContaining('stalled') });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
