import { SIGNAL_SCHEMA_VERSION, type SignalArtifactProducer } from '../signals';
import { buildArtifactId, buildVersionedArtifactId, artifactManifestFileName, normalizeArtifactId } from './ids';
import { artifactInputToBlob, sha256Blob } from './hash';
import {
  ARTIFACT_HASH_ALGORITHM,
  type ArtifactInput,
  type ArtifactManifest,
  type ArtifactStorageAdapter,
  type PutArtifactOptions,
  type PutArtifactResult,
  type StoredArtifact,
} from './types';

import { frozenJson } from '../services/project/repository/segments/canonical';
import { hashArtifactManifest } from '../services/project/repository/artifacts/manifestIdentity';

const DEFAULT_MIME_TYPE = 'application/octet-stream';
const DEFAULT_PRODUCER_ID = 'masterselects.core.artifact-store';

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].toSorted();
}

function buildProducer(producer?: Partial<SignalArtifactProducer>): SignalArtifactProducer {
  return {
    providerId: producer?.providerId ?? DEFAULT_PRODUCER_ID,
    providerVersion: producer?.providerVersion,
    jobId: producer?.jobId,
  };
}

function defaultNow(): string {
  return new Date().toISOString();
}

export class ArtifactStore {
  private readonly adapter: ArtifactStorageAdapter;
  private readonly now: () => string;

  constructor(adapter: ArtifactStorageAdapter, now: () => string = defaultNow) {
    this.adapter = adapter;
    this.now = now;
  }

  async putArtifact(
    input: ArtifactInput,
    options: PutArtifactOptions = {},
  ): Promise<PutArtifactResult> {
    const mimeType = options.mimeType ?? (input instanceof Blob ? input.type : '') ?? DEFAULT_MIME_TYPE;
    const blob = await artifactInputToBlob(input, mimeType || DEFAULT_MIME_TYPE);
    const hash = await sha256Blob(blob, options.signal);
    const artifactId = buildArtifactId(hash);
    const existingManifest = await this.adapter.getArtifactManifest(artifactId);

    let nextManifest: ArtifactManifest = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      artifactId,
      hash,
      hashAlgorithm: ARTIFACT_HASH_ALGORITHM,
      blobId: artifactId,
      retention: options.retention ?? 'required',
      size: blob.size,
      mimeType: mimeType || DEFAULT_MIME_TYPE,
      encoding: options.encoding ?? 'raw',
      storage: this.adapter.createStorageLocation(hash),
      producer: buildProducer(options.producer),
      sourceRefs: uniqueStrings(options.sourceRefs ?? []),
      createdAt: options.createdAt ?? this.now(),
      metadata: options.metadata,
    };

    // The logical description has a separate immutable identity from shared bytes.
    const manifestHash = await hashArtifactManifest(nextManifest);
    nextManifest = { ...nextManifest, artifactId: buildVersionedArtifactId(hash, manifestHash), manifestHash };
    if (nextManifest.storage.manifestProjectRelativePath) {
      nextManifest.storage = { ...nextManifest.storage, manifestProjectRelativePath: nextManifest.storage.manifestProjectRelativePath.replace(/[^/]+$/, artifactManifestFileName(nextManifest)) };
    }
    nextManifest = frozenJson(nextManifest);
    const version = await this.adapter.getArtifactManifest(nextManifest.artifactId);
    if (version && await this.adapter.hasArtifactBlob(version)) return { manifest: version, deduplicated: true };
    if (await this.adapter.hasArtifactBlob(existingManifest ?? nextManifest)) {
      await this.adapter.saveArtifactManifest(nextManifest, options.signal);
      return { manifest: nextManifest, deduplicated: true };
    }

    await this.adapter.writeArtifact(nextManifest, blob, options.signal);
    return {
      manifest: nextManifest,
      deduplicated: false,
    };
  }

  async getArtifact(ref: string): Promise<StoredArtifact | null> {
    const artifactId = normalizeArtifactId(ref);
    const manifest = await this.adapter.getArtifactManifest(artifactId);
    if (!manifest) {
      return null;
    }

    const blob = await this.adapter.readArtifactBlob(manifest);
    if (!blob) {
      return null;
    }

    return { manifest, blob };
  }

  async getArtifactManifest(ref: string): Promise<ArtifactManifest | null> {
    return this.adapter.getArtifactManifest(normalizeArtifactId(ref));
  }

  async hasArtifact(ref: string): Promise<boolean> {
    const artifactId = normalizeArtifactId(ref);
    const manifest = await this.adapter.getArtifactManifest(artifactId);
    return manifest ? this.adapter.hasArtifactBlob(manifest) : false;
  }

  async listArtifacts(): Promise<ArtifactManifest[]> {
    return this.adapter.listArtifactManifests();
  }

  async listArtifactsBySource(sourceRef: string): Promise<ArtifactManifest[]> {
    return this.adapter.listArtifactManifestsBySource(sourceRef);
  }

  async deleteArtifact(ref: string): Promise<boolean> {
    const artifactId = normalizeArtifactId(ref);
    const manifest = await this.adapter.getArtifactManifest(artifactId);
    if (!manifest) {
      return false;
    }

    // Version deletion cannot remove bytes still used by another immutable version.
    const versions = await this.adapter.listArtifactManifests();
    const shared = versions.some(version => version.artifactId !== artifactId && version.hash === manifest.hash);
    const deletedBlob = shared ? false : await this.adapter.deleteArtifactBlob(manifest);
    await this.adapter.deleteArtifactManifest(artifactId);
    return deletedBlob;
  }

}
