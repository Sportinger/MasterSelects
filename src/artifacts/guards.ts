import { isSignalArtifact } from '../signals';
import { ARTIFACT_HASH_ALGORITHM, type ArtifactManifest } from './types';
import { isSha256Hash } from './ids';

export function isArtifactManifest(value: unknown): value is ArtifactManifest {
  const manifest = value as Partial<ArtifactManifest>;
  return isSignalArtifact(value) &&
    manifest.hashAlgorithm === ARTIFACT_HASH_ALGORITHM &&
    isSha256Hash(manifest.hash ?? '');
}
