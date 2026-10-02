import { Logger } from '../services/logger';
import { FileStorageService, fileStorageService } from '../services/project/core/FileStorageService';
import {
  getFsaProjectFolderPath,
  getFsaProjectPackageSession,
} from '../services/project/core/projectPackage';
import {
  ARTIFACT_BINARY_FILE_NAME,
  ARTIFACT_HASH_ALGORITHM,
  ARTIFACT_MANIFEST_FILE_NAME,
  type ArtifactManifest,
  type ArtifactManifestIndex,
  type ArtifactStorageAdapter,
  type ArtifactStorageLocation,
} from './types';
import {
  buildArtifactManifestProjectRelativePath,
  buildArtifactProjectRelativePath,
  artifactManifestFileName,
  isArtifactManifestFileName,
  getHashFromArtifactId,
  getManifestHashFromArtifactId,
} from './ids';
import { isArtifactManifest } from './guards';

const log = Logger.create('ArtifactFS');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export class FileSystemArtifactStorageAdapter implements ArtifactStorageAdapter {
  private readonly projectHandle: FileSystemDirectoryHandle;
  private readonly fileStorage: FileStorageService;

  constructor(
    projectHandle: FileSystemDirectoryHandle,
    fileStorage: FileStorageService = fileStorageService,
    _index: ArtifactManifestIndex | null = null,
  ) {
    this.projectHandle = projectHandle;
    this.fileStorage = fileStorage;
  }

  createStorageLocation(hash: string): ArtifactStorageLocation {
    return {
      kind: 'project-cache',
      projectRelativePath: buildArtifactProjectRelativePath(hash),
      manifestProjectRelativePath: buildArtifactManifestProjectRelativePath(hash),
    };
  }

  async writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      const entryBase = this.getArtifactEntryBase(manifest.hash);
      const saved = await packageSession.writeEntries([
        { folder: 'CACHE_ARTIFACTS', fileName: `${entryBase}/${ARTIFACT_BINARY_FILE_NAME}`, content: blob },
        { folder: 'CACHE_ARTIFACTS', fileName: `${entryBase}/${artifactManifestFileName(manifest)}`, content: JSON.stringify(manifest, null, 2) },
      ]);
      if (!saved) throw new Error(`Unable to save packaged artifact ${manifest.artifactId}`);
      return;
    }

    const directory = await this.getArtifactDirectory(manifest.hash, true);
    if (!directory) {
      throw new Error(`Unable to create artifact directory for ${manifest.artifactId}`);
    }

    await this.writeFile(directory, ARTIFACT_BINARY_FILE_NAME, blob);
    await this.writeFile(directory, artifactManifestFileName(manifest), JSON.stringify(manifest, null, 2));
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      const saved = await packageSession.writeEntry(
        'CACHE_ARTIFACTS',
        `${this.getArtifactEntryBase(manifest.hash)}/${artifactManifestFileName(manifest)}`,
        JSON.stringify(manifest, null, 2),
      );
      if (!saved) throw new Error(`Unable to save packaged artifact manifest ${manifest.artifactId}`);
      return;
    }

    const directory = await this.getArtifactDirectory(manifest.hash, true);
    if (!directory) {
      throw new Error(`Unable to create artifact directory for ${manifest.artifactId}`);
    }

    await this.writeFile(directory, artifactManifestFileName(manifest), JSON.stringify(manifest, null, 2));
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    // An origin-global cache is never authority for this project handle.
    const hash = getHashFromArtifactId(artifactId);
    if (hash) {
      const manifestHash = getManifestHashFromArtifactId(artifactId);
      const fileName = artifactManifestFileName({ ...(manifestHash ? { manifestHash } : {}) });
      const packageSession = getFsaProjectPackageSession(this.projectHandle);
      if (packageSession) {
        const bytes = packageSession.readEntry('CACHE_ARTIFACTS', `${this.getArtifactEntryBase(hash)}/${fileName}`);
        if (!bytes) return null;
        try { const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes)); return isArtifactManifest(parsed) && parsed.artifactId === artifactId ? parsed : null; } catch { return null; }
      }
      const directory = await this.getArtifactDirectory(hash, false);
      const manifest = directory ? await this.readManifest(directory, fileName) : null;
      return manifest?.artifactId === artifactId ? manifest : null;
    }
    const manifests = await this.scanManifests();
    return manifests.find((manifest) => manifest.artifactId === artifactId) ?? null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {

    return this.scanManifests();
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {

    const manifests = await this.scanManifests();
    return manifests.filter((manifest) => manifest.sourceRefs.includes(sourceRef));
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    const manifest = await this.getArtifactManifest(artifactId);
    if (!manifest) {
      return;
    }

    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      await packageSession.deleteEntry(
        'CACHE_ARTIFACTS',
        `${this.getArtifactEntryBase(manifest.hash)}/${artifactManifestFileName(manifest)}`,
      );
    } else try {
      const directory = await this.getArtifactDirectory(manifest.hash, false);
      await directory?.removeEntry(artifactManifestFileName(manifest));
    } catch {
      // The full artifact directory may already be gone after blob deletion.
    }

  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      return packageSession.readEntryBlob(
        'CACHE_ARTIFACTS',
        `${this.getArtifactEntryBase(manifest.hash)}/${ARTIFACT_BINARY_FILE_NAME}`,
      );
    }

    try {
      const directory = await this.getArtifactDirectory(manifest.hash, false);
      if (!directory) {
        return null;
      }

      const fileHandle = await directory.getFileHandle(ARTIFACT_BINARY_FILE_NAME);
      return await fileHandle.getFile();
    } catch {
      return null;
    }
  }

  async hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    return (await this.readArtifactBlob(manifest)) !== null;
  }

  async deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean> {
    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      return packageSession.deleteEntry(
        'CACHE_ARTIFACTS',
        this.getArtifactEntryBase(manifest.hash),
        true,
      );
    }

    try {
      const shardDirectory = await this.fileStorage.navigateToFolder(
        this.projectHandle,
        `${getFsaProjectFolderPath(this.projectHandle, 'CACHE_ARTIFACTS')}/${ARTIFACT_HASH_ALGORITHM}/${manifest.hash.slice(0, 2)}`,
        false,
      );
      if (!shardDirectory) {
        return false;
      }

      await shardDirectory.removeEntry(manifest.hash, { recursive: true });
      return true;
    } catch (error) {
      log.warn(`Failed to delete artifact ${manifest.artifactId}`, error);
      return false;
    }
  }

  private async getArtifactDirectory(
    hash: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    return this.fileStorage.navigateToFolder(
      this.projectHandle,
      `${getFsaProjectFolderPath(this.projectHandle, 'CACHE_ARTIFACTS')}/${ARTIFACT_HASH_ALGORITHM}/${hash.slice(0, 2)}/${hash}`,
      create,
    );
  }

  private async writeFile(
    directory: FileSystemDirectoryHandle,
    fileName: string,
    content: Blob | string,
  ): Promise<void> {
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  private async readManifest(directory: FileSystemDirectoryHandle, fileName = ARTIFACT_MANIFEST_FILE_NAME): Promise<ArtifactManifest | null> {
    try {
      const fileHandle = await directory.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const parsed = JSON.parse(await file.text()) as unknown;
      return isArtifactManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async scanManifests(): Promise<ArtifactManifest[]> {
    const packageSession = getFsaProjectPackageSession(this.projectHandle);
    if (packageSession) {
      const manifests: ArtifactManifest[] = [];
      for (const path of packageSession.listEntryPaths('CACHE_ARTIFACTS')) {
        if (!isArtifactManifestFileName(path.split('/').at(-1)!)) continue;
        const bytes = packageSession.readEntry('CACHE_ARTIFACTS', path);
        if (!bytes) continue;
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
          if (isArtifactManifest(parsed)) manifests.push(parsed);
        } catch {
          // Ignore corrupt individual manifests; package validation remains intact.
        }
      }
      return manifests;
    }

    const root = await this.fileStorage.navigateToFolder(
      this.projectHandle,
      `${getFsaProjectFolderPath(this.projectHandle, 'CACHE_ARTIFACTS')}/${ARTIFACT_HASH_ALGORITHM}`,
      false,
    );
    if (!root) {
      return [];
    }

    const manifests: ArtifactManifest[] = [];
    for await (const shardEntry of (root as IterableDirectoryHandle).values()) {
      if (shardEntry.kind !== 'directory') {
        continue;
      }

      for await (const hashEntry of (shardEntry as IterableDirectoryHandle).values()) {
        if (hashEntry.kind !== 'directory') {
          continue;
        }

        for await (const fileEntry of (hashEntry as IterableDirectoryHandle).values()) {
          if (fileEntry.kind !== 'file' || !isArtifactManifestFileName(fileEntry.name)) continue;
          const manifest = await this.readManifest(hashEntry, fileEntry.name);
          if (manifest) manifests.push(manifest);
        }
      }
    }

    return manifests;
  }

  private getArtifactEntryBase(hash: string): string {
    return `${ARTIFACT_HASH_ALGORITHM}/${hash.slice(0, 2)}/${hash}`;
  }
}
