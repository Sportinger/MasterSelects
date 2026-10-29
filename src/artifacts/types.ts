import {
  SIGNAL_SCHEMA_VERSION,
  type SignalArtifact,
  type SignalArtifactEncoding,
  type SignalArtifactProducer,
  type SignalArtifactStorage,
  type SignalMetadata,
} from '../signals';

export const ARTIFACT_HASH_ALGORITHM = 'sha256' as const;
export const ARTIFACT_BINARY_FILE_NAME = 'artifact.bin';
export const ARTIFACT_MANIFEST_FILE_NAME = 'manifest.json';

export type ArtifactHashAlgorithm = typeof ARTIFACT_HASH_ALGORITHM;
export type ArtifactInput = Blob | File | ArrayBuffer;

export interface ArtifactStorageLocation extends SignalArtifactStorage {
  kind: SignalArtifactStorage['kind'];
  projectRelativePath?: string;
  manifestProjectRelativePath?: string;
  uri?: string;
}

export interface ArtifactManifest extends SignalArtifact {
  /** New immutable manifest identity; absent only on imported legacy manifests. */
  manifestHash?: string;
  blobId?: string;
  retention?: 'required' | 'reproducible-cache' | 'temporary';
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  hashAlgorithm: ArtifactHashAlgorithm;
  encoding: SignalArtifactEncoding;
  storage: ArtifactStorageLocation;
}

export interface PutArtifactOptions {
  mimeType?: string;
  encoding?: SignalArtifactEncoding;
  producer?: Partial<SignalArtifactProducer>;
  sourceRefs?: string[];
  metadata?: SignalMetadata;
  createdAt?: string;
  retention?: 'required' | 'reproducible-cache' | 'temporary';
  signal?: AbortSignal;
  /** How the stored bytes are confirmed (see ArtifactWriteOptions); adapters without a choice ignore it. */
  writeConfirmation?: ArtifactWriteConfirmation;
}

/**
 * 'read-back' (default): every stored byte is read and hashed again after the write. 'length': the hash
 * was checked on the exact bytes written, the write is confirmed by the stored length only, and the blob is
 * trusted for the rest of the session; only project media copies (Raw originals) ask for it.
 */
export type ArtifactWriteConfirmation = 'read-back' | 'length';

export interface ArtifactWriteOptions {
  writeConfirmation?: ArtifactWriteConfirmation;
}

export interface PutArtifactResult {
  manifest: ArtifactManifest;
  deduplicated: boolean;
}

export interface StoredArtifact {
  manifest: ArtifactManifest;
  blob: Blob;
}

export interface ArtifactManifestIndex {
  saveArtifactManifest(manifest: ArtifactManifest, signal?: AbortSignal): Promise<void>;
  getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null>;
  listArtifactManifests(): Promise<ArtifactManifest[]>;
  listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]>;
  deleteArtifactManifest(artifactId: string): Promise<void>;
}

export interface ArtifactStorageAdapter extends ArtifactManifestIndex {
  createStorageLocation(hash: string): ArtifactStorageLocation;
  writeArtifact(manifest: ArtifactManifest, blob: Blob, signal?: AbortSignal, options?: ArtifactWriteOptions): Promise<void>;
  /** Optional: hash the bytes where they are stored (e.g. in a storage worker); hex SHA-256 without prefix. */
  hashArtifactBlob?(blob: Blob, signal?: AbortSignal): Promise<string>;
  readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null>;
  hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean>;
  deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean>;
}
