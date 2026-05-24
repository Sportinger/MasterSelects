import type {
  JsonValue,
  SignalArtifact,
  SignalAsset,
  SignalKind,
  SignalMetadata,
} from '../../../signals';
import type {
  LabelColor,
  SignalAssetItem,
  SignalAssetItemDiagnostic,
} from '../types';

export interface SignalAssetItemProjectMetadata {
  id: string;
  parentId: string | null;
  createdAt: number;
  labelColor?: LabelColor;
}

export interface CreateSignalAssetItemOptions {
  parentId?: string | null;
  createdAt?: number;
  labelColor?: LabelColor;
  diagnostics?: SignalAssetItemDiagnostic[];
  providerId?: string;
}

function parseSignalCreatedAt(value: string | undefined): number {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function uniqueSignalKinds(asset: SignalAsset): SignalKind[] {
  const seen = new Set<SignalKind>();
  const kinds: SignalKind[] = [];

  asset.refs.forEach((ref) => {
    if (seen.has(ref.kind)) return;
    seen.add(ref.kind);
    kinds.push(ref.kind);
  });

  return kinds;
}

export function createSignalAssetItem(
  asset: SignalAsset,
  options: CreateSignalAssetItemOptions = {},
): SignalAssetItem {
  const primaryArtifact = asset.artifacts[0];
  return {
    id: asset.id,
    name: asset.name,
    type: 'signal',
    parentId: options.parentId ?? null,
    createdAt: options.createdAt ?? parseSignalCreatedAt(asset.createdAt),
    labelColor: options.labelColor,
    asset,
    artifacts: asset.artifacts,
    signalKinds: uniqueSignalKinds(asset),
    providerId: options.providerId ?? asset.source.providerId ?? primaryArtifact?.producer.providerId,
    fileSize: asset.source.size ?? primaryArtifact?.size,
    fileHash: asset.source.hash ?? primaryArtifact?.hash,
    diagnostics: options.diagnostics,
  };
}

export function signalAssetItemToProjectMetadata(
  item: SignalAssetItem,
): SignalAssetItemProjectMetadata {
  return {
    id: item.id,
    parentId: item.parentId,
    createdAt: item.createdAt,
    labelColor: item.labelColor,
  };
}

function remapJsonArtifactIds(
  value: JsonValue,
  artifactsByOriginalId: ReadonlyMap<string, SignalArtifact>,
): JsonValue {
  if (typeof value === 'string') {
    return artifactsByOriginalId.get(value)?.artifactId ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => remapJsonArtifactIds(entry, artifactsByOriginalId));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        remapJsonArtifactIds(entry, artifactsByOriginalId),
      ]),
    );
  }

  return value;
}

function remapSignalMetadataArtifactIds(
  metadata: SignalMetadata | undefined,
  artifactsByOriginalId: ReadonlyMap<string, SignalArtifact>,
): SignalMetadata | undefined {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      remapJsonArtifactIds(value, artifactsByOriginalId),
    ]),
  );
}

export function remapSignalAssetArtifacts(
  asset: SignalAsset,
  artifactsByOriginalId: ReadonlyMap<string, SignalArtifact>,
): SignalAsset {
  if (artifactsByOriginalId.size === 0) {
    return asset;
  }

  return {
    ...asset,
    refs: asset.refs.map((ref) => ({
      ...ref,
      artifactId: ref.artifactId
        ? artifactsByOriginalId.get(ref.artifactId)?.artifactId ?? ref.artifactId
        : undefined,
      metadata: remapSignalMetadataArtifactIds(ref.metadata, artifactsByOriginalId),
    })),
    artifacts: asset.artifacts.map((artifact) => {
      const storedArtifact = artifactsByOriginalId.get(artifact.artifactId) ?? artifact;
      return {
        ...storedArtifact,
        metadata: remapSignalMetadataArtifactIds(storedArtifact.metadata, artifactsByOriginalId),
      };
    }),
    metadata: remapSignalMetadataArtifactIds(asset.metadata, artifactsByOriginalId),
    updatedAt: asset.updatedAt ?? new Date().toISOString(),
  };
}

export function mergeSignalArtifacts(
  current: SignalArtifact[],
  incoming: SignalArtifact[],
): SignalArtifact[] {
  const byId = new Map<string, SignalArtifact>();
  current.forEach((artifact) => byId.set(artifact.artifactId, artifact));
  incoming.forEach((artifact) => byId.set(artifact.artifactId, artifact));
  return [...byId.values()];
}
