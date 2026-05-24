import { projectDB } from '../services/projectDB';
import type {
  ArtifactManifest,
  ArtifactStorageAdapter,
  ArtifactStorageLocation,
} from './types';

const INDEXEDDB_ARTIFACT_URI_PREFIX = 'indexeddb://MASterSelectsDB/artifacts';

export class ProjectDBArtifactStorageAdapter implements ArtifactStorageAdapter {
  createStorageLocation(hash: string): ArtifactStorageLocation {
    return {
      kind: 'indexeddb',
      uri: `${INDEXEDDB_ARTIFACT_URI_PREFIX}/${hash}`,
    };
  }

  async writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    await projectDB.saveArtifact(manifest, blob);
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    await projectDB.saveArtifactManifest(manifest);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    return await projectDB.getArtifactManifest(artifactId) ?? null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    return projectDB.listArtifactManifests();
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return projectDB.listArtifactManifestsBySource(sourceRef);
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    await projectDB.deleteArtifactManifest(artifactId);
  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    return await projectDB.getArtifactBlob(manifest.hash) ?? null;
  }

  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return (await this.readArtifactBlob(manifest)) !== null;
  }

  async deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return projectDB.deleteArtifactBlob(manifest.hash);
  }
}
