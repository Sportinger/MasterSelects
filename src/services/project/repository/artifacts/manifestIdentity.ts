import type { ArtifactManifest } from '../../../../artifacts/types';
import { canonicalBytes, hashBytes } from '../segments/canonical';
/** Storage locators and self-addresses are not part of a semantic manifest identity. */
export function artifactManifestPayload(manifest: ArtifactManifest) {
  const { artifactId: _id, manifestHash: _hash, storage: _location, ...payload } = manifest;
  return payload;
}
export async function hashArtifactManifest(manifest: ArtifactManifest): Promise<string> {
  return hashBytes(canonicalBytes(artifactManifestPayload(manifest)));
}
