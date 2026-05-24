import { SIGNAL_SCHEMA_VERSION, type SignalArtifactProducer, type SignalMetadata } from '../signals';
import { buildArtifactId, normalizeArtifactId } from './ids';
import { artifactInputToBlob, blobToArrayBuffer, sha256ArrayBuffer } from './hash';
import {
  ARTIFACT_HASH_ALGORITHM,
  type ArtifactInput,
  type ArtifactManifest,
  type ArtifactStorageAdapter,
  type PutArtifactOptions,
  type PutArtifactResult,
  type StoredArtifact,
} from './types';

const DEFAULT_MIME_TYPE = 'application/octet-stream';
const DEFAULT_PRODUCER_ID = 'masterselects.core.artifact-store';

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function mergeMetadata(
  current: SignalMetadata | undefined,
  incoming: SignalMetadata | undefined,
): SignalMetadata | undefined {
  if (!current && !incoming) {
    return undefined;
  }

  return {
    ...(current ?? {}),
    ...(incoming ?? {}),
  };
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
    const hash = await sha256ArrayBuffer(await blobToArrayBuffer(blob));
    const artifactId = buildArtifactId(hash);
    const existingManifest = await this.adapter.getArtifactManifest(artifactId);

    const nextManifest: ArtifactManifest = {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      artifactId,
      hash,
      hashAlgorithm: ARTIFACT_HASH_ALGORITHM,
      size: blob.size,
      mimeType: mimeType || DEFAULT_MIME_TYPE,
      encoding: options.encoding ?? 'raw',
      storage: this.adapter.createStorageLocation(hash),
      producer: buildProducer(options.producer),
      sourceRefs: uniqueStrings(options.sourceRefs ?? []),
      createdAt: options.createdAt ?? this.now(),
      metadata: options.metadata,
    };

    if (existingManifest && await this.adapter.hasArtifactBlob(existingManifest)) {
      const mergedManifest = this.mergeManifests(existingManifest, nextManifest);
      await this.adapter.saveArtifactManifest(mergedManifest);
      return {
        manifest: mergedManifest,
        deduplicated: true,
      };
    }

    await this.adapter.writeArtifact(nextManifest, blob);
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

    const deletedBlob = await this.adapter.deleteArtifactBlob(manifest);
    await this.adapter.deleteArtifactManifest(artifactId);
    return deletedBlob;
  }

  private mergeManifests(
    existingManifest: ArtifactManifest,
    nextManifest: ArtifactManifest,
  ): ArtifactManifest {
    return {
      ...existingManifest,
      sourceRefs: uniqueStrings([
        ...existingManifest.sourceRefs,
        ...nextManifest.sourceRefs,
      ]),
      metadata: mergeMetadata(existingManifest.metadata, nextManifest.metadata),
    };
  }
}
