import { blobToArrayBuffer, type ArtifactInput, type ArtifactManifest, type ArtifactStore } from '../../artifacts';
import type { SignalArtifactEncoding, SignalMetadata } from '../../signals';
import {
  AUDIO_ARTIFACT_SCHEMA_VERSION,
  audioAnalysisSourceRef,
  audioArtifactRefFromSignalArtifact,
  audioMediaSourceRef,
  createAudioArtifactId,
  isAudioAnalysisArtifactKind,
  type AudioAnalysisArtifact,
  type AudioAnalysisArtifactKind,
  type AudioArtifactPayloadOptions,
  type AudioArtifactRef,
  type PersistedAudioAnalysisArtifact,
  type PutAudioAnalysisArtifactInput,
  type PutAudioAnalysisArtifactResult,
} from './audioArtifactTypes';

const AUDIO_ARTIFACT_MANIFEST_MIME_TYPE = 'application/vnd.masterselects.audio-analysis+json';
const AUDIO_ARTIFACT_PROVIDER_ID = 'masterselects.audio.artifacts';
const DEFAULT_PAYLOAD_MIME_TYPE = 'application/octet-stream';
const DEFAULT_PAYLOAD_ENCODING: SignalArtifactEncoding = 'raw';

function jsonBlob(value: unknown, mimeType: string): Blob {
  return new Blob([JSON.stringify(value)], { type: mimeType });
}

function metadataWithAudioFields(
  metadata: SignalMetadata | undefined,
  fields: SignalMetadata,
): SignalMetadata {
  return {
    ...(metadata ?? {}),
    ...fields,
  };
}

function manifestSourceRefs(
  kind: AudioAnalysisArtifactKind,
  mediaFileId: string,
  extraRefs: string[] = [],
): string[] {
  return [
    audioMediaSourceRef(mediaFileId),
    audioAnalysisSourceRef(kind, mediaFileId),
    ...extraRefs,
  ];
}

function assertAudioAnalysisArtifact(value: unknown): PersistedAudioAnalysisArtifact {
  if (!value || typeof value !== 'object') {
    throw new Error('Audio analysis manifest is not an object.');
  }

  const artifact = value as Partial<PersistedAudioAnalysisArtifact>;
  if (artifact.schemaVersion !== AUDIO_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported audio artifact schema version: ${artifact.schemaVersion}`);
  }

  if (!isAudioAnalysisArtifactKind(artifact.kind)) {
    throw new Error(`Unsupported audio analysis artifact kind: ${String(artifact.kind)}`);
  }

  if (!artifact.id || !artifact.mediaFileId || !artifact.sourceFingerprint) {
    throw new Error('Audio analysis manifest is missing required identity fields.');
  }

  return artifact as PersistedAudioAnalysisArtifact;
}

function refFromManifest(manifest: ArtifactManifest): AudioArtifactRef {
  return audioArtifactRefFromSignalArtifact(manifest);
}

async function blobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blobToArrayBuffer(blob));
}

export class AudioArtifactStore {
  private readonly artifactStore: ArtifactStore;

  constructor(artifactStore: ArtifactStore) {
    this.artifactStore = artifactStore;
  }

  async putPayload(
    input: ArtifactInput,
    options: AudioArtifactPayloadOptions,
  ): Promise<AudioArtifactRef> {
    const result = await this.artifactStore.putArtifact(input, {
      mimeType: options.mimeType ?? DEFAULT_PAYLOAD_MIME_TYPE,
      encoding: options.encoding ?? DEFAULT_PAYLOAD_ENCODING,
      producer: {
        providerId: AUDIO_ARTIFACT_PROVIDER_ID,
        providerVersion: options.analyzerVersion,
      },
      sourceRefs: manifestSourceRefs(options.kind, options.mediaFileId, options.sourceRefs),
      createdAt: options.createdAt,
      metadata: metadataWithAudioFields(options.metadata, {
        audioArtifactRole: 'payload',
        audioAnalysisKind: options.kind,
        mediaFileId: options.mediaFileId,
        sourceFingerprint: options.sourceFingerprint,
        ...(options.clipAudioStateHash ? { clipAudioStateHash: options.clipAudioStateHash } : {}),
      }),
    });

    return refFromManifest(result.manifest);
  }

  async putAnalysisArtifact(
    input: PutAudioAnalysisArtifactInput,
  ): Promise<PutAudioAnalysisArtifactResult> {
    const artifactId = input.id || createAudioArtifactId(
      input.kind,
      input.mediaFileId,
      input.sourceFingerprint,
      input.clipAudioStateHash,
    );

    const persisted: PersistedAudioAnalysisArtifact = {
      ...input,
      id: artifactId,
      schemaVersion: AUDIO_ARTIFACT_SCHEMA_VERSION,
    };

    const result = await this.artifactStore.putArtifact(jsonBlob(persisted, AUDIO_ARTIFACT_MANIFEST_MIME_TYPE), {
      mimeType: AUDIO_ARTIFACT_MANIFEST_MIME_TYPE,
      encoding: 'json',
      producer: {
        providerId: AUDIO_ARTIFACT_PROVIDER_ID,
        providerVersion: input.analyzerVersion,
      },
      sourceRefs: manifestSourceRefs(input.kind, input.mediaFileId),
      metadata: metadataWithAudioFields(input.metadata, {
        audioArtifactRole: 'manifest',
        audioAnalysisKind: input.kind,
        audioAnalysisArtifactId: artifactId,
        mediaFileId: input.mediaFileId,
        sourceFingerprint: input.sourceFingerprint,
        stale: input.stale,
        ...(input.clipAudioStateHash ? { clipAudioStateHash: input.clipAudioStateHash } : {}),
      }),
    });

    return {
      artifact: {
        ...persisted,
        manifestRef: refFromManifest(result.manifest),
      },
      deduplicated: result.deduplicated,
    };
  }

  async getAnalysisArtifact(ref: string): Promise<AudioAnalysisArtifact | null> {
    const stored = await this.artifactStore.getArtifact(ref);
    if (!stored) {
      return null;
    }

    const persisted = assertAudioAnalysisArtifact(JSON.parse(await blobText(stored.blob)));
    return {
      ...persisted,
      manifestRef: refFromManifest(stored.manifest),
    };
  }

  async getPayload(ref: string): Promise<Blob | null> {
    const stored = await this.artifactStore.getArtifact(ref);
    return stored?.blob ?? null;
  }

  async listAnalysisArtifacts(
    mediaFileId: string,
    kind?: AudioAnalysisArtifactKind,
  ): Promise<AudioAnalysisArtifact[]> {
    const sourceRef = kind
      ? audioAnalysisSourceRef(kind, mediaFileId)
      : audioMediaSourceRef(mediaFileId);
    const manifests = await this.artifactStore.listArtifactsBySource(sourceRef);
    const artifacts = await Promise.all(manifests
      .filter((manifest) => manifest.metadata?.audioArtifactRole === 'manifest')
      .map((manifest) => this.getAnalysisArtifact(manifest.artifactId)));

    return artifacts.filter((artifact): artifact is AudioAnalysisArtifact => Boolean(artifact));
  }
}
