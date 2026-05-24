import {
  SIGNAL_SCHEMA_VERSION,
  type SignalArtifact,
  type SignalArtifactEncoding,
  type SignalArtifactStorage,
  type SignalAsset,
  type SignalAssetSource,
  type SignalKind,
  type SignalMetadata,
  type SignalRef,
} from './types';
import { normalizeSignalMetadata } from './guards';

export interface SignalNormalizeOptions {
  now?: () => string;
}

export interface SignalArtifactInput {
  artifactId: string;
  hash: string;
  size: number;
  mimeType?: string;
  encoding?: SignalArtifactEncoding;
  storage?: SignalArtifactStorage;
  producer?: {
    providerId?: string;
    providerVersion?: string;
    jobId?: string;
  };
  sourceRefs?: string[];
  createdAt?: string;
  metadata?: unknown;
}

export interface SignalRefInput {
  id: string;
  kind: SignalKind;
  label?: string;
  assetId?: string;
  artifactId?: string;
  portId?: string;
  mimeType?: string;
  createdAt?: string;
  metadata?: unknown;
}

export interface SignalAssetInput {
  id: string;
  name: string;
  source: SignalAssetSource;
  refs?: SignalRefInput[];
  artifacts?: SignalArtifactInput[];
  createdAt?: string;
  updatedAt?: string;
  metadata?: unknown;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function timestamp(options?: SignalNormalizeOptions): string {
  return options?.now?.() ?? defaultNow();
}

function normalizeExtension(fileName?: string, extension?: string): string | undefined {
  const explicit = extension?.replace(/^\./, '').trim().toLowerCase();
  if (explicit) return explicit;

  const match = fileName?.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase();
}

function withMetadata(metadata: unknown): SignalMetadata | undefined {
  const normalized = normalizeSignalMetadata(metadata);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeSignalArtifact(
  artifact: SignalArtifactInput,
  options?: SignalNormalizeOptions,
): SignalArtifact {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    artifactId: artifact.artifactId,
    hash: artifact.hash,
    size: artifact.size,
    mimeType: artifact.mimeType ?? 'application/octet-stream',
    encoding: artifact.encoding ?? 'raw',
    storage: artifact.storage ?? { kind: 'memory' },
    producer: {
      providerId: artifact.producer?.providerId ?? 'masterselects.core',
      providerVersion: artifact.producer?.providerVersion,
      jobId: artifact.producer?.jobId,
    },
    sourceRefs: [...(artifact.sourceRefs ?? [])],
    createdAt: artifact.createdAt ?? timestamp(options),
    metadata: withMetadata(artifact.metadata),
  };
}

export function normalizeSignalRef(
  ref: SignalRefInput,
  options?: SignalNormalizeOptions,
): SignalRef {
  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    id: ref.id,
    kind: ref.kind,
    label: ref.label,
    assetId: ref.assetId,
    artifactId: ref.artifactId,
    portId: ref.portId,
    mimeType: ref.mimeType,
    createdAt: ref.createdAt ?? timestamp(options),
    metadata: withMetadata(ref.metadata),
  };
}

export function normalizeSignalAsset(
  asset: SignalAssetInput,
  options?: SignalNormalizeOptions,
): SignalAsset {
  const source = {
    ...asset.source,
    extension: normalizeExtension(asset.source.fileName, asset.source.extension),
  };

  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    id: asset.id,
    name: asset.name,
    source,
    refs: (asset.refs ?? []).map((ref) => normalizeSignalRef({
      ...ref,
      assetId: ref.assetId ?? asset.id,
    }, options)),
    artifacts: (asset.artifacts ?? []).map((artifact) => normalizeSignalArtifact(artifact, options)),
    createdAt: asset.createdAt ?? timestamp(options),
    updatedAt: asset.updatedAt,
    metadata: withMetadata(asset.metadata),
  };
}

export function createBinarySignalAsset(
  asset: Omit<SignalAssetInput, 'refs'> & {
    artifact?: SignalArtifactInput;
    refId?: string;
    kind?: SignalKind;
  },
  options?: SignalNormalizeOptions,
): SignalAsset {
  const artifact = asset.artifact;
  return normalizeSignalAsset({
    ...asset,
    artifacts: artifact ? [artifact, ...(asset.artifacts ?? [])] : asset.artifacts,
    refs: [
      {
        id: asset.refId ?? `${asset.id}:binary`,
        kind: asset.kind ?? 'binary',
        artifactId: artifact?.artifactId,
        mimeType: asset.source.mimeType,
      },
    ],
  }, options);
}
