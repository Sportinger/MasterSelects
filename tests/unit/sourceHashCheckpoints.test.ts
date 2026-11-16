// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashSourceResumable, sourceHashCheckpointKey, type SourceHashCheckpointStore } from '../../src/services/project/repository/segments/sourceHashCheckpoints';
import { StreamHash } from '../../src/services/project/repository/segments/streamHash';

function memoryStore(): SourceHashCheckpointStore & { entries: Map<string, { offset: number; state: number[] }> } {
  const entries = new Map<string, { offset: number; state: number[] }>();
  return {
    entries,
    async load(key) { return entries.get(key) ?? null; },
    async save(key, offset, state) { entries.set(key, { offset, state }); },
    async remove(key) { entries.delete(key); },
  };
}

describe('resumable source hashing', () => {
  it('continues an interrupted hash and yields the same digest as one full run', async () => {
    const MiB = 1024 * 1024;
    const bytes = new Uint8Array(1536 * MiB / 2); // 768 MiB, one checkpoint at 512 MiB
    for (let i = 0; i < bytes.length; i += 4093) bytes[i] = i & 0xff;
    const file = new File([bytes], 'Totale.MXF', { lastModified: 1494460800000 });
    const expected = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    const store = memoryStore();

    // First run is aborted right after the first checkpoint (like a reload).
    const controller = new AbortController();
    await expect(hashSourceResumable(file, controller.signal, read => { if (read > 513 * MiB) controller.abort(); }, store)).rejects.toThrow();
    const key = sourceHashCheckpointKey(file)!;
    expect(store.entries.get(key)?.offset).toBe(512 * MiB);

    const reads: number[] = [];
    const result = await hashSourceResumable(file, new AbortController().signal, read => reads.push(read), store);
    expect(result).toEqual({ hash: expected, resumedAt: 512 * MiB });
    expect(reads[0]).toBe(513 * MiB);
    expect(store.entries.has(key)).toBe(false);
  }, 60_000);

  it('only resumes files, and only snapshots at block boundaries', () => {
    expect(sourceHashCheckpointKey(new Blob(['x']))).toBeNull();
    const hash = new StreamHash();
    hash.update(new Uint8Array(65));
    expect(hash.snapshot()).toBeNull();
    expect(() => StreamHash.resume({ state: [1, 2], size: 64 })).toThrow();
  });
});
