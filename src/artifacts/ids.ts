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
  const versioned = /^artifact:sha256:([a-f0-9]{64}):manifest:([a-f0-9]{64})$/i.exec(artifactId);
  if (versioned) return versioned[1].toLowerCase();
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

  if (getManifestHashFromArtifactId(normalizedRef)) return normalizedRef;
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

export function buildVersionedArtifactId(blobHash: string, manifestHash: string): string {
  const blob = blobHash.replace(/^sha256:/, '').toLowerCase();
  const manifest = manifestHash.replace(/^sha256:/, '').toLowerCase();
  if (!isSha256Hash(blob) || !isSha256Hash(manifest)) throw new Error('Invalid artifact version hashes');
  return `artifact:sha256:${blob}:manifest:${manifest}`;
}
export function getManifestHashFromArtifactId(id: string): string | null {
  const match = /^artifact:sha256:[a-f0-9]{64}:manifest:([a-f0-9]{64})$/i.exec(id);
  return match ? `sha256:${match[1].toLowerCase()}` : null;
}
export function artifactManifestFileName(manifest: { manifestHash?: string }): string {
  if (!manifest.manifestHash) return ARTIFACT_MANIFEST_FILE_NAME;
  const hash = manifest.manifestHash.replace(/^sha256:/, '');
  if (!isSha256Hash(hash)) throw new Error('Invalid immutable manifest hash');
  return `manifest.${hash}.json`;
}
export function isArtifactManifestFileName(name: string): boolean {
  return name === ARTIFACT_MANIFEST_FILE_NAME || /^manifest\.[a-f0-9]{64}\.json$/.test(name);
}
