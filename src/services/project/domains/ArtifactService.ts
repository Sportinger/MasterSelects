import {
  ArtifactStore,
  FileSystemArtifactStorageAdapter,
  ProjectDBArtifactStorageAdapter,
  ProjectDBArtifactManifestIndex,
  type ArtifactInput,
  type ArtifactManifest,
  type PutArtifactOptions,
  type PutArtifactResult,
  type StoredArtifact,
} from '../../../artifacts';
import { FileStorageService, fileStorageService } from '../core/FileStorageService';

export class ArtifactService {
  private readonly fileStorage: FileStorageService;

  constructor(fileStorage: FileStorageService = fileStorageService) {
    this.fileStorage = fileStorage;
  }

  createStore(projectHandle: FileSystemDirectoryHandle): ArtifactStore {
    return new ArtifactStore(
      new FileSystemArtifactStorageAdapter(
        projectHandle,
        this.fileStorage,
        new ProjectDBArtifactManifestIndex(),
      ),
    );
  }

  createIndexedDBStore(): ArtifactStore {
    return new ArtifactStore(new ProjectDBArtifactStorageAdapter());
  }

  async putArtifact(
    projectHandle: FileSystemDirectoryHandle,
    input: ArtifactInput,
    options?: PutArtifactOptions,
  ): Promise<PutArtifactResult> {
    return this.createStore(projectHandle).putArtifact(input, options);
  }

  async putIndexedDBArtifact(
    input: ArtifactInput,
    options?: PutArtifactOptions,
  ): Promise<PutArtifactResult> {
    return this.createIndexedDBStore().putArtifact(input, options);
  }

  async getIndexedDBArtifact(ref: string): Promise<StoredArtifact | null> {
    return this.createIndexedDBStore().getArtifact(ref);
  }

  async getArtifact(
    projectHandle: FileSystemDirectoryHandle,
    ref: string,
  ): Promise<StoredArtifact | null> {
    return this.createStore(projectHandle).getArtifact(ref);
  }

  async hasArtifact(
    projectHandle: FileSystemDirectoryHandle,
    ref: string,
  ): Promise<boolean> {
    return this.createStore(projectHandle).hasArtifact(ref);
  }

  async listArtifacts(projectHandle: FileSystemDirectoryHandle): Promise<ArtifactManifest[]> {
    return this.createStore(projectHandle).listArtifacts();
  }

  async listArtifactsBySource(
    projectHandle: FileSystemDirectoryHandle,
    sourceRef: string,
  ): Promise<ArtifactManifest[]> {
    return this.createStore(projectHandle).listArtifactsBySource(sourceRef);
  }

  async deleteArtifact(
    projectHandle: FileSystemDirectoryHandle,
    ref: string,
  ): Promise<boolean> {
    return this.createStore(projectHandle).deleteArtifact(ref);
  }
}

export const artifactService = new ArtifactService();
