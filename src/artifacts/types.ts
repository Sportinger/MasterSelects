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
  saveArtifactManifest(manifest: ArtifactManifest): Promise<void>;
  getArtifactManifest(artifactId: string): Promise<ArtifactManifest | null>;
  listArtifactManifests(): Promise<ArtifactManifest[]>;
  listArtifactManifestsBySource(sourceRef: string): Promise<ArtifactManifest[]>;
  deleteArtifactManifest(artifactId: string): Promise<void>;
}

export interface ArtifactStorageAdapter extends ArtifactManifestIndex {
  createStorageLocation(hash: string): ArtifactStorageLocation;
  writeArtifact(manifest: ArtifactManifest, blob: Blob): Promise<void>;
  readArtifactBlob(manifest: ArtifactManifest): Promise<Blob | null>;
  hasArtifactBlob(manifest: ArtifactManifest): Promise<boolean>;
  deleteArtifactBlob(manifest: ArtifactManifest): Promise<boolean>;
}
