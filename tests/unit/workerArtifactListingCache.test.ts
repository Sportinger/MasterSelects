import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from '../../src/artifacts/ArtifactStore';
import { MemoryArtifactStorageAdapter } from '../../src/artifacts/memoryStorageAdapter';
import { WorkerRepositoryArtifactAdapter } from '../../src/services/project/repository/artifacts/WorkerRepositoryArtifactStore';
import type { RepositorySession } from '../../src/services/project/repository/RepositorySession';

describe('worker artifact listing', () => {
  it('validates each immutable manifest once across repeated per-source listings', async () => {
    const memory = new ArtifactStore(new MemoryArtifactStorageAdapter());
    const manifests = await Promise.all(['a', 'b', 'c'].map(async (name, index) => (await memory.putArtifact(
      new Blob([name.repeat(index + 1)]), { sourceRefs: [`media:${name}`] } as never)).manifest));
    const reference = (index: number) => ({ hash: `sha256:${String(index).repeat(64)}`, segmentId: 's', offset: index, length: 1 });
    const request = vi.fn(async (message: { type: string; reference?: { offset: number } }) => {
      if (message.type === 'journal-page') return { entries: manifests.map((manifest, index) => ({ id: `artifact-manifest:${manifest.artifactId}`, value: { type: 'artifact-manifest', manifest, manifestReference: reference(index) } })), nextCursor: null };
      const manifest = manifests[message.reference!.offset]!;
      return { kind: 'metadata', payload: { type: 'artifact-manifest', manifest }, blobs: [{ hash: `sha256:${manifest.hash}`, length: manifest.size }], references: [] };
    });
    const adapter = new WorkerRepositoryArtifactAdapter({ client: { request } } as unknown as RepositorySession);

    for (const name of ['a', 'b', 'c', 'a']) {
      const found = await adapter.listArtifactManifestsBySource(`media:${name}`);
      expect(found.map(manifest => manifest.sourceRefs)).toEqual([[`media:${name}`]]);
    }
    expect(request.mock.calls.filter(([message]) => message.type === 'record')).toHaveLength(3);
  });
});
