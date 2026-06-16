import type {
  RenderResourceDescriptor,
  RuntimeProviderHealthDiagnostics,
  RuntimeProviderKind,
  RuntimeResourceMemoryCost,
  RuntimeHealthStatus,
  TimelineRuntimeCoordinatorBridgeStats,
  TimelineRuntimePolicyId,
} from './runtimeCoordinatorTypes';

export type WorkerFirstProviderRuntimeKind = RuntimeProviderKind | 'runtime-frame-provider';

export interface WorkerFirstProviderRuntimeRecord extends Omit<RuntimeProviderHealthDiagnostics, 'providerKind'> {
  readonly providerKind: WorkerFirstProviderRuntimeKind;
  readonly resourceId: string;
  readonly sourceId: string;
  readonly sessionKey: string;
  readonly policyId: TimelineRuntimePolicyId | null;
  readonly memoryBytes: number;
}

export interface WorkerFirstProviderRuntimeSnapshot {
  readonly generatedAtMs: number;
  readonly providers: readonly WorkerFirstProviderRuntimeRecord[];
}

function positive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function memoryBytes(cost: RuntimeResourceMemoryCost | undefined): number {
  if (!cost) return 0;
  return positive(cost.heapBytes)
    + positive(cost.gpuBytes)
    + positive(cost.decodedFrameBytes)
    + positive(cost.encodedBytes);
}

function sourceIdForResource(resource: RenderResourceDescriptor, fallback: string): string {
  return resource.source?.sourceId
    ?? resource.source?.mediaFileId
    ?? resource.runtime?.runtimeSourceId
    ?? resource.owner.mediaFileId
    ?? resource.owner.clipId
    ?? resource.owner.ownerId
    ?? fallback;
}

function sessionKeyForResource(resource: RenderResourceDescriptor, fallback: string): string {
  const runtime = resource.runtime;
  const legacySessionKey = runtime && 'sessionKey' in runtime ? runtime.sessionKey : undefined;
  return resource.runtime?.runtimeSessionKey
    ?? legacySessionKey
    ?? resource.diagnostics?.session?.sessionKey
    ?? fallback;
}

function providerKindForResource(resource: RenderResourceDescriptor): WorkerFirstProviderRuntimeKind | null {
  switch (resource.kind) {
    case 'video-frame-provider':
      return resource.providerKind;
    case 'html-media':
      return resource.mediaElementKind === 'video' ? 'html-video' : null;
    case 'image-canvas':
      return resource.imageKind === 'html-canvas' || resource.imageKind === 'offscreen-canvas' || resource.imageKind === 'text-canvas'
        ? 'canvas'
        : 'image';
    case 'native-decoder':
      return 'native-decoder';
    case 'gpu-texture':
      return 'gpu-texture';
    default:
      return null;
  }
}

function providerIdForResource(resource: RenderResourceDescriptor, kind: WorkerFirstProviderRuntimeKind): string {
  if (resource.diagnostics?.provider?.providerId) return resource.diagnostics.provider.providerId;
  switch (resource.kind) {
    case 'video-frame-provider':
      return resource.providerId;
    case 'html-media':
      return resource.elementId;
    case 'image-canvas':
      return resource.imageId;
    case 'native-decoder':
      return resource.decoderId;
    case 'gpu-texture':
      return resource.textureId;
    default:
      return `${resource.id}:${kind}`;
  }
}

function healthStatusForResource(resource: RenderResourceDescriptor): RuntimeHealthStatus {
  return resource.diagnostics?.provider?.status ?? resource.diagnostics?.status ?? 'unknown';
}

function recordFromResource(resource: RenderResourceDescriptor): WorkerFirstProviderRuntimeRecord | null {
  const providerKind = providerKindForResource(resource);
  if (!providerKind) return null;
  const provider = resource.diagnostics?.provider;
  const providerId = providerIdForResource(resource, providerKind);
  return {
    providerId,
    providerKind: provider?.providerKind ?? providerKind,
    status: provider?.status ?? healthStatusForResource(resource),
    isReady: provider?.isReady,
    isPlaying: provider?.isPlaying,
    isSeeking: provider?.isSeeking,
    isDecodePending: provider?.isDecodePending,
    isDisposed: provider?.isDisposed,
    currentTimeSeconds: provider?.currentTimeSeconds,
    targetTimeSeconds: provider?.targetTimeSeconds,
    pendingSeekTimeSeconds: provider?.pendingSeekTimeSeconds,
    lastFrameTimeSeconds: provider?.lastFrameTimeSeconds,
    lastFrameAtMs: provider?.lastFrameAtMs,
    decodeQueueDepth: provider?.decodeQueueDepth,
    bufferedFrameCount: provider?.bufferedFrameCount,
    droppedFrameCount: provider?.droppedFrameCount,
    averageDecodeLatencyMs: provider?.averageDecodeLatencyMs,
    maxDecodeLatencyMs: provider?.maxDecodeLatencyMs,
    driftMs: provider?.driftMs,
    readyState: provider?.readyState,
    networkState: provider?.networkState,
    gpuDeviceLost: provider?.gpuDeviceLost,
    errorCode: provider?.errorCode,
    errorMessage: provider?.errorMessage,
    resourceId: resource.id,
    sourceId: sourceIdForResource(resource, providerId),
    sessionKey: sessionKeyForResource(resource, providerId),
    policyId: resource.policyId,
    memoryBytes: memoryBytes(resource.memoryCost),
  };
}

function recordFromProvider(provider: RuntimeProviderHealthDiagnostics): WorkerFirstProviderRuntimeRecord {
  return {
    ...provider,
    resourceId: provider.providerId,
    sourceId: provider.providerId,
    sessionKey: provider.providerId,
    policyId: null,
    memoryBytes: 0,
  };
}

function mergeRecord(
  base: WorkerFirstProviderRuntimeRecord,
  provider: RuntimeProviderHealthDiagnostics,
): WorkerFirstProviderRuntimeRecord {
  return {
    ...base,
    ...provider,
    resourceId: base.resourceId,
    sourceId: base.sourceId,
    sessionKey: base.sessionKey,
    policyId: base.policyId,
    memoryBytes: base.memoryBytes,
  };
}

export function buildWorkerFirstProviderRuntimeSnapshot(
  stats: TimelineRuntimeCoordinatorBridgeStats,
): WorkerFirstProviderRuntimeSnapshot {
  const records = new Map<string, WorkerFirstProviderRuntimeRecord>();

  for (const resource of stats.diagnostics.resources) {
    const record = recordFromResource(resource);
    if (record) records.set(record.providerId, record);
  }

  for (const provider of stats.diagnostics.providers) {
    const existing = records.get(provider.providerId);
    records.set(provider.providerId, existing ? mergeRecord(existing, provider) : recordFromProvider(provider));
  }

  return {
    generatedAtMs: stats.generatedAtMs,
    providers: Array.from(records.values()).map((record) => ({
      ...record,
    })),
  };
}
