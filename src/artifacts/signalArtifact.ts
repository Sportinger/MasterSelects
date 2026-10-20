import type { SignalArtifact } from '../signals';
import type { ArtifactManifest } from './types';

/**
 * Project state keeps the logical SignalArtifact only. Store bookkeeping
 * (blobId, manifestHash, retention, hashAlgorithm) stays in the artifact
 * store's own manifest and is rejected by the project repository's field
 * ownership check, so stored manifests must pass through here first.
 */
export function toSignalArtifact(manifest: ArtifactManifest | SignalArtifact): SignalArtifact {
  const artifact: SignalArtifact = {
    schemaVersion: manifest.schemaVersion,
    artifactId: manifest.artifactId,
    hash: manifest.hash,
    size: manifest.size,
    mimeType: manifest.mimeType,
    encoding: manifest.encoding,
    storage: manifest.storage,
    producer: manifest.producer,
    sourceRefs: manifest.sourceRefs,
    createdAt: manifest.createdAt,
  };
  if (manifest.byteRange) artifact.byteRange = manifest.byteRange;
  if (manifest.metadata) artifact.metadata = manifest.metadata;
  return artifact;
}
