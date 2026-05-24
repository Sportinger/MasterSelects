import type {
  ArtifactManifest,
  ArtifactStorageAdapter,
  ArtifactStorageLocation,
} from './types';

export class MemoryArtifactStorageAdapter implements ArtifactStorageAdapter {
  private readonly blobs = new Map<string, Blob>();
  private readonly manifests = new Map<string, ArtifactManifest>();

  createStorageLocation(): ArtifactStorageLocation {
    return { kind: 'memory' };
  }

  async writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    this.blobs.set(manifest.hash, blob);
    this.manifests.set(manifest.artifactId, manifest);
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    this.manifests.set(manifest.artifactId, manifest);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    return this.manifests.get(artifactId) ?? null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    return [...this.manifests.values()];
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return [...this.manifests.values()]
      .filter((manifest) => manifest.sourceRefs.includes(sourceRef));
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    this.manifests.delete(artifactId);
  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    return this.blobs.get(manifest.hash) ?? null;
  }

  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return this.blobs.has(manifest.hash);
  }

  async deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return this.blobs.delete(manifest.hash);
  }
}
