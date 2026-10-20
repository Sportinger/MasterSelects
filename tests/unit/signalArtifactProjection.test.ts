import { describe, expect, it } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter, toSignalArtifact } from '../../src/artifacts';
import { splitNestedDomain } from '../../src/services/project/repository/domains/nestedOwnership';
import type { JsonValue } from '../../src/services/project/repository/contracts';

// Production: "Signal import failed: model.stl: Unclassified nested DTO field:
// ProjectSignalState/assets/0/artifacts/0/blobId" — the import stored the full
// artifact-store manifest as the asset's SignalArtifact.
async function storedManifest() {
  const store = new ArtifactStore(new MemoryArtifactStorageAdapter(), () => '2026-10-20T00:00:00.000Z');
  const { manifest } = await store.putArtifact(new Blob(['solid stl'], { type: 'model/stl' }), {
    producer: { providerId: 'builtin.binary-fallback', providerVersion: '1' },
    sourceRefs: ['ref-binary'],
    metadata: { role: 'source' },
  });
  return manifest;
}

const signalState = (artifact: unknown): JsonValue => JSON.parse(JSON.stringify({
  schemaVersion: 1,
  assets: [{ id: 'asset-1', name: 'model.stl', artifacts: [artifact] }],
  assetItems: [], artifacts: [artifact], graphs: [], operators: [],
}));

describe('signal artifacts in project state', () => {
  it('rejects raw store manifests, which carry store-only bookkeeping', async () => {
    const manifest = await storedManifest();
    expect(manifest.blobId).toBeTruthy();
    expect(() => splitNestedDomain(signalState(manifest), 'ProjectSignalState')).toThrow(/Unclassified nested DTO field/);
  });

  it('projects a stored manifest to a SignalArtifact the repository accepts', async () => {
    const manifest = await storedManifest();
    const artifact = toSignalArtifact(manifest);
    expect(artifact).not.toHaveProperty('blobId');
    expect(artifact).not.toHaveProperty('manifestHash');
    expect(artifact).not.toHaveProperty('retention');
    expect(artifact).not.toHaveProperty('hashAlgorithm');
    expect(artifact).toMatchObject({ artifactId: manifest.artifactId, hash: manifest.hash, size: manifest.size,
      sourceRefs: ['ref-binary'], metadata: { role: 'source' } });
    const split = splitNestedDomain(signalState(artifact), 'ProjectSignalState');
    expect(split.content).toMatchObject({ assets: [{ artifacts: [{ artifactId: manifest.artifactId }] }] });
  });
});
