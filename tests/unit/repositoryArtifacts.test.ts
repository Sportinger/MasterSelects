import { describe, it, expect } from 'vitest';
import { ArtifactStore } from '../../src/artifacts/ArtifactStore';
import { MemoryArtifactStorageAdapter } from '../../src/artifacts/memoryStorageAdapter';
import { getHashFromArtifactId } from '../../src/artifacts/ids';
import { sha256Blob } from '../../src/artifacts/hash';
import { RepositoryArtifactPins } from '../../src/services/project/repository/artifacts/RepositoryArtifactPins';
describe('immutable artifact descriptions and complete byte identities', () => {
  it('reuses bytes while preserving each historical description', async () => {
    const adapter = new MemoryArtifactStorageAdapter(); const store = new ArtifactStore(adapter, () => '2026-09-30T00:00:00Z');
    const one = await store.putArtifact(new Blob(['same bytes']), { metadata: { label: 'before' }, sourceRefs: ['source-one'] });
    const two = await store.putArtifact(new Blob(['same bytes']), { metadata: { label: 'after' }, sourceRefs: ['source-two'] });
    expect(two.deduplicated).toBe(true); expect(one.manifest.blobId).toBe(two.manifest.blobId);
    expect(one.manifest.artifactId).not.toBe(two.manifest.artifactId);
    expect((await store.getArtifactManifest(one.manifest.artifactId))?.metadata).toEqual({ label: 'before' });
    expect((await store.getArtifactManifest(one.manifest.artifactId))?.sourceRefs).toEqual(['source-one']);
    expect(getHashFromArtifactId(two.manifest.artifactId)).toBe(two.manifest.hash);
    await store.deleteArtifact(one.manifest.artifactId);
    expect(await store.hasArtifact(two.manifest.artifactId)).toBe(true);
  });
  it('hashes the tail without requesting a whole-file array buffer', async () => {
    const prefix = new Uint8Array(2 * 1024 * 1024);
    class BoundedBlob extends Blob { async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole original buffer forbidden'); } }
    const first = new BoundedBlob([prefix, 'x']); const second = new BoundedBlob([prefix, 'y']);
    expect(first.size).toBe(second.size);
    expect(await sha256Blob(first)).not.toBe(await sha256Blob(second));
  });
  it('aborts a retention snapshot when new job or reader roots appear', () => {
    const pins = new RepositoryArtifactPins(); const snapshot = pins.snapshot();
    const release = pins.pin({ purpose: 'job', blobs: [{ hash: `sha256:${'a'.repeat(64)}`, length: 4 }], manifests: [], records: [] });
    expect(() => pins.assertGeneration(snapshot.generation)).toThrow('Artifact roots changed');
    release(); expect(pins.snapshot().pins).toHaveLength(0);
  });
});
