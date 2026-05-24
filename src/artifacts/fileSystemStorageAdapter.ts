import { Logger } from '../services/logger';
import { FileStorageService, fileStorageService } from '../services/project/core/FileStorageService';
import { PROJECT_FOLDERS } from '../services/project/core/constants';
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
} from './ids';
import { isArtifactManifest } from './guards';

const log = Logger.create('ArtifactFS');

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
};

export class FileSystemArtifactStorageAdapter implements ArtifactStorageAdapter {
  private readonly projectHandle: FileSystemDirectoryHandle;
  private readonly fileStorage: FileStorageService;
  private readonly index: ArtifactManifestIndex | null;

  constructor(
    projectHandle: FileSystemDirectoryHandle,
    fileStorage: FileStorageService = fileStorageService,
    index: ArtifactManifestIndex | null = null,
  ) {
    this.projectHandle = projectHandle;
    this.fileStorage = fileStorage;
    this.index = index;
  }

  createStorageLocation(hash: string): ArtifactStorageLocation {
    return {
      kind: 'project-cache',
      projectRelativePath: buildArtifactProjectRelativePath(hash),
      manifestProjectRelativePath: buildArtifactManifestProjectRelativePath(hash),
    };
  }

  async writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void> {
    const directory = await this.getArtifactDirectory(manifest.hash, true);
    if (!directory) {
      throw new Error(`Unable to create artifact directory for ${manifest.artifactId}`);
    }

    await this.writeFile(directory, ARTIFACT_BINARY_FILE_NAME, blob);
    await this.writeFile(directory, ARTIFACT_MANIFEST_FILE_NAME, JSON.stringify(manifest, null, 2));
    await this.index?.saveArtifactManifest(manifest);
  }

  async saveArtifactManifest(manifest: ArtifactManifest): Promise<void> {
    const directory = await this.getArtifactDirectory(manifest.hash, true);
    if (!directory) {
      throw new Error(`Unable to create artifact directory for ${manifest.artifactId}`);
    }

    await this.writeFile(directory, ARTIFACT_MANIFEST_FILE_NAME, JSON.stringify(manifest, null, 2));
    await this.index?.saveArtifactManifest(manifest);
  }

  async getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null> {
    const indexedManifest = await this.index?.getArtifactManifest(artifactId);
    if (indexedManifest) {
      return indexedManifest;
    }

    const manifests = await this.scanManifests();
    return manifests.find((manifest) => manifest.artifactId === artifactId) ?? null;
  }

  async listArtifactManifests(): Promise<ArtifactManifest[]> {
    const indexedManifests = await this.index?.listArtifactManifests();
    if (indexedManifests && indexedManifests.length > 0) {
      return indexedManifests;
    }

    return this.scanManifests();
  }

  async listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    const indexedManifests = await this.index?.listArtifactManifestsBySource(sourceRef);
    if (indexedManifests && indexedManifests.length > 0) {
      return indexedManifests;
    }

    const manifests = await this.scanManifests();
    return manifests.filter((manifest) => manifest.sourceRefs.includes(sourceRef));
  }

  async deleteArtifactManifest(artifactId: string): Promise<void> {
    const manifest = await this.getArtifactManifest(artifactId);
    if (!manifest) {
      return;
    }

    try {
      const directory = await this.getArtifactDirectory(manifest.hash, false);
      await directory?.removeEntry(ARTIFACT_MANIFEST_FILE_NAME);
    } catch {
      // The full artifact directory may already be gone after blob deletion.
    }

    await this.index?.deleteArtifactManifest(artifactId);
  }

  async readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null> {
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
    try {
      const shardDirectory = await this.fileStorage.navigateToFolder(
        this.projectHandle,
        `${PROJECT_FOLDERS.CACHE_ARTIFACTS}/${ARTIFACT_HASH_ALGORITHM}/${manifest.hash.slice(0, 2)}`,
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
      `${PROJECT_FOLDERS.CACHE_ARTIFACTS}/${ARTIFACT_HASH_ALGORITHM}/${hash.slice(0, 2)}/${hash}`,
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

  private async readManifest(directory: FileSystemDirectoryHandle): Promise<ArtifactManifest | null> {
    try {
      const fileHandle = await directory.getFileHandle(ARTIFACT_MANIFEST_FILE_NAME);
      const file = await fileHandle.getFile();
      const parsed = JSON.parse(await file.text()) as unknown;
      return isArtifactManifest(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private async scanManifests(): Promise<ArtifactManifest[]> {
    const root = await this.fileStorage.navigateToFolder(
      this.projectHandle,
      `${PROJECT_FOLDERS.CACHE_ARTIFACTS}/${ARTIFACT_HASH_ALGORITHM}`,
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

        const manifest = await this.readManifest(hashEntry);
        if (manifest) {
          manifests.push(manifest);
        }
      }
    }

    return manifests;
  }
}
