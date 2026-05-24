import { projectDB } from '../services/projectDB';
import type { ArtifactManifest, ArtifactManifestIndex } from './types';

export class ProjectDBArtifactManifestIndex implements ArtifactManifestIndex {
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
}
