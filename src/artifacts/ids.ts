import { PROJECT_FOLDERS } from '../services/project/core/constants';
import {
  ARTIFACT_BINARY_FILE_NAME,
  ARTIFACT_HASH_ALGORITHM,
  ARTIFACT_MANIFEST_FILE_NAME,
} from './types';

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export function isSha256Hash(value: string): boolean {
  return SHA256_HEX_PATTERN.test(value);
}

export function buildArtifactId(hash: string): string {
  const normalizedHash = hash.toLowerCase();
  if (!isSha256Hash(normalizedHash)) {
    throw new Error(`Invalid SHA-256 hash: ${hash}`);
  }
  return `${ARTIFACT_HASH_ALGORITHM}:${normalizedHash}`;
}

export function getHashFromArtifactId(artifactId: string): string | null {
  const prefix = `${ARTIFACT_HASH_ALGORITHM}:`;
  if (!artifactId.startsWith(prefix)) {
    return null;
  }

  const hash = artifactId.slice(prefix.length).toLowerCase();
  return isSha256Hash(hash) ? hash : null;
}

export function normalizeArtifactId(ref: string): string {
  const normalizedRef = ref.toLowerCase();
  if (isSha256Hash(normalizedRef)) {
    return buildArtifactId(normalizedRef);
  }

  return ref;
}

export function buildArtifactProjectRelativePath(
  hash: string,
  fileName = ARTIFACT_BINARY_FILE_NAME,
): string {
  const normalizedHash = hash.toLowerCase();
  if (!isSha256Hash(normalizedHash)) {
    throw new Error(`Invalid SHA-256 hash: ${hash}`);
  }

  return [
    PROJECT_FOLDERS.CACHE_ARTIFACTS,
    ARTIFACT_HASH_ALGORITHM,
    normalizedHash.slice(0, 2),
    normalizedHash,
    fileName,
  ].join('/');
}

export function buildArtifactManifestProjectRelativePath(hash: string): string {
  return buildArtifactProjectRelativePath(hash, ARTIFACT_MANIFEST_FILE_NAME);
}
