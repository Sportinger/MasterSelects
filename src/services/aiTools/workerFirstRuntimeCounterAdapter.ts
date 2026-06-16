import type {
  FrameProviderSourceKind,
  FrameProviderState,
  FrameProviderStatus,
} from '../../engine/render/contracts/frameProviderPolicy';
import {
  createEmptyFrameProviderCounters,
} from '../../engine/render/contracts/frameProviderPolicy';
import type {
  RenderCacheOwner,
} from '../renderJobs/renderCacheRegistry';
import type {
  RenderJobPriority,
  RenderSchedulerJobType,
} from '../renderJobs/renderJobScheduler';
import type {
  RenderResourceDescriptor,
  RuntimeProviderHealthDiagnostics,
  TimelineRuntimeCoordinatorBridgeStats,
  TimelineRuntimePolicyId,
} from '../timeline/runtimeCoordinatorTypes';
import type {
  IndependentRenderSchedulerRuntimeSnapshot,
} from '../renderScheduler';
import type {
  WorkerFirstCacheRuntimeSnapshot,
} from '../../engine/texture/ScrubbingCache';
import type {
  WorkerFirstProviderRuntimeRecord,
  WorkerFirstProviderRuntimeSnapshot,
} from '../timeline/providerRuntimeDiagnostics';
import type { WorkerFirstProofCounterSources } from './workerFirstGateInputs';
import {
  createWorkerFirstRuntimeSnapshot,
  workerFirstRuntimeSnapshotToCounterSources,
  type WorkerFirstRuntimeCacheRecord,
  type WorkerFirstRuntimeJobRecord,
  type WorkerFirstRuntimeSnapshot,
} from './workerFirstRuntimeModel';

interface RuntimeCacheStats {
  readonly scrubbing?: unknown;
  readonly composite?: unknown;
}

interface RuntimeRenderLoopSnapshot {
  readonly renderRequested?: unknown;
  readonly isPlaying?: unknown;
  readonly isScrubbing?: unknown;
  readonly hasActiveVideo?: unknown;
  readonly timelineVisualDemand?: unknown;
}

export interface WorkerFirstRuntimeCounterInput {
  readonly timelineRuntime?: TimelineRuntimeCoordinatorBridgeStats | null;
  readonly cacheStats?: RuntimeCacheStats | null;
  readonly cacheRuntime?: WorkerFirstCacheRuntimeSnapshot | null;
  readonly providerRuntime?: WorkerFirstProviderRuntimeSnapshot | null;
  readonly renderLoop?: RuntimeRenderLoopSnapshot | null;
  readonly independentRenderScheduler?: IndependentRenderSchedulerRuntimeSnapshot | null;
  readonly nowMs?: number;
}

function readNumber(record: unknown, key: string): number {
  if (!record || typeof record !== 'object') return 0;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function mbToBytes(value: number): number {
  return Math.max(0, Math.round(value * 1024 * 1024));
}

function listResources(stats: TimelineRuntimeCoordinatorBridgeStats | null | undefined): readonly RenderResourceDescriptor[] {
  return stats?.diagnostics.resources ?? [];
}

function resourceMemoryBytes(resource: RenderResourceDescriptor): number {
  const cost = resource.memoryCost;
  if (!cost) return 0;
  return positive(cost.heapBytes ?? 0)
    + positive(cost.gpuBytes ?? 0)
    + positive(cost.decodedFrameBytes ?? 0)
    + positive(cost.encodedBytes ?? 0);
}

function cacheOwnerForResource(resource: RenderResourceDescriptor): RenderCacheOwner | null {
  switch (resource.kind) {
    case 'video-frame-provider':
    case 'html-media':
    case 'image-canvas':
    case 'native-decoder':
    case 'model':
    case 'gaussian-splat':
    case 'motion-data':
      return 'source-frame';
    case 'nested-composition-texture':
      return 'subcomp-output';
    case 'gpu-texture':
      if (resource.textureKind === 'render-target') return 'target-surface';
      if (resource.textureKind === 'ram-preview-frame') return 'composite-frame';
      if (resource.textureKind === 'export-frame') return 'export-frame';
      return 'effect-plan';
    default:
      return null;
  }
}

function cacheRecord(input: {
  readonly cacheId: string;
  readonly owner: RenderCacheOwner;
  readonly entries: number;
  readonly bytes: number;
  readonly allocations?: number;
  readonly reuses?: number;
  readonly evictions?: number;
  readonly transfers?: number;
  readonly releases?: number;
  readonly leakChecks?: number;
}): WorkerFirstRuntimeCacheRecord {
  return {
    cacheId: input.cacheId,
    owner: input.owner,
    entries: input.entries,
    bytes: input.bytes,
    allocations: input.allocations ?? input.entries,
    reuses: input.reuses ?? 0,
    evictions: input.evictions ?? 0,
    transfers: input.transfers ?? 0,
    releases: input.releases ?? 0,
    leakChecks: input.leakChecks ?? 0,
  };
}

function buildCacheRecords(input: WorkerFirstRuntimeCounterInput): readonly WorkerFirstRuntimeCacheRecord[] {
  const records: WorkerFirstRuntimeCacheRecord[] = [];

  for (const resource of listResources(input.timelineRuntime)) {
    const owner = cacheOwnerForResource(resource);
    if (!owner) continue;
    const resourceBytes = resourceMemoryBytes(resource);
    if (resourceBytes <= 0) continue;
    records.push(cacheRecord({
      cacheId: `resource:${resource.id}`,
      owner,
      entries: 1,
      bytes: resourceBytes,
    }));
  }

  const producerRecords = input.cacheRuntime?.records ?? [];
  if (producerRecords.length > 0) {
    for (const record of producerRecords) {
      if (record.entries <= 0 && record.bytes <= 0) continue;
      records.push(cacheRecord({
        cacheId: record.cacheId,
        owner: record.owner,
        entries: record.entries,
        bytes: record.bytes,
        allocations: record.allocations,
        reuses: record.reuses,
        evictions: record.evictions,
        transfers: record.transfers,
        releases: record.releases,
        leakChecks: record.leakChecks,
      }));
    }
    return records;
  }

  const scrubbing = input.cacheStats?.scrubbing;
  const scrubbingEntries = Math.round(readNumber(scrubbing, 'count'));
  const scrubbingBytes = mbToBytes(readNumber(scrubbing, 'approxMemoryMB'));
  if (scrubbingEntries > 0 || scrubbingBytes > 0) {
    records.push(cacheRecord({
      cacheId: 'render-host:scrubbing-cache',
      owner: 'source-frame',
      entries: Math.max(0, scrubbingEntries),
      bytes: scrubbingBytes,
      reuses: Math.max(0, scrubbingEntries),
      evictions: Math.round(readNumber(scrubbing, 'evictions')),
    }));
  }

  const composite = input.cacheStats?.composite;
  const compositeEntries = Math.round(readNumber(composite, 'count'));
  const compositeBytes = mbToBytes(readNumber(composite, 'memoryMB'));
  if (compositeEntries > 0 || compositeBytes > 0) {
    records.push(cacheRecord({
      cacheId: 'render-host:composite-cache',
      owner: 'composite-frame',
      entries: Math.max(0, compositeEntries),
      bytes: compositeBytes,
      reuses: Math.max(0, compositeEntries),
    }));
  }

  return records;
}

function jobTypeForResource(resource: Extract<RenderResourceDescriptor, { readonly kind: 'job' }>): RenderSchedulerJobType {
  switch (resource.jobKind) {
    case 'thumbnail-db-load':
    case 'thumbnail-generation':
    case 'thumbnail-bitmap-decode':
      return 'thumbnail';
    case 'cache-warmup':
      return 'independent-preview';
    case 'render-target-refresh':
      return 'independent-preview';
    case 'ram-preview-render':
      return 'ram-preview';
    case 'export-render':
      return 'export';
    default:
      return 'independent-preview';
  }
}

function priorityForPolicy(policyId: TimelineRuntimePolicyId): RenderJobPriority {
  switch (policyId) {
    case 'interactive':
    case 'render-target':
      return 'critical';
    case 'ram-preview':
    case 'composition-render':
      return 'high';
    case 'export':
      return 'normal';
    case 'thumbnail':
      return 'low';
    default:
      return 'idle';
  }
}

function typeForRenderLoop(renderLoop: RuntimeRenderLoopSnapshot): RenderSchedulerJobType {
  if (renderLoop.isScrubbing === true) return 'scrub';
  if (renderLoop.isPlaying === true || renderLoop.hasActiveVideo === true) return 'live-playback';
  return 'independent-preview';
}

function buildJobRecords(input: WorkerFirstRuntimeCounterInput): readonly WorkerFirstRuntimeJobRecord[] {
  const nowMs = input.nowMs ?? Date.now();
  const jobs: WorkerFirstRuntimeJobRecord[] = [];

  for (const resource of listResources(input.timelineRuntime)) {
    if (resource.kind !== 'job') continue;
    const priority = priorityForPolicy(resource.policyId);
    const type = jobTypeForResource(resource);
    const startedAtMs = typeof resource.startedAtMs === 'number' && Number.isFinite(resource.startedAtMs)
      ? resource.startedAtMs
      : null;
    jobs.push({
      jobId: resource.jobId,
      type,
      targetId: resource.owner.ownerType === 'render-target' ? resource.owner.ownerId : null,
      compositionId: resource.owner.compositionId ?? resource.source?.compositionId ?? null,
      priority,
      state: startedAtMs === null ? 'queued' : 'started',
      queuedAtMs: typeof resource.queuedAtMs === 'number' && Number.isFinite(resource.queuedAtMs)
        ? resource.queuedAtMs
        : null,
      startedAtMs,
      finishedAtMs: null,
      coalesceKey: resource.id,
    });
  }

  if (input.renderLoop?.renderRequested === true) {
    const type = typeForRenderLoop(input.renderLoop);
    const priority: RenderJobPriority = type === 'live-playback' || type === 'scrub' ? 'critical' : 'high';
    jobs.push({
      jobId: 'render-loop-demand',
      type,
      targetId: 'preview',
      compositionId: null,
      priority,
      state: 'queued',
      queuedAtMs: nowMs,
      startedAtMs: null,
      finishedAtMs: null,
      coalesceKey: 'render-loop-demand',
    });
  }

  for (const job of input.independentRenderScheduler?.jobs ?? []) {
    jobs.push({
      jobId: job.jobId,
      type: 'independent-preview',
      targetId: job.targetId,
      compositionId: job.compositionId,
      priority: job.state === 'completed' ? 'normal' : 'low',
      state: job.state,
      queuedAtMs: job.queuedAtMs,
      startedAtMs: job.startedAtMs,
      finishedAtMs: job.finishedAtMs,
      coalesceKey: `${job.targetId}:${job.compositionId ?? 'none'}`,
    });
  }

  return jobs;
}

type ProviderRuntimeHealth = RuntimeProviderHealthDiagnostics | WorkerFirstProviderRuntimeRecord;

function sourceKindForProvider(provider: ProviderRuntimeHealth): FrameProviderSourceKind | null {
  switch (provider.providerKind) {
    case 'webcodecs':
      return 'webcodecs';
    case 'runtime-frame-provider':
      return 'video';
    case 'html-video':
      return 'html-video';
    case 'native-decoder':
      return 'native-decoder';
    case 'image':
    case 'canvas':
      return 'image';
    case 'gpu-texture':
      return 'model-3d';
    default:
      return null;
  }
}

function stateForProvider(provider: ProviderRuntimeHealth): FrameProviderState {
  if (provider.isDisposed || provider.status === 'disposed' || provider.status === 'lost') return 'disposed';
  if (provider.status === 'critical') return 'failed';
  if (provider.isDecodePending || provider.isSeeking) return 'pending';
  if (provider.isReady || provider.status === 'ok') return 'ready';
  if (provider.status === 'warning') return 'warming';
  return 'cold';
}

function freshnessForProvider(provider: ProviderRuntimeHealth): FrameProviderStatus['freshness'] {
  if (provider.status === 'lost' || provider.status === 'disposed' || provider.status === 'critical') return 'missing';
  if (typeof provider.lastFrameTimeSeconds === 'number' && Number.isFinite(provider.lastFrameTimeSeconds)) {
    return 'fresh';
  }
  if ((provider.bufferedFrameCount ?? 0) > 0) return 'held';
  return provider.isReady ? 'nearest' : 'missing';
}

function providerStatus(provider: ProviderRuntimeHealth): FrameProviderStatus | null {
  const sourceKind = sourceKindForProvider(provider);
  if (!sourceKind) return null;
  const bufferedFrameCount = Math.max(0, Math.round(provider.bufferedFrameCount ?? 0));
  const droppedFrameCount = Math.max(0, Math.round(provider.droppedFrameCount ?? 0));
  const counters = createEmptyFrameProviderCounters();
  const sourceId = 'sourceId' in provider ? provider.sourceId : provider.providerId;
  const sessionKey = 'sessionKey' in provider ? provider.sessionKey : provider.providerId;
  return {
    providerId: provider.providerId,
    sourceId,
    sourceKind,
    sessionKey,
    generation: 0,
    requestId: null,
    state: stateForProvider(provider),
    substatus: [
      ...(provider.isSeeking ? ['pendingSeek' as const] : []),
      ...(provider.isDecodePending ? ['pendingDecode' as const] : []),
      ...(droppedFrameCount > 0 ? ['late' as const] : []),
    ],
    mediaTime: typeof provider.currentTimeSeconds === 'number' ? provider.currentTimeSeconds : null,
    frameTimestamp: typeof provider.lastFrameTimeSeconds === 'number' ? provider.lastFrameTimeSeconds : null,
    freshness: freshnessForProvider(provider),
    deadlineTimeMs: null,
    priority: provider.isPlaying ? 'critical' : 'normal',
    outstandingFrameCount: bufferedFrameCount,
    lastDropReason: provider.errorCode ?? provider.errorMessage ?? null,
    fallbackUsed: false,
    counters: {
      ...counters,
      created: bufferedFrameCount,
      cached: bufferedFrameCount,
      leaked: provider.status === 'lost' ? 1 : 0,
    },
  };
}

function listProviderRuntimeHealth(input: WorkerFirstRuntimeCounterInput): readonly ProviderRuntimeHealth[] {
  if (input.providerRuntime?.providers && input.providerRuntime.providers.length > 0) {
    return input.providerRuntime.providers;
  }
  return input.timelineRuntime?.diagnostics.providers ?? [];
}

function buildProviderStatuses(input: WorkerFirstRuntimeCounterInput): readonly FrameProviderStatus[] {
  return listProviderRuntimeHealth(input)
    .map(providerStatus)
    .filter((status): status is FrameProviderStatus => Boolean(status));
}

function maxProviderWaitMs(input: WorkerFirstRuntimeCounterInput): number | null {
  const waits = listProviderRuntimeHealth(input)
    .map((provider) => provider.averageDecodeLatencyMs ?? provider.maxDecodeLatencyMs ?? null)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return waits.length > 0 ? Math.max(...waits) : null;
}

function latestPresentedFrameId(input: WorkerFirstRuntimeCounterInput): string | null {
  const candidates = listProviderRuntimeHealth(input)
    .filter((provider) => (
      typeof provider.lastFrameTimeSeconds === 'number' && Number.isFinite(provider.lastFrameTimeSeconds)
    ))
    .toSorted((a, b) => (b.lastFrameAtMs ?? 0) - (a.lastFrameAtMs ?? 0));
  const latest = candidates[0];
  return latest && typeof latest.lastFrameTimeSeconds === 'number'
    ? `${latest.providerId}:${latest.lastFrameTimeSeconds}`
    : null;
}

export function buildWorkerFirstRuntimeSnapshot(
  input: WorkerFirstRuntimeCounterInput,
): WorkerFirstRuntimeSnapshot {
  return createWorkerFirstRuntimeSnapshot({
    source: 'main-host-observation',
    capturedAtMs: input.nowMs ?? Date.now(),
    jobs: buildJobRecords(input),
    cacheEntries: buildCacheRecords(input),
    providers: buildProviderStatuses(input),
    cacheCounters: { leakChecks: 1 },
    timing: {
      transferLatencyMs: null,
      providerWaitMs: maxProviderWaitMs(input),
      presentedFrameId: latestPresentedFrameId(input),
    },
  });
}

export function buildWorkerFirstRuntimeCounterSources(
  input: WorkerFirstRuntimeCounterInput,
): WorkerFirstProofCounterSources {
  return workerFirstRuntimeSnapshotToCounterSources(buildWorkerFirstRuntimeSnapshot(input));
}

function hasVisiblePixelCounters(value: WorkerFirstProofCounterSources['visiblePixels']): boolean {
  return Boolean(value && Object.keys(value).length > 0);
}

export function mergeWorkerFirstCounterSources(
  preferred: WorkerFirstProofCounterSources,
  fallback: WorkerFirstProofCounterSources,
): WorkerFirstProofCounterSources {
  return {
    scheduler: preferred.scheduler ?? fallback.scheduler,
    cache: preferred.cache ?? fallback.cache,
    providers: preferred.providers && preferred.providers.length > 0
      ? preferred.providers
      : fallback.providers,
    transferLatencyMs: preferred.transferLatencyMs ?? fallback.transferLatencyMs,
    providerWaitMs: preferred.providerWaitMs ?? fallback.providerWaitMs,
    presentedFrameId: preferred.presentedFrameId ?? fallback.presentedFrameId,
    passes: preferred.passes ?? fallback.passes,
    visiblePixels: hasVisiblePixelCounters(preferred.visiblePixels)
      ? preferred.visiblePixels
      : fallback.visiblePixels,
  };
}
