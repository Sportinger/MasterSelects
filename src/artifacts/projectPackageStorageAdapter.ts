import type { ProjectPackageSession } from '../services/project/core/projectPackage';
import { isArtifactManifest } from './guards';
import {
  buildArtifactManifestProjectRelativePath,
  buildArtifactProjectRelativePath,
} from './ids';
import {
  ARTIFACT_BINARY_FILE_NAME,
  ARTIFACT_HASH_ALGORITHM,
  ARTIFACT_MANIFEST_FILE_NAME,
  type ArtifactManifest,
  type ArtifactStorageAdapter,
  type ArtifactStorageLocation,
} from './types';

/** Durable content-addressed artifacts stored inside the active .msproj ZIP. */
export class ProjectPackageArtifactStorageAdapter implements ArtifactStorageAdapter {
  private readonly session: ProjectPackageSession;

  constructor(session: ProjectPackageSession) {
    this.session = session;
  }

  createStorageLocation(hash: string): ArtifactStorageLocation {
    return {
      kind: 'project-cache',
      projectRelativePath: buildArtifactProjectRelativePath(hash),
      manifestProjectRelativePath: buildArtifactManifestProjectRelativePath(hash),
    };
  }

  async writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    const base = this.getArtifactEntryBase(manifest.hash);
    const saved = await this.session.writeEntries([
      { folder: 'CACHE_ARTIFACTS', fileName: `${base}/${ARTIFACT_BINARY_FILE_NAME}`, content: blob },
      { folder: 'CACHE_ARTIFACTS', fileName: `${base}/${ARTIFACT_MANIFEST_FILE_NAME}`, content: JSON.stringify(manifest, null, 2) },
    ]);
    if (!saved) throw new Error(`Unable to save packaged artifact ${manifest.artifactId}`);
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    const saved = await this.session.writeEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_MANIFEST_FILE_NAME}`,
      JSON.stringify(manifest, null, 2),
    );
    if (!saved) throw new Error(`Unable to save packaged artifact manifest ${manifest.artifactId}`);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    return (await this.listArtifactManifests()).find((manifest) => manifest.artifactId === artifactId) ?? null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    const manifests: ArtifactManifest[] = [];
    for (const path of this.session.listEntryPaths('CACHE_ARTIFACTS')) {
      if (!path.endsWith(`/${ARTIFACT_MANIFEST_FILE_NAME}`)) continue;
      const bytes = this.session.readEntry('CACHE_ARTIFACTS', path);
      if (!bytes) continue;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (isArtifactManifest(parsed)) manifests.push(parsed);
      } catch {
        // Ignore a corrupt individual artifact; the remaining package stays usable.
      }
    }
    return manifests;
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return (await this.listArtifactManifests())
      .filter((manifest) => manifest.sourceRefs.includes(sourceRef));
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    const manifest = await this.getArtifactManifest(artifactId);
    if (!manifest) return;
    await this.session.deleteEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_MANIFEST_FILE_NAME}`,
    );
  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    const bytes = this.session.readEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_BINARY_FILE_NAME}`,
    );
    return bytes
      ? new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
        type: manifest.mimeType,
      })
      : null;
  }

  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return this.session.hasEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_BINARY_FILE_NAME}`,
    );
  }

  async deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return this.session.deleteEntry('CACHE_ARTIFACTS', this.getArtifactEntryBase(manifest.hash), true);
  }

  private getArtifactEntryBase(hash: string): string {
    return `${ARTIFACT_HASH_ALGORITHM}/${hash.slice(0, 2)}/${hash}`;
  }
}
