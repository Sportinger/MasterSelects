import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactStore,
  ProjectDBArtifactStorageAdapter,
  blobToArrayBuffer,
} from '../../../src/artifacts';
import type { ArtifactManifest } from '../../../src/artifacts';

const projectDBMock = vi.hoisted(() => {
  const manifests = new Map<string, ArtifactManifest>();
  const blobs = new Map<string, Blob>();

  return {
    manifests,
    blobs,
    projectDB: {
      saveArtifact: vi.fn(async (manifest: ArtifactManifest, blob: Blob) => {
        manifests.set(manifest.artifactId, manifest);
        blobs.set(manifest.hash, blob);
      }),
      saveArtifactManifest: vi.fn(async (manifest: ArtifactManifest) => {
        manifests.set(manifest.artifactId, manifest);
      }),
      getArtifactManifest: vi.fn(async (artifactId: string) => manifests.get(artifactId)),
      listArtifactManifests: vi.fn(async () => [...manifests.values()]),
      listArtifactManifestsBySource: vi.fn(async (sourceRef: string) => (
        [...manifests.values()].filter((manifest) => manifest.sourceRefs.includes(sourceRef))
      )),
      deleteArtifactManifest: vi.fn(async (artifactId: string) => {
        manifests.delete(artifactId);
      }),
      getArtifactBlob: vi.fn(async (hash: string) => blobs.get(hash)),
      deleteArtifactBlob: vi.fn(async (hash: string) => blobs.delete(hash)),
    },
  };
});

vi.mock('../../../src/services/projectDB', () => ({
  projectDB: projectDBMock.projectDB,
}));

const FIXED_TIME = '2026-05-24T10:00:00.000Z';

async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blobToArrayBuffer(blob));
}

describe('ProjectDBArtifactStorageAdapter', () => {
  beforeEach(() => {
    projectDBMock.manifests.clear();
    projectDBMock.blobs.clear();
    vi.clearAllMocks();
  });

  it('stores artifact manifests and bytes durably in ProjectDB', async () => {
    const store = new ArtifactStore(new ProjectDBArtifactStorageAdapter(), () => FIXED_TIME);

    const { manifest } = await store.putArtifact(new Blob(['durable'], { type: 'text/plain' }), {
      encoding: 'text',
      producer: { providerId: 'test.projectdb' },
      sourceRefs: ['signal:source'],
    });

    expect(manifest.storage.kind).toBe('indexeddb');
    expect(manifest.storage.uri).toContain(manifest.hash);
    expect(projectDBMock.projectDB.saveArtifact).toHaveBeenCalledTimes(1);

    const stored = await store.getArtifact(manifest.artifactId);
    expect(stored?.manifest.artifactId).toBe(manifest.artifactId);
    expect(stored ? await readBlobText(stored.blob) : '').toBe('durable');
    expect(await store.hasArtifact(manifest.hash)).toBe(true);
  });
});
