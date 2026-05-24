import { describe, expect, it } from 'vitest';
import {
  ArtifactStore,
  MemoryArtifactStorageAdapter,
  blobToArrayBuffer,
  buildArtifactId,
  buildArtifactProjectRelativePath,
  sha256ArtifactInput,
} from '../../../src/artifacts';

const HELLO_SHA256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const FIXED_TIME = '2026-05-24T10:00:00.000Z';

function createStore(): ArtifactStore {
  return new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME);
}

async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blobToArrayBuffer(blob));
}

describe('ArtifactStore', () => {
  it('stores and reads a Blob as a SHA-256-addressed artifact', async () => {
    const store = createStore();
    const blob = new Blob(['hello'], { type: 'text/plain' });

    const result = await store.putArtifact(blob, {
      encoding: 'text',
      producer: { providerId: 'test.blob' },
      sourceRefs: ['source:file-a'],
      metadata: { label: 'Hello artifact' },
    });

    expect(result.deduplicated).toBe(false);
    expect(result.manifest).toMatchObject({
      artifactId: buildArtifactId(HELLO_SHA256),
      hash: HELLO_SHA256,
      hashAlgorithm: 'sha256',
      size: 5,
      mimeType: 'text/plain',
      encoding: 'text',
      createdAt: FIXED_TIME,
      sourceRefs: ['source:file-a'],
      storage: { kind: 'memory' },
    });

    const stored = await store.getArtifact(result.manifest.artifactId);
    expect(stored?.manifest.artifactId).toBe(result.manifest.artifactId);
    expect(stored ? await readBlobText(stored.blob) : '').toBe('hello');
    expect(await store.hasArtifact(HELLO_SHA256)).toBe(true);
  });

  it('deduplicates ArrayBuffer content and merges source refs', async () => {
    const store = createStore();
    const bytes = new TextEncoder().encode('hello');

    const first = await store.putArtifact(bytes.buffer, {
      mimeType: 'application/octet-stream',
      sourceRefs: ['source:first'],
    });
    const second = await store.putArtifact(bytes.buffer.slice(0), {
      mimeType: 'application/octet-stream',
      sourceRefs: ['source:second'],
    });

    expect(first.manifest.artifactId).toBe(second.manifest.artifactId);
    expect(second.deduplicated).toBe(true);
    expect(second.manifest.sourceRefs).toEqual(['source:first', 'source:second']);

    const firstSource = await store.listArtifactsBySource('source:first');
    const secondSource = await store.listArtifactsBySource('source:second');
    expect(firstSource).toHaveLength(1);
    expect(secondSource).toHaveLength(1);
    expect(await store.listArtifacts()).toHaveLength(1);
  });

  it('stores real File data and deletes the artifact by hash', async () => {
    const store = createStore();
    const fileBytes = new Uint8Array([0, 17, 34, 255]);
    const file = new File([fileBytes], 'sample.bin', { type: 'application/x-test-binary' });

    const { manifest } = await store.putArtifact(file, {
      sourceRefs: ['signal:binary-file'],
      producer: { providerId: 'test.file', providerVersion: '1.0.0' },
    });

    expect(manifest.mimeType).toBe('application/x-test-binary');
    expect(manifest.size).toBe(4);
    expect(await sha256ArtifactInput(file)).toBe(manifest.hash);

    const stored = await store.getArtifact(manifest.hash);
    expect(new Uint8Array(await blobToArrayBuffer(stored!.blob))).toEqual(fileBytes);

    expect(await store.deleteArtifact(manifest.hash)).toBe(true);
    expect(await store.hasArtifact(manifest.artifactId)).toBe(false);
    expect(await store.getArtifact(manifest.artifactId)).toBeNull();
  });

  it('builds the project cache path model under Cache/artifacts', () => {
    expect(buildArtifactProjectRelativePath(HELLO_SHA256)).toBe(
      `Cache/artifacts/sha256/2c/${HELLO_SHA256}/artifact.bin`,
    );
  });
});
