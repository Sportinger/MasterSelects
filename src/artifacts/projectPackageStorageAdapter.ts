import type { ProjectPackageSession } from '../services/project/core/projectPackage';
import { PROJECT_FOLDERS } from '../services/project/core/constants';
import { isArtifactManifest } from './guards';
import {
  buildArtifactManifestProjectRelativePath,
  buildArtifactProjectRelativePath,
  getHashFromArtifactId,
  getManifestHashFromArtifactId,
  artifactManifestFileName,
  isArtifactManifestFileName,
} from './ids';
import {
  ARTIFACT_BINARY_FILE_NAME,
  ARTIFACT_HASH_ALGORITHM,
  type ArtifactManifest,
  type ArtifactStorageAdapter,
  type ArtifactStorageLocation,
} from './types';

interface PackageArtifactIndex {
  revision: number;
  manifests: ArtifactManifest[];
  bySource: Map<string, ArtifactManifest[]>;
  entries: Map<string, { bytes: Uint8Array; manifest: ArtifactManifest | null }>;
}

// Adapters are short lived; the index belongs to the package session and must
// be shared by every reader, without retaining closed projects.
const packageIndexes = new WeakMap<ProjectPackageSession, PackageArtifactIndex>();

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
      { folder: 'CACHE_ARTIFACTS', fileName: `${base}/${artifactManifestFileName(manifest)}`, content: JSON.stringify(manifest, null, 2) },
    ]);
    if (!saved) throw new Error(`Unable to save packaged artifact ${manifest.artifactId}`);
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    const saved = await this.session.writeEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${artifactManifestFileName(manifest)}`,
      JSON.stringify(manifest, null, 2),
    );
    if (!saved) throw new Error(`Unable to save packaged artifact manifest ${manifest.artifactId}`);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    const hash = getHashFromArtifactId(artifactId);
    if (!hash) return null;
    const manifestHash = getManifestHashFromArtifactId(artifactId);
    const manifest = this.readManifest(`${this.getArtifactEntryBase(hash)}/${artifactManifestFileName({ ...(manifestHash ? { manifestHash } : {}) })}`);
    return manifest?.artifactId === artifactId ? manifest : null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    return structuredClone(this.manifestIndex().manifests);
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return structuredClone(this.manifestIndex().bySource.get(sourceRef) ?? []);
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    const manifest = await this.getArtifactManifest(artifactId);
    if (!manifest) return;
    await this.session.deleteEntry(
      'CACHE_ARTIFACTS',
      `${this.getArtifactEntryBase(manifest.hash)}/${artifactManifestFileName(manifest)}`,
    );
  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    const blob = await this.session.readEntryBlob(
      'CACHE_ARTIFACTS', `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_BINARY_FILE_NAME}`,
    );
    return blob?.slice(0, blob.size, manifest.mimeType) ?? null;
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

  private readManifest(path: string): ArtifactManifest | null {
    const bytes = this.session.getEntries().get(`${PROJECT_FOLDERS.CACHE_ARTIFACTS}/${path}`);
    return this.parseManifest(bytes ?? null);
  }

  private parseManifest(bytes: Uint8Array | null): ArtifactManifest | null {
    if (!bytes) return null;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return isArtifactManifest(parsed) ? parsed : null;
    } catch {
      // A corrupt individual artifact does not invalidate the remaining package.
      return null;
    }
  }

  private manifestIndex(): PackageArtifactIndex {
    const revision = this.session.getFolderRevision('CACHE_ARTIFACTS');
    const cached = packageIndexes.get(this.session);
    if (cached?.revision === revision) return cached;
    const manifests: ArtifactManifest[] = [];
    const bySource = new Map<string, ArtifactManifest[]>();
    const entries: PackageArtifactIndex['entries'] = new Map();
    for (const path of this.session.listEntryPaths('CACHE_ARTIFACTS')) {
      if (!isArtifactManifestFileName(path.split('/').at(-1)!)) continue;
      const bytes = this.session.getEntries().get(`${PROJECT_FOLDERS.CACHE_ARTIFACTS}/${path}`);
      if (!bytes) continue;
      const previous = cached?.entries.get(path);
      const manifest = previous?.bytes === bytes ? previous.manifest : this.parseManifest(bytes);
      entries.set(path, { bytes, manifest });
      if (!manifest) continue;
      manifests.push(manifest);
      for (const sourceRef of new Set(manifest.sourceRefs)) {
        const entries = bySource.get(sourceRef) ?? [];
        entries.push(manifest);
        bySource.set(sourceRef, entries);
      }
    }
    const index = { revision, manifests, bySource, entries };
    packageIndexes.set(this.session, index);
    return index;
  }
}
