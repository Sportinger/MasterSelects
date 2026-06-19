import type {
  RenderCommandTarget,
  RenderGraphId,
  RenderJobDescriptor,
  RenderJobType,
  WorkerRenderStatusEvent,
} from '../../engine/render/contracts/workerRenderGraph';
import type { RuntimeJobHandler, RuntimeJobHandlerRegistration } from '../../runtime/worker';
import {
  RenderCacheRegistry,
  type RenderCacheRegistrySnapshot,
} from '../renderJobs/renderCacheRegistry';
import {
  RenderJobScheduler,
  type RenderSchedulerJob,
  type RenderSchedulerJobType,
  type RenderSchedulerSnapshot,
} from '../renderJobs/renderJobScheduler';
import type {
  WorkerRenderHostRuntimeCommand,
  WorkerRenderHostRuntimeCapabilities,
  WorkerRenderHostWebCodecsResult,
  WorkerRenderHostWebCodecsSeekMode,
  WorkerRenderHostWebCodecsStatus,
  WorkerRenderHostTargetSurfaceCommand,
  WorkerRenderSoftwareFrame,
  WorkerRenderSoftwareLayer,
} from './workerRenderHostRuntimeCommands';
import type {
  WorkerGpuPresentTestPatternCommand,
  WorkerGpuPresentWebCodecsFrameCommand,
  WorkerGpuStartWebCodecsStreamCommand,
  WorkerGpuStopWebCodecsStreamCommand,
  WorkerGpuWebCodecsFrameLayer,
} from './workerGpuRuntimeCommands';
import {
  createWorkerGpuTargetSurface,
  presentGpuTestPattern,
  type WorkerGpuTargetSurface,
} from './workerGpuTargetSurface';
import {
  presentGpuVideoFrame,
} from './workerGpuVideoFramePresenter';
import {
  presentGpuVideoFrameLayers,
  type WorkerGpuVideoFramePresentLayer,
} from './workerGpuVideoFrameLayerPresenter';
import { probeRuntimeCapabilities } from './workerRenderHostRuntimeCapabilities';
import {
  acceptWorkerWebCodecsCommand,
  isWorkerWebCodecsCommand,
  pauseWorkerWebCodecsPlaybackForSource,
  readWorkerWebCodecsVideoFrameForGpuPresentation,
  resetWorkerWebCodecsRuntime,
} from './workerRenderHostRuntimeWebCodecs';
import {
  closeWorkerSoftwareFrameBitmaps,
  drawWorkerSoftwareLayer,
  forEachWorkerSoftwareLayerInPaintOrder,
} from './workerRenderHostSoftwarePainter';
import {
  createWorkerSoftwareFeedbackStore,
  type WorkerSoftwareFeedbackStore,
} from './workerSoftwareFeedbackEffects';

export const WORKER_RENDER_HOST_PROVIDER_ID = 'render.host.worker-runtime';
export const WORKER_RENDER_HOST_COMMAND_HANDLER_ID = 'render.host.command';
export const WORKER_SOFTWARE_BITMAP_CACHE_ENTRY_LIMIT = 24;

export interface WorkerRenderHostRuntimeJobInput {
  readonly command: WorkerRenderHostRuntimeCommand;
  readonly sentAtMs: number;
  readonly nowMs?: number;
}

export interface WorkerRenderHostRuntimeJobOutput {
  readonly accepted: boolean;
  readonly commandType: WorkerRenderHostRuntimeCommand['type'];
  readonly initialized: boolean;
  readonly rendererId: string | null;
  readonly strategy: string | null;
  readonly targetIds: readonly string[];
  readonly scheduler: RenderSchedulerSnapshot;
  readonly cache: RenderCacheRegistrySnapshot;
  readonly statusEvents: readonly WorkerRenderStatusEvent[];
  readonly transferLatencyMs: number | null;
  readonly providerWaitMs: number | null;
  readonly presentedFrameId: string | null;
  readonly capabilities: WorkerRenderHostRuntimeCapabilities | null;
  readonly webCodecs: WorkerRenderHostWebCodecsResult | null;
  readonly readback: {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray;
  } | null;
}

interface WorkerRenderHostRuntimeState {
  initialized: boolean;
  rendererId: string | null;
  strategy: string | null;
  sequence: number;
  lastPresentedFrameId: string | null;
  targets: Map<RenderGraphId, RenderCommandTarget>;
  targetSurfaces: Map<RenderGraphId, WorkerRenderHostTargetSurfaceRecord>;
  gpuWebCodecsStreams: Map<RenderGraphId, WorkerGpuWebCodecsStreamSession>;
  softwareBitmapCache: Map<string, WorkerSoftwareBitmapCacheEntry>;
  softwareFeedbackCache: WorkerSoftwareFeedbackStore;
  scheduler: RenderJobScheduler;
  cache: RenderCacheRegistry;
}

interface WorkerRenderHostTargetSurface {
  readonly kind: '2d';
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
  readonly presentation: WorkerRenderHostTargetSurfaceCommand['presentation'];
  frameSequence: number;
}

type WorkerRenderHostGpuTargetSurfaceRecord = WorkerGpuTargetSurface & {
  readonly presentation: WorkerRenderHostTargetSurfaceCommand['presentation'];
};

type WorkerRenderHostTargetSurfaceRecord =
  | WorkerRenderHostTargetSurface
  | WorkerRenderHostGpuTargetSurfaceRecord;

interface WorkerSoftwareBitmapCacheEntry {
  readonly bitmap: ImageBitmap;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly invalidationSource: string;
}

type WorkerGpuVideoFrameRead = Awaited<ReturnType<typeof readWorkerWebCodecsVideoFrameForGpuPresentation>>;

interface WorkerGpuVideoFrameLayerRead {
  readonly primaryFrameRead: WorkerGpuVideoFrameRead;
  readonly presentLayers: readonly WorkerGpuVideoFramePresentLayer[];
}

interface WorkerGpuWebCodecsStreamSession {
  readonly sessionId: string;
  readonly targetId: RenderGraphId;
  readonly sourceId: string;
  readonly layers: readonly WorkerGpuWebCodecsFrameLayer[];
  readonly startedAtMs: number;
  readonly baseTimelineTime: number;
  readonly baseMediaTime: number;
  readonly playbackRate: number;
  targetFps: number;
  readonly startFrameIndex: number;
  stopped: boolean;
  nextTickAtMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  timerKind: 'timeout' | 'raf' | null;
  frameCount: number;
  distinctFrameCount: number;
  repeatedFrameCount: number;
  failureCount: number;
  tickCount: number;
  totalTickDurationMs: number;
  lastTickDurationMs: number | null;
  lastPresentedFrameId: string | null;
  lastPresentedCompositeKey: string | null;
  lastPresentedTimestampSeconds: number | null;
  lastPresentedAtMs: number | null;
  lastTargetMediaTime: number;
  lastFrameIndex: number;
  lastStatus: WorkerRenderHostWebCodecsStatus | null;
  lastStats: Record<string, number | string | boolean | null> | null;
  lastError: string | null;
}

interface AcceptedRenderCommand {
  readonly statusEvents: readonly WorkerRenderStatusEvent[];
  readonly presentedFrameId: string | null;
  readonly capabilities?: WorkerRenderHostRuntimeCapabilities | null;
  readonly webCodecs?: WorkerRenderHostWebCodecsResult | null;
  readonly readback?: WorkerRenderHostRuntimeJobOutput['readback'];
}

type WorkerCommandPresentation = Extract<
  WorkerRenderStatusEvent,
  { readonly type: 'command-accepted' }
>['presentation'];

const state: WorkerRenderHostRuntimeState = {
  initialized: false,
  rendererId: null,
  strategy: null,
  sequence: 0,
  lastPresentedFrameId: null,
  targets: new Map(),
  targetSurfaces: new Map(),
  gpuWebCodecsStreams: new Map(),
  softwareBitmapCache: new Map(),
  softwareFeedbackCache: createWorkerSoftwareFeedbackStore(),
  scheduler: new RenderJobScheduler(),
  cache: new RenderCacheRegistry(),
};

function nowFromInput(input: WorkerRenderHostRuntimeJobInput): number {
  return typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)
    ? input.nowMs
    : Date.now();
}

function targetCacheId(targetId: string): string {
  return `target:${targetId}`;
}

function targetSurfaceCacheId(targetId: string): string {
  return `target-surface:${targetId}`;
}

function softwareBitmapCacheId(cacheKey: string): string {
  return `software-bitmap:${cacheKey}`;
}

function requestIdForCommand(command: WorkerRenderHostRuntimeCommand): string | null {
  if ('commandId' in command && typeof command.commandId === 'string') {
    return command.commandId;
  }
  if ('requestId' in command && typeof command.requestId === 'string') {
    return command.requestId;
  }
  if ('deadline' in command) {
    return command.deadline.requestId;
  }
  if ('job' in command) {
    return command.job.id;
  }
  return null;
}

function targetIdForCommand(command: WorkerRenderHostRuntimeCommand): string | null {
  if ('targetId' in command && typeof command.targetId === 'string') {
    return command.targetId;
  }
  if ('deadline' in command) {
    return command.deadline.targetId;
  }
  if ('target' in command) {
    return 'id' in command.target ? command.target.id : command.target.targetId;
  }
  if ('surface' in command) {
    return command.surface.targetId;
  }
  if ('job' in command) {
    return command.job.targetId;
  }
  return null;
}

function renderJobTypeForCommandType(commandType: WorkerRenderHostRuntimeCommand['type']): RenderSchedulerJobType | null {
  switch (commandType) {
    case 'renderFrame':
    case 'RenderDeadline':
    case 'RenderNow':
      return 'live-playback';
    case 'seek':
    case 'scrub':
      return 'scrub';
    default:
      return null;
  }
}

function renderJobTypeForDescriptor(type: RenderJobType): RenderSchedulerJobType {
  switch (type) {
    case 'live-preview':
      return 'live-playback';
    case 'export-frame':
    case 'export-range':
      return 'export';
    default:
      return type;
  }
}

function jobFromDescriptor(job: RenderJobDescriptor, nowMs: number): RenderSchedulerJob {
  return {
    id: job.id,
    type: renderJobTypeForDescriptor(job.type),
    targetId: job.targetId,
    compositionId: job.compositionId,
    priority: job.priority,
    createdAt: nowMs,
    coalesceKey: job.targetId ? `${job.type}:${job.targetId}` : job.type,
    exactFrame: job.type === 'export-frame' || job.type === 'export-range',
  };
}

function jobForCommand(command: WorkerRenderHostRuntimeCommand, nowMs: number): RenderSchedulerJob | null {
  if ('job' in command) {
    return jobFromDescriptor(command.job, nowMs);
  }

  const type = renderJobTypeForCommandType(command.type);
  if (!type) return null;
  const targetId = targetIdForCommand(command);
  return {
    id: requestIdForCommand(command) ?? `worker-render-command-${state.sequence++}`,
    type,
    targetId,
    compositionId: targetId ?? 'active-composition',
    priority: type === 'scrub' ? 'critical' : 'high',
    createdAt: nowMs,
    coalesceKey: targetId ? `${type}:${targetId}` : type,
    exactFrame: command.type === 'RenderNow' || command.type === 'renderFrame',
  };
}

function acceptTarget(target: RenderCommandTarget, nowMs: number): void {
  state.targets.set(target.id, target);
  state.cache.allocate({
    id: targetCacheId(target.id),
    owner: 'target-surface',
    key: target.id,
    resourceKind: 'runtime-descriptor',
    durable: false,
    bytes: 0,
    invalidationSource: targetCacheId(target.id),
    createdAt: nowMs,
    lastUsedAt: nowMs,
  });
}

function shouldUseWorkerGpuPresentation(): boolean {
  return state.strategy === 'worker-webgpu-present'
    || state.strategy === 'worker-webgpu-main-present';
}

function isWorkerGpuTargetSurface(
  surface: WorkerRenderHostTargetSurfaceRecord,
): surface is WorkerRenderHostGpuTargetSurfaceRecord {
  return surface.kind === 'worker-gpu-target-surface';
}

async function attachTargetSurface(surface: WorkerRenderHostTargetSurfaceCommand, nowMs: number): Promise<WorkerRenderStatusEvent[]> {
  if (shouldUseWorkerGpuPresentation()) {
    const created = await createWorkerGpuTargetSurface({
      canvas: surface.canvas,
      colorSpace: 'srgb',
    });
    if (!created.ok || !created.surface) {
      return [{
        type: 'error',
        message: [
          `Worker render host could not create WebGPU context for target ${surface.targetId}`,
          created.diagnostics.error ?? created.diagnostics.status,
        ].filter(Boolean).join(': '),
        recoverable: false,
      }];
    }
    state.targetSurfaces.set(surface.targetId, {
      ...created.surface,
      presentation: surface.presentation,
    });
    state.cache.allocate({
      id: targetSurfaceCacheId(surface.targetId),
      owner: 'target-surface',
      key: surface.targetId,
      resourceKind: 'runtime-texture',
      durable: false,
      bytes: Math.max(0, surface.canvas.width * surface.canvas.height * 4),
      invalidationSource: targetCacheId(surface.targetId),
      createdAt: nowMs,
      lastUsedAt: nowMs,
    });
    return [{
      type: 'command-accepted',
      commandType: 'attachTargetSurface',
      requestId: null,
      presentation: surface.presentation,
    }];
  }

  const context = surface.canvas.getContext('2d');
  if (!context) {
    return [{
      type: 'error',
      message: `Worker render host could not create 2D context for target ${surface.targetId}`,
      recoverable: true,
    }];
  }

  state.targetSurfaces.set(surface.targetId, {
    kind: '2d',
    canvas: surface.canvas,
    context,
    presentation: surface.presentation,
    frameSequence: 0,
  });
  state.cache.allocate({
    id: targetSurfaceCacheId(surface.targetId),
    owner: 'target-surface',
    key: surface.targetId,
    resourceKind: 'software-pixels',
    durable: false,
    bytes: Math.max(0, surface.canvas.width * surface.canvas.height * 4),
    invalidationSource: targetCacheId(surface.targetId),
    createdAt: nowMs,
    lastUsedAt: nowMs,
  });
  return [{
    type: 'command-accepted',
    commandType: 'attachTargetSurface',
    requestId: null,
    presentation: surface.presentation,
  }];
}

function detachTargetSurface(targetId: RenderGraphId): void {
  stopGpuWebCodecsStreamForTarget(targetId, 'target detached');
  releaseSoftwareBitmapCache(targetCacheId(targetId));
  state.softwareFeedbackCache.deleteScope(targetId);
  state.targetSurfaces.delete(targetId);
  state.cache.release(targetSurfaceCacheId(targetId));
}

function closeBitmap(bitmap: ImageBitmap): void {
  try {
    bitmap.close();
  } catch {
    // Ignore cleanup errors for already-detached bitmap payloads.
  }
}

function retainSoftwareBitmap(
  cacheKey: string,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  targetId: RenderGraphId,
  nowMs: number,
): void {
  const invalidationSource = targetCacheId(targetId);
  const previous = state.softwareBitmapCache.get(cacheKey);
  if (previous && previous.bitmap !== bitmap) {
    closeBitmap(previous.bitmap);
  }
  state.softwareBitmapCache.delete(cacheKey);
  const bytes = Math.max(0, width * height * 4);
  state.softwareBitmapCache.set(cacheKey, {
    bitmap,
    width,
    height,
    bytes,
    invalidationSource,
  });
  state.cache.allocate({
    id: softwareBitmapCacheId(cacheKey),
    owner: 'source-frame',
    key: cacheKey,
    resourceKind: 'runtime-frame',
    durable: false,
    bytes,
    invalidationSource,
    createdAt: nowMs,
    lastUsedAt: nowMs,
  });
  pruneSoftwareBitmapCache(cacheKey);
}

function releaseSoftwareBitmapCache(invalidationSource?: string): void {
  for (const [cacheKey, entry] of state.softwareBitmapCache) {
    if (invalidationSource && entry.invalidationSource !== invalidationSource) continue;
    closeBitmap(entry.bitmap);
    state.softwareBitmapCache.delete(cacheKey);
    state.cache.release(softwareBitmapCacheId(cacheKey));
  }
}

function pruneSoftwareBitmapCache(protectedKey?: string): void {
  while (state.softwareBitmapCache.size > WORKER_SOFTWARE_BITMAP_CACHE_ENTRY_LIMIT) {
    const oldest = state.softwareBitmapCache.keys().next().value as string | undefined;
    if (!oldest) return;
    if (oldest === protectedKey && state.softwareBitmapCache.size === 1) return;
    const entry = state.softwareBitmapCache.get(oldest);
    if (!entry) {
      state.softwareBitmapCache.delete(oldest);
      continue;
    }
    closeBitmap(entry.bitmap);
    state.softwareBitmapCache.delete(oldest);
    state.cache.release(softwareBitmapCacheId(oldest));
  }
}

function touchSoftwareBitmapCacheEntry(cacheKey: string, nowMs: number): WorkerSoftwareBitmapCacheEntry | null {
  const cached = state.softwareBitmapCache.get(cacheKey);
  if (!cached) return null;
  state.softwareBitmapCache.delete(cacheKey);
  state.softwareBitmapCache.set(cacheKey, cached);
  state.cache.touch(softwareBitmapCacheId(cacheKey), nowMs);
  return cached;
}

function resolveSoftwareFrameBitmaps(
  targetId: RenderGraphId,
  frame: WorkerRenderSoftwareFrame,
  nowMs: number,
): WorkerRenderSoftwareFrame {
  const layers: WorkerRenderSoftwareLayer[] = [];
  for (const layer of frame.layers) {
    if (layer.source.kind === 'bitmap' && layer.source.cacheKey) {
      retainSoftwareBitmap(
        layer.source.cacheKey,
        layer.source.bitmap,
        layer.source.width,
        layer.source.height,
        targetId,
        nowMs,
      );
      layers.push({
        ...layer,
        source: {
          ...layer.source,
          retained: true,
        },
      });
      continue;
    }
    if (layer.source.kind === 'cached-bitmap') {
      const cached = touchSoftwareBitmapCacheEntry(layer.source.cacheKey, nowMs);
      if (!cached) continue;
      layers.push({
        ...layer,
        source: {
          kind: 'bitmap',
          bitmap: cached.bitmap,
          width: cached.width,
          height: cached.height,
          cacheKey: layer.source.cacheKey,
          retained: true,
        },
      });
      continue;
    }
    layers.push(layer);
  }
  return { ...frame, layers };
}

function timelineTimeForCommand(command: WorkerRenderHostRuntimeCommand): number {
  if ('timelineTime' in command && typeof command.timelineTime === 'number') {
    return command.timelineTime;
  }
  if ('deadline' in command) {
    return command.deadline.timelineTime;
  }
  return 0;
}

function performanceNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clampStreamTargetFps(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(120, Math.round(value)))
    : 60;
}

function retargetStreamFpsFromStatus(
  session: WorkerGpuWebCodecsStreamSession,
  status: WorkerRenderHostWebCodecsStatus | null,
): void {
  const playbackRate = Math.abs(session.playbackRate);
  if (playbackRate <= 0) return;
  const sourceFrameRate = status?.frameRate;
  if (typeof sourceFrameRate !== 'number' || !Number.isFinite(sourceFrameRate) || sourceFrameRate <= 0) {
    return;
  }
  if (session.playbackRate < 0) {
    session.targetFps = clampStreamTargetFps(Math.min(session.targetFps, sourceFrameRate * playbackRate));
    return;
  }
  if (playbackRate <= 1.000001) return;
  session.targetFps = clampStreamTargetFps(sourceFrameRate * playbackRate);
}

function reverseStreamReadTimeoutMs(session: WorkerGpuWebCodecsStreamSession): number {
  const frameIntervalMs = 1000 / Math.max(1, session.targetFps);
  return Math.min(12, Math.max(4, frameIntervalMs * 0.5));
}

function createGpuVideoFrameStats(input: {
  readonly presented: boolean;
  readonly sourceId: string;
  readonly targetId: string;
  readonly mode: string;
  readonly frameRead: {
    readonly status: WorkerRenderHostWebCodecsStatus | null;
    readonly width: number;
    readonly height: number;
    readonly timestampSeconds: number | null;
    readonly error: string | null;
  };
  readonly targetMediaTime: number;
  readonly streaming: boolean;
  readonly submitted?: boolean | null;
  readonly workDone?: boolean | null;
  readonly streamSession?: WorkerGpuWebCodecsStreamSession | null;
}): Record<string, number | string | boolean | null> {
  const status = input.frameRead.status;
  const stats: Record<string, number | string | boolean | null> = {
    'workerGpu.videoFrame.presented': input.presented,
    'workerGpu.videoFrame.sourceReady': status?.ready ?? false,
    'workerGpu.videoFrame.sourceFrameRate': status?.frameRate ?? null,
    'workerGpu.videoFrame.decodePending': status?.decodePending ?? null,
    'workerGpu.videoFrame.decodeQueueSize': status?.decodeQueueSize ?? null,
    'workerGpu.videoFrame.samplesLoaded': status?.samplesLoaded ?? null,
    'workerGpu.videoFrame.sampleIndex': status?.sampleIndex ?? null,
    'workerGpu.videoFrame.feedIndex': status?.feedIndex ?? null,
    'workerGpu.videoFrame.frameBufferSize': status?.frameBufferSize ?? null,
    'workerGpu.videoFrame.decoderState': status?.decoderState ?? null,
    'workerGpu.videoFrame.currentFrameTimestampSeconds': status?.currentFrameTimestampSeconds ?? null,
    'workerGpu.videoFrame.pendingSeekKind': status?.pendingSeekKind ?? null,
    'workerGpu.videoFrame.pendingSeekTargetSeconds': status?.pendingSeekTargetSeconds ?? null,
    'workerGpu.videoFrame.pendingSeekFeedEndIndex': status?.pendingSeekFeedEndIndex ?? null,
    'workerGpu.videoFrame.decodeErrorCount': status?.decodeErrorCount ?? null,
    'workerGpu.videoFrame.lastDecodeError': status?.lastDecodeError ?? null,
    'workerGpu.videoFrame.lastError': status?.lastError ?? null,
    'workerGpu.videoFrame.lastDecodedFrameTimestampSeconds': status?.lastDecodedFrameTimestampSeconds ?? null,
    'workerGpu.videoFrame.reverseFrameCacheSize': status?.reverseFrameCacheSize ?? null,
    'workerGpu.videoFrame.reverseCaptureTargetSeconds': status?.reverseCaptureTargetSeconds ?? null,
    'workerGpu.videoFrame.reverseCaptureWindowMinSeconds': status?.reverseCaptureWindowMinSeconds ?? null,
    'workerGpu.videoFrame.reverseCaptureWindowMaxSeconds': status?.reverseCaptureWindowMaxSeconds ?? null,
    'workerGpu.videoFrame.reverseFrameCacheMinTimestampSeconds': status?.reverseFrameCacheMinTimestampSeconds ?? null,
    'workerGpu.videoFrame.reverseFrameCacheMaxTimestampSeconds': status?.reverseFrameCacheMaxTimestampSeconds ?? null,
    'workerGpu.videoFrame.lastSeekPlanTargetIndex': status?.lastSeekPlan?.targetIndex ?? null,
    'workerGpu.videoFrame.lastSeekPlanKeyframeIndex': status?.lastSeekPlan?.keyframeIndex ?? null,
    'workerGpu.videoFrame.lastSeekPlanFeedEndIndex': status?.lastSeekPlan?.feedEndIndex ?? null,
    'workerGpu.videoFrame.lastSeekPlanTargetTimeSeconds': status?.lastSeekPlan?.targetTimeSeconds ?? null,
    'workerGpu.videoFrame.lastSeekPlanTargetSampleTimeSeconds': status?.lastSeekPlan?.targetSampleTimeSeconds ?? null,
    'workerGpu.videoFrame.lastSeekPlanKeyframeTimeSeconds': status?.lastSeekPlan?.keyframeTimeSeconds ?? null,
    'workerGpu.videoFrame.width': input.frameRead.width,
    'workerGpu.videoFrame.height': input.frameRead.height,
    'workerGpu.videoFrame.timestampSeconds': input.frameRead.timestampSeconds,
    'workerGpu.videoFrame.targetMediaTime': input.targetMediaTime,
    'workerGpu.videoFrame.mode': input.mode,
    'workerGpu.videoFrame.streaming': input.streaming,
    'workerGpu.videoFrame.submitted': input.submitted ?? null,
    'workerGpu.videoFrame.workDone': input.workDone ?? null,
    'workerGpu.videoFrame.error': input.frameRead.error,
  };
  if (input.streamSession) {
    stats['workerGpu.videoFrame.workerStream.active'] = !input.streamSession.stopped;
    stats['workerGpu.videoFrame.workerStream.sessionId'] = input.streamSession.sessionId;
    stats['workerGpu.videoFrame.workerStream.targetId'] = input.targetId;
    stats['workerGpu.videoFrame.workerStream.sourceId'] = input.sourceId;
    stats['workerGpu.videoFrame.workerStream.presentedFrameCount'] = input.streamSession.frameCount;
    stats['workerGpu.videoFrame.workerStream.distinctFrameCount'] = input.streamSession.distinctFrameCount;
    stats['workerGpu.videoFrame.workerStream.repeatedFrameCount'] = input.streamSession.repeatedFrameCount;
    stats['workerGpu.videoFrame.workerStream.failureCount'] = input.streamSession.failureCount;
    stats['workerGpu.videoFrame.workerStream.tickCount'] = input.streamSession.tickCount;
    stats['workerGpu.videoFrame.workerStream.lastTickDurationMs'] = input.streamSession.lastTickDurationMs;
    stats['workerGpu.videoFrame.workerStream.avgTickDurationMs'] = input.streamSession.tickCount > 0
      ? input.streamSession.totalTickDurationMs / input.streamSession.tickCount
      : null;
    stats['workerGpu.videoFrame.workerStream.targetFps'] = input.streamSession.targetFps;
    stats['workerGpu.videoFrame.workerStream.playbackRate'] = input.streamSession.playbackRate;
    stats['workerGpu.videoFrame.workerStream.lastPresentedAtMs'] = input.streamSession.lastPresentedAtMs;
    stats['workerGpu.videoFrame.workerStream.lastFrameIndex'] = input.streamSession.lastFrameIndex;
  }
  return stats;
}

function streamMediaTime(session: WorkerGpuWebCodecsStreamSession, nowMs: number): number {
  const elapsedSeconds = Math.max(0, (nowMs - session.startedAtMs) / 1000);
  return session.baseMediaTime + elapsedSeconds * session.playbackRate;
}

function streamLayerMediaTime(
  session: WorkerGpuWebCodecsStreamSession,
  layer: WorkerGpuWebCodecsFrameLayer,
  nowMs: number,
): number {
  const elapsedSeconds = Math.max(0, (nowMs - session.startedAtMs) / 1000);
  return layer.mediaTime + elapsedSeconds * session.playbackRate;
}

function streamReadModeForSession(session: WorkerGpuWebCodecsStreamSession): WorkerRenderHostWebCodecsSeekMode {
  return session.playbackRate < 0 ? 'reverse' : 'stream';
}

function commandWebCodecsLayers(
  input: {
    readonly sourceId: string;
    readonly mediaTime: number;
    readonly layers?: readonly WorkerGpuWebCodecsFrameLayer[];
  },
): readonly WorkerGpuWebCodecsFrameLayer[] {
  if (input.layers && input.layers.length > 0) {
    return input.layers.map((layer) => layer.sourceId === input.sourceId
      ? { ...layer, mediaTime: input.mediaTime }
      : layer);
  }
  return [{
    sourceId: input.sourceId,
    mediaTime: input.mediaTime,
    opacity: 1,
    blendMode: 'normal',
    inlineBrightness: 0,
    inlineContrast: 1,
    inlineSaturation: 1,
    inlineInvert: false,
    complexEffectCount: 0,
  }];
}

function shouldUseLayerVideoFramePresenter(layers: readonly WorkerGpuWebCodecsFrameLayer[]): boolean {
  return layers.length > 1 || layers.some((layer) => (
    Math.abs(layer.opacity - 1) > 0.000001 ||
    layer.blendMode !== 'normal' ||
    Math.abs((layer.inlineBrightness ?? 0)) > 0.000001 ||
    Math.abs((layer.inlineContrast ?? 1) - 1) > 0.000001 ||
    Math.abs((layer.inlineSaturation ?? 1) - 1) > 0.000001 ||
    layer.inlineInvert === true ||
    Math.abs((layer.hueShift ?? 0)) > 0.000001 ||
    Math.abs((layer.pixelateSize ?? 0)) > 0.000001 ||
    Math.abs((layer.kaleidoscopeSegments ?? 0)) > 0.000001 ||
    layer.mirrorHorizontal === true ||
    layer.mirrorVertical === true ||
    Math.abs((layer.rgbSplitAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.blurRadius ?? 0)) > 0.000001 ||
    Math.abs((layer.exposure ?? 0)) > 0.000001 ||
    Math.abs((layer.exposureOffset ?? 0)) > 0.000001 ||
    Math.abs((layer.exposureGamma ?? 1) - 1) > 0.000001 ||
    Math.abs((layer.temperature ?? 0)) > 0.000001 ||
    Math.abs((layer.tint ?? 0)) > 0.000001 ||
    Math.abs((layer.vibrance ?? 0)) > 0.000001 ||
    (layer.thresholdLevel ?? -1) >= 0 ||
    Math.abs((layer.posterizeLevels ?? 0)) > 0.000001 ||
    Math.abs((layer.vignetteAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.chromaKeyMode ?? 0)) > 0.000001 ||
    Math.abs((layer.scanlineOpacity ?? 0)) > 0.000001 ||
    Math.abs((layer.grainAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.waveAmplitudeX ?? 0)) > 0.000001 ||
    Math.abs((layer.waveAmplitudeY ?? 0)) > 0.000001 ||
    Math.abs((layer.twirlAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.bulgeAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.sharpenAmount ?? 0)) > 0.000001 ||
    Math.abs((layer.edgeDetectStrength ?? 0)) > 0.000001 ||
    Math.abs((layer.glowAmount ?? 0)) > 0.000001 ||
    layer.levelsEnabled === true
  ));
}

function isGpuVideoFrameLayerRead(
  value: WorkerGpuVideoFrameLayerRead | WorkerGpuVideoFrameRead,
): value is WorkerGpuVideoFrameLayerRead {
  return 'presentLayers' in value;
}

function compositeFrameKeyForLayerRead(
  layerRead: WorkerGpuVideoFrameLayerRead | WorkerGpuVideoFrameRead,
  frameRead: WorkerGpuVideoFrameRead,
): string {
  if (!isGpuVideoFrameLayerRead(layerRead)) {
    return frameRead.timestampSeconds === null
      ? 'single:null'
      : `single:${frameRead.timestampSeconds.toFixed(6)}`;
  }
  return layerRead.presentLayers.map((layer, index) => {
    const timestampSeconds = layer.timestampSeconds;
    return timestampSeconds === null || timestampSeconds === undefined
      ? `${index}:null`
      : `${index}:${timestampSeconds.toFixed(6)}`;
  }).join('|');
}

async function readGpuVideoFrameLayersForPresentation(input: {
  readonly layers: readonly WorkerGpuWebCodecsFrameLayer[];
  readonly primarySourceId: string;
  readonly mode: WorkerRenderHostWebCodecsSeekMode;
  readonly timeoutMs?: number;
  readonly previousPresentedTimestampSeconds?: number | null;
  readonly allowStaleReverseHold?: boolean;
}): Promise<WorkerGpuVideoFrameLayerRead | WorkerGpuVideoFrameRead> {
  if (!shouldUseLayerVideoFramePresenter(input.layers)) {
    return readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: input.primarySourceId,
      timeSeconds: input.layers[0]?.mediaTime ?? 0,
      mode: input.mode,
      timeoutMs: input.timeoutMs,
      previousPresentedTimestampSeconds: input.previousPresentedTimestampSeconds,
      allowStaleReverseHold: input.allowStaleReverseHold,
    });
  }

  const layerReads = await Promise.all(input.layers.map(async (layer) => ({
    layer,
    frameRead: await readWorkerWebCodecsVideoFrameForGpuPresentation({
      sourceId: layer.sourceId,
      timeSeconds: layer.mediaTime,
      mode: input.mode,
      timeoutMs: input.timeoutMs,
      allowStreamHold: input.mode === 'stream',
      previousPresentedTimestampSeconds: layer.sourceId === input.primarySourceId
        ? input.previousPresentedTimestampSeconds
        : null,
      allowStaleReverseHold: layer.sourceId === input.primarySourceId
        ? input.allowStaleReverseHold
        : true,
    }),
  })));
  const primaryFrameRead = layerReads.find(({ layer }) => layer.sourceId === input.primarySourceId)?.frameRead ??
    layerReads[0]?.frameRead ??
    null;
  const failedRead = layerReads.find(({ frameRead }) => !frameRead.frame);
  if (failedRead) {
    return {
      status: failedRead.frameRead.status ?? primaryFrameRead?.status ?? null,
      frame: null,
      width: 0,
      height: 0,
      timestampSeconds: primaryFrameRead?.timestampSeconds ?? failedRead.frameRead.timestampSeconds,
      error: failedRead.frameRead.error ??
        `Worker WebCodecs layer '${failedRead.layer.sourceId}' did not provide a frame`,
    };
  }
  const presentLayers: WorkerGpuVideoFramePresentLayer[] = layerReads.map(({ layer, frameRead }) => ({
    frame: frameRead.frame!,
    timestampSeconds: frameRead.timestampSeconds,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    inlineBrightness: layer.inlineBrightness,
    inlineContrast: layer.inlineContrast,
    inlineSaturation: layer.inlineSaturation,
    inlineInvert: layer.inlineInvert,
    hueShift: layer.hueShift,
    pixelateSize: layer.pixelateSize,
    kaleidoscopeSegments: layer.kaleidoscopeSegments,
    kaleidoscopeRotation: layer.kaleidoscopeRotation,
    mirrorHorizontal: layer.mirrorHorizontal,
    mirrorVertical: layer.mirrorVertical,
    rgbSplitAmount: layer.rgbSplitAmount,
    rgbSplitAngle: layer.rgbSplitAngle,
    blurRadius: layer.blurRadius,
    exposure: layer.exposure,
    exposureOffset: layer.exposureOffset,
    exposureGamma: layer.exposureGamma,
    temperature: layer.temperature,
    tint: layer.tint,
    vibrance: layer.vibrance,
    thresholdLevel: layer.thresholdLevel,
    posterizeLevels: layer.posterizeLevels,
    vignetteAmount: layer.vignetteAmount,
    vignetteSize: layer.vignetteSize,
    vignetteSoftness: layer.vignetteSoftness,
    vignetteRoundness: layer.vignetteRoundness,
    chromaKeyMode: layer.chromaKeyMode,
    chromaKeyTolerance: layer.chromaKeyTolerance,
    chromaKeySoftness: layer.chromaKeySoftness,
    chromaKeySpill: layer.chromaKeySpill,
    scanlineDensity: layer.scanlineDensity,
    scanlineOpacity: layer.scanlineOpacity,
    scanlineSpeed: layer.scanlineSpeed,
    grainAmount: layer.grainAmount,
    grainSize: layer.grainSize,
    grainSpeed: layer.grainSpeed,
    waveAmplitudeX: layer.waveAmplitudeX,
    waveAmplitudeY: layer.waveAmplitudeY,
    waveFrequencyX: layer.waveFrequencyX,
    waveFrequencyY: layer.waveFrequencyY,
    twirlAmount: layer.twirlAmount,
    twirlRadius: layer.twirlRadius,
    twirlCenterX: layer.twirlCenterX,
    twirlCenterY: layer.twirlCenterY,
    bulgeAmount: layer.bulgeAmount,
    bulgeRadius: layer.bulgeRadius,
    bulgeCenterX: layer.bulgeCenterX,
    bulgeCenterY: layer.bulgeCenterY,
    sharpenAmount: layer.sharpenAmount,
    sharpenRadius: layer.sharpenRadius,
    edgeDetectStrength: layer.edgeDetectStrength,
    edgeDetectInvert: layer.edgeDetectInvert,
    glowAmount: layer.glowAmount,
    glowThreshold: layer.glowThreshold,
    glowRadius: layer.glowRadius,
    levelsInputBlack: layer.levelsInputBlack,
    levelsInputWhite: layer.levelsInputWhite,
    levelsGamma: layer.levelsGamma,
    levelsOutputBlack: layer.levelsOutputBlack,
    levelsOutputWhite: layer.levelsOutputWhite,
    levelsEnabled: layer.levelsEnabled,
  }));
  return {
    primaryFrameRead: primaryFrameRead ?? {
      frame: null,
      status: null,
      width: 0,
      height: 0,
      timestampSeconds: null,
      error: 'Worker WebCodecs layer read did not produce a primary frame',
    },
    presentLayers,
  };
}

function stopGpuWebCodecsStreamForTarget(
  targetId: RenderGraphId,
  reason: string,
  sourceId?: string,
): WorkerGpuWebCodecsStreamSession | null {
  const session = state.gpuWebCodecsStreams.get(targetId);
  if (!session || (sourceId && session.sourceId !== sourceId)) {
    return null;
  }
  session.stopped = true;
  session.lastError = reason;
  if (session.timer !== null) {
    if (session.timerKind === 'raf' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(session.timer as unknown as number);
    } else {
      clearTimeout(session.timer);
    }
    session.timer = null;
    session.timerKind = null;
  }
  state.gpuWebCodecsStreams.delete(targetId);
  pauseWorkerWebCodecsPlaybackForSource(session.sourceId);
  return session;
}

function stopAllGpuWebCodecsStreams(reason: string): void {
  for (const targetId of [...state.gpuWebCodecsStreams.keys()]) {
    stopGpuWebCodecsStreamForTarget(targetId, reason);
  }
}

function activeGpuWebCodecsStreamStatsEvent(requestId: string): WorkerRenderStatusEvent | null {
  let newest: WorkerGpuWebCodecsStreamSession | null = null;
  for (const session of state.gpuWebCodecsStreams.values()) {
    if (!newest || (session.lastPresentedAtMs ?? session.startedAtMs) > (newest.lastPresentedAtMs ?? newest.startedAtMs)) {
      newest = session;
    }
  }
  if (!newest) return null;
  return {
    type: 'stats',
    requestId,
    stats: newest.lastStats ?? createGpuVideoFrameStats({
      presented: newest.lastPresentedFrameId !== null,
      sourceId: newest.sourceId,
      targetId: newest.targetId,
      mode: streamReadModeForSession(newest),
      frameRead: {
        status: newest.lastStatus,
        width: newest.lastStatus?.width ?? 0,
        height: newest.lastStatus?.height ?? 0,
        timestampSeconds: newest.lastPresentedTimestampSeconds,
        error: newest.lastError,
      },
      targetMediaTime: newest.lastTargetMediaTime,
      streaming: true,
      streamSession: newest,
    }),
  };
}

function scheduleGpuWebCodecsStreamTick(session: WorkerGpuWebCodecsStreamSession): void {
  if (session.stopped || !state.gpuWebCodecsStreams.has(session.targetId)) return;
  const frameIntervalMs = 1000 / Math.max(1, session.targetFps);
  session.nextTickAtMs += frameIntervalMs;
  if (
    session.targetFps >= 55 &&
    typeof requestAnimationFrame === 'function'
  ) {
    session.timerKind = 'raf';
    session.timer = requestAnimationFrame(() => {
      session.timer = null;
      session.timerKind = null;
      void presentGpuWebCodecsStreamTick(session);
    }) as unknown as ReturnType<typeof setTimeout>;
    return;
  }
  const delayMs = Math.max(0, Math.min(frameIntervalMs, session.nextTickAtMs - performanceNowMs()));
  session.timerKind = 'timeout';
  session.timer = setTimeout(() => {
    session.timer = null;
    session.timerKind = null;
    void presentGpuWebCodecsStreamTick(session);
  }, delayMs);
}

async function presentGpuWebCodecsStreamTick(session: WorkerGpuWebCodecsStreamSession): Promise<void> {
  if (session.stopped || state.gpuWebCodecsStreams.get(session.targetId) !== session) return;
  const tickStartedAtMs = performanceNowMs();
  const recordTickDuration = () => {
    session.tickCount += 1;
    session.lastTickDurationMs = Math.max(0, performanceNowMs() - tickStartedAtMs);
    session.totalTickDurationMs += session.lastTickDurationMs;
  };
  const surface = state.targetSurfaces.get(session.targetId);
  if (!surface || !isWorkerGpuTargetSurface(surface)) {
    stopGpuWebCodecsStreamForTarget(session.targetId, 'target surface unavailable', session.sourceId);
    return;
  }

  const nowMs = performanceNowMs();
  const targetMediaTime = streamMediaTime(session, nowMs);
  const streamReadMode = streamReadModeForSession(session);
  const elapsedStreamFrames = Math.max(
    0,
    Math.round(Math.abs(targetMediaTime - session.baseMediaTime) * session.targetFps),
  );
  const frameIndex = session.startFrameIndex +
    elapsedStreamFrames;
  session.lastTargetMediaTime = targetMediaTime;
  session.lastFrameIndex = frameIndex;

  const streamLayers = session.layers.map((layer) => ({
    ...layer,
    mediaTime: streamLayerMediaTime(session, layer, nowMs),
  }));
  const layerRead = await readGpuVideoFrameLayersForPresentation({
    layers: streamLayers,
    primarySourceId: session.sourceId,
    mode: streamReadMode,
    timeoutMs: streamReadMode === 'reverse'
      ? reverseStreamReadTimeoutMs(session)
      : 0,
    previousPresentedTimestampSeconds: streamReadMode === 'reverse'
      ? session.lastPresentedTimestampSeconds
      : null,
    allowStaleReverseHold: true,
  });
  const frameRead = isGpuVideoFrameLayerRead(layerRead) ? layerRead.primaryFrameRead : layerRead;
  session.lastStatus = frameRead.status;
  retargetStreamFpsFromStatus(session, frameRead.status);

  if (!frameRead.frame) {
    session.failureCount += 1;
    session.lastError = frameRead.error ?? `Worker WebCodecs source '${session.sourceId}' did not provide a frame`;
    session.lastStats = createGpuVideoFrameStats({
      presented: false,
      sourceId: session.sourceId,
      targetId: session.targetId,
      mode: streamReadMode,
      frameRead,
      targetMediaTime,
      streaming: true,
      streamSession: session,
    });
    recordTickDuration();
    scheduleGpuWebCodecsStreamTick(session);
    return;
  }

  const requestId = `${session.sessionId}:frame:${frameIndex}`;
  const result = isGpuVideoFrameLayerRead(layerRead)
    ? await presentGpuVideoFrameLayers(surface, {
        targetId: session.targetId,
        requestId,
        frameIndex,
        layers: layerRead.presentLayers,
      })
    : await presentGpuVideoFrame(surface, {
        targetId: session.targetId,
        requestId,
        frameIndex,
        frame: frameRead.frame,
        timestampSeconds: frameRead.timestampSeconds,
  });
  if (result.ok && result.diagnostics.presentedFrameId) {
    const compositeFrameKey = compositeFrameKeyForLayerRead(layerRead, frameRead);
    session.frameCount += 1;
    if (
      session.lastPresentedCompositeKey === null ||
      compositeFrameKey !== session.lastPresentedCompositeKey
    ) {
      session.distinctFrameCount += 1;
    } else {
      session.repeatedFrameCount += 1;
    }
    session.lastPresentedFrameId = result.diagnostics.presentedFrameId;
    session.lastPresentedCompositeKey = compositeFrameKey;
    session.lastPresentedTimestampSeconds = frameRead.timestampSeconds;
    session.lastPresentedAtMs = nowMs;
    session.lastError = null;
    state.cache.touch(targetCacheId(session.targetId), Date.now());
    state.cache.touch(targetSurfaceCacheId(session.targetId), Date.now());
    state.lastPresentedFrameId = result.diagnostics.presentedFrameId;
    session.lastStats = createGpuVideoFrameStats({
      presented: true,
      sourceId: session.sourceId,
      targetId: session.targetId,
      mode: streamReadMode,
      frameRead,
      targetMediaTime,
      streaming: true,
      submitted: result.diagnostics.commandSubmitted,
      workDone: result.diagnostics.submittedWorkDoneResolved,
      streamSession: session,
    });
  } else {
    session.failureCount += 1;
    session.lastError = result.diagnostics.error ?? 'Worker WebGPU VideoFrame stream presentation failed';
    session.lastStats = createGpuVideoFrameStats({
      presented: false,
      sourceId: session.sourceId,
      targetId: session.targetId,
      mode: streamReadMode,
      frameRead: {
        status: frameRead.status,
        width: frameRead.width,
        height: frameRead.height,
        timestampSeconds: frameRead.timestampSeconds,
        error: session.lastError,
      },
      targetMediaTime,
      streaming: true,
      submitted: result.diagnostics.commandSubmitted,
      workDone: result.diagnostics.submittedWorkDoneResolved,
      streamSession: session,
    });
  }

  recordTickDuration();
  scheduleGpuWebCodecsStreamTick(session);
}

async function startGpuWebCodecsStream(
  command: WorkerGpuStartWebCodecsStreamCommand,
  nowMs: number,
): Promise<AcceptedRenderCommand> {
  const surface = state.targetSurfaces.get(command.targetId);
  const accepted: WorkerRenderStatusEvent = {
    type: 'command-accepted',
    commandType: command.type,
    requestId: command.commandId,
    presentation: surface?.presentation ?? 'not-presenting',
  };
  if (!surface) {
    return {
      statusEvents: [
        accepted,
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not attached`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }
  if (!isWorkerGpuTargetSurface(surface)) {
    return {
      statusEvents: [
        { ...accepted, presentation: 'not-presenting' },
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not a WebGPU surface`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  stopGpuWebCodecsStreamForTarget(command.targetId, 'stream replaced');
  const startedAtMs = performanceNowMs();
  const session: WorkerGpuWebCodecsStreamSession = {
    sessionId: command.commandId,
    targetId: command.targetId,
    sourceId: command.sourceId,
    layers: commandWebCodecsLayers(command),
    startedAtMs,
    baseTimelineTime: command.timelineTime,
    baseMediaTime: command.mediaTime,
    playbackRate: command.playbackRate,
    targetFps: clampStreamTargetFps(command.targetFps),
    startFrameIndex: command.frameIndex,
    stopped: false,
    nextTickAtMs: startedAtMs,
    timer: null,
    timerKind: null,
    frameCount: 0,
    distinctFrameCount: 0,
    repeatedFrameCount: 0,
    failureCount: 0,
    tickCount: 0,
    totalTickDurationMs: 0,
    lastTickDurationMs: null,
    lastPresentedFrameId: null,
    lastPresentedCompositeKey: null,
    lastPresentedTimestampSeconds: null,
    lastPresentedAtMs: null,
    lastTargetMediaTime: command.mediaTime,
    lastFrameIndex: command.frameIndex,
    lastStatus: null,
    lastStats: null,
    lastError: null,
  };
  state.gpuWebCodecsStreams.set(command.targetId, session);
  const streamReadMode = streamReadModeForSession(session);
  const firstReadMode: WorkerRenderHostWebCodecsSeekMode = streamReadMode === 'stream'
    ? 'advance'
    : streamReadMode;
  const firstReadTimeoutMs = streamReadMode === 'stream'
    ? Math.max(command.timeoutMs ?? 0, 120)
    : command.timeoutMs ?? 48;

  const firstLayerRead = await readGpuVideoFrameLayersForPresentation({
    layers: session.layers,
    primarySourceId: command.sourceId,
    mode: firstReadMode,
    timeoutMs: firstReadTimeoutMs,
  });
  const firstRead = isGpuVideoFrameLayerRead(firstLayerRead) ? firstLayerRead.primaryFrameRead : firstLayerRead;
  session.lastStatus = firstRead.status;
  retargetStreamFpsFromStatus(session, firstRead.status);
  let presentedFrameId: string | null = null;
  const statusEvents: WorkerRenderStatusEvent[] = [accepted];

  if (firstRead.frame) {
    const result = isGpuVideoFrameLayerRead(firstLayerRead)
      ? await presentGpuVideoFrameLayers(surface, {
          targetId: command.targetId,
          requestId: `${command.commandId}:start`,
          frameIndex: command.frameIndex,
          layers: firstLayerRead.presentLayers,
        })
      : await presentGpuVideoFrame(surface, {
          targetId: command.targetId,
          requestId: `${command.commandId}:start`,
          frameIndex: command.frameIndex,
          frame: firstRead.frame,
          timestampSeconds: firstRead.timestampSeconds,
        });
    if (result.ok && result.diagnostics.presentedFrameId) {
      const compositeFrameKey = compositeFrameKeyForLayerRead(firstLayerRead, firstRead);
      session.frameCount = 1;
      session.distinctFrameCount = 1;
      session.lastPresentedFrameId = result.diagnostics.presentedFrameId;
      session.lastPresentedCompositeKey = compositeFrameKey;
      session.lastPresentedTimestampSeconds = firstRead.timestampSeconds;
      session.lastPresentedAtMs = startedAtMs;
      state.cache.touch(targetCacheId(command.targetId), nowMs);
      state.cache.touch(targetSurfaceCacheId(command.targetId), nowMs);
      state.lastPresentedFrameId = result.diagnostics.presentedFrameId;
      presentedFrameId = result.diagnostics.presentedFrameId;
      statusEvents.push({
        type: 'frame-presented',
        requestId: command.commandId,
        targetId: command.targetId,
        timelineTime: command.timelineTime,
      });
      session.lastStats = createGpuVideoFrameStats({
        presented: true,
        sourceId: command.sourceId,
        targetId: command.targetId,
        mode: streamReadMode,
        frameRead: firstRead,
        targetMediaTime: command.mediaTime,
        streaming: true,
        submitted: result.diagnostics.commandSubmitted,
        workDone: result.diagnostics.submittedWorkDoneResolved,
        streamSession: session,
      });
    } else {
      session.failureCount = 1;
      session.lastError = result.diagnostics.error ?? 'Worker WebGPU VideoFrame stream start presentation failed';
      session.stopped = true;
      state.gpuWebCodecsStreams.delete(command.targetId);
      pauseWorkerWebCodecsPlaybackForSource(command.sourceId);
      session.lastStats = createGpuVideoFrameStats({
        presented: false,
        sourceId: command.sourceId,
        targetId: command.targetId,
        mode: streamReadMode,
        frameRead: {
          status: firstRead.status,
          width: firstRead.width,
          height: firstRead.height,
          timestampSeconds: firstRead.timestampSeconds,
          error: session.lastError,
        },
        targetMediaTime: command.mediaTime,
        streaming: true,
        submitted: result.diagnostics.commandSubmitted,
        workDone: result.diagnostics.submittedWorkDoneResolved,
        streamSession: session,
      });
      statusEvents.push({
        type: 'error',
        message: session.lastError,
        recoverable: true,
      });
    }
  } else {
    session.failureCount = 1;
    session.lastError = firstRead.error ?? `Worker WebCodecs source '${command.sourceId}' did not provide a frame`;
    session.lastStats = createGpuVideoFrameStats({
      presented: false,
      sourceId: command.sourceId,
      targetId: command.targetId,
      mode: streamReadMode,
      frameRead: firstRead,
      targetMediaTime: command.mediaTime,
      streaming: true,
      streamSession: session,
    });
  }

  statusEvents.push({
    type: 'stats',
    requestId: command.commandId,
    stats: session.lastStats,
  });
  if (!session.stopped) {
    scheduleGpuWebCodecsStreamTick(session);
  }
  return {
    statusEvents,
    presentedFrameId,
    readback: null,
  };
}

function stopGpuWebCodecsStream(command: WorkerGpuStopWebCodecsStreamCommand): AcceptedRenderCommand {
  const stopped = stopGpuWebCodecsStreamForTarget(command.targetId, command.reason, command.sourceId);
  return {
    statusEvents: [
      {
        type: 'command-accepted',
        commandType: command.type,
        requestId: command.commandId,
        presentation: 'not-presenting',
      },
      {
        type: 'stats',
        requestId: command.commandId,
        stats: {
          'workerGpu.videoFrame.workerStream.active': false,
          'workerGpu.videoFrame.workerStream.targetId': command.targetId,
          'workerGpu.videoFrame.workerStream.sourceId': stopped?.sourceId ?? command.sourceId ?? null,
          'workerGpu.videoFrame.workerStream.presentedFrameCount': stopped?.frameCount ?? 0,
          'workerGpu.videoFrame.workerStream.distinctFrameCount': stopped?.distinctFrameCount ?? 0,
          'workerGpu.videoFrame.workerStream.repeatedFrameCount': stopped?.repeatedFrameCount ?? 0,
          'workerGpu.videoFrame.workerStream.failureCount': stopped?.failureCount ?? 0,
          'workerGpu.videoFrame.mode': 'stream',
          'workerGpu.videoFrame.streaming': false,
          'workerGpu.videoFrame.timestampSeconds': stopped?.lastPresentedTimestampSeconds ?? null,
          'workerGpu.videoFrame.targetMediaTime': stopped?.lastTargetMediaTime ?? null,
        },
      },
    ],
    presentedFrameId: null,
    readback: null,
  };
}

async function presentGpuTestPatternFrame(
  command: WorkerGpuPresentTestPatternCommand,
  nowMs: number,
): Promise<AcceptedRenderCommand> {
  const surface = state.targetSurfaces.get(command.targetId);
  if (!surface) {
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not attached`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  if (!isWorkerGpuTargetSurface(surface)) {
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not a WebGPU surface`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  const result = await presentGpuTestPattern(surface, {
    targetId: command.targetId,
    requestId: command.commandId,
    frameIndex: command.frameIndex,
  });
  const presentedFrameId = result.diagnostics.presentedFrameId;

  if (result.ok && presentedFrameId) {
    state.cache.touch(targetCacheId(command.targetId), nowMs);
    state.cache.touch(targetSurfaceCacheId(command.targetId), nowMs);
    state.lastPresentedFrameId = presentedFrameId;
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: surface.presentation,
        },
        {
          type: 'frame-presented',
          requestId: command.commandId,
          targetId: command.targetId,
          timelineTime: command.timelineTime,
        },
        {
          type: 'stats',
          requestId: command.commandId,
          stats: {
            'workerGpu.testPattern.frameIndex': command.frameIndex,
            'workerGpu.testPattern.clearR': result.diagnostics.clearValue.r,
            'workerGpu.testPattern.clearG': result.diagnostics.clearValue.g,
            'workerGpu.testPattern.clearB': result.diagnostics.clearValue.b,
            'workerGpu.testPattern.submitted': result.diagnostics.commandSubmitted,
            'workerGpu.testPattern.workDone': result.diagnostics.submittedWorkDoneResolved,
          },
        },
      ],
      presentedFrameId,
      readback: null,
    };
  }

  return {
    statusEvents: [
      {
        type: 'command-accepted',
        commandType: command.type,
        requestId: command.commandId,
        presentation: 'not-presenting',
      },
      {
        type: 'error',
        message: result.diagnostics.error ?? 'Worker WebGPU test pattern presentation failed',
        recoverable: false,
      },
    ],
    presentedFrameId: null,
    readback: null,
  };
}

async function presentGpuWebCodecsFrame(
  command: WorkerGpuPresentWebCodecsFrameCommand,
  nowMs: number,
): Promise<AcceptedRenderCommand> {
  stopGpuWebCodecsStreamForTarget(command.targetId, `mode:${command.mode}`, command.sourceId);
  const surface = state.targetSurfaces.get(command.targetId);
  if (!surface) {
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not attached`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  if (!isWorkerGpuTargetSurface(surface)) {
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: `Worker WebGPU target surface '${command.targetId}' is not a WebGPU surface`,
          recoverable: false,
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  const layerRead = await readGpuVideoFrameLayersForPresentation({
    layers: commandWebCodecsLayers(command),
    primarySourceId: command.sourceId,
    mode: command.mode,
    timeoutMs: command.timeoutMs,
  });
  const frameRead = isGpuVideoFrameLayerRead(layerRead) ? layerRead.primaryFrameRead : layerRead;
  if (!frameRead.frame) {
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: 'not-presenting',
        },
        {
          type: 'error',
          message: frameRead.error ?? `Worker WebCodecs source '${command.sourceId}' did not provide a frame`,
          recoverable: true,
        },
        {
          type: 'stats',
          requestId: command.commandId,
          stats: {
            'workerGpu.videoFrame.presented': false,
            'workerGpu.videoFrame.sourceReady': frameRead.status?.ready ?? false,
            'workerGpu.videoFrame.sourceFrameRate': frameRead.status?.frameRate ?? null,
            'workerGpu.videoFrame.decodePending': frameRead.status?.decodePending ?? null,
            'workerGpu.videoFrame.decodeQueueSize': frameRead.status?.decodeQueueSize ?? null,
            'workerGpu.videoFrame.samplesLoaded': frameRead.status?.samplesLoaded ?? null,
            'workerGpu.videoFrame.sampleIndex': frameRead.status?.sampleIndex ?? null,
            'workerGpu.videoFrame.feedIndex': frameRead.status?.feedIndex ?? null,
            'workerGpu.videoFrame.frameBufferSize': frameRead.status?.frameBufferSize ?? null,
            'workerGpu.videoFrame.decoderState': frameRead.status?.decoderState ?? null,
            'workerGpu.videoFrame.currentFrameTimestampSeconds': frameRead.status?.currentFrameTimestampSeconds ?? null,
            'workerGpu.videoFrame.pendingSeekKind': frameRead.status?.pendingSeekKind ?? null,
            'workerGpu.videoFrame.pendingSeekTargetSeconds': frameRead.status?.pendingSeekTargetSeconds ?? null,
            'workerGpu.videoFrame.pendingSeekFeedEndIndex': frameRead.status?.pendingSeekFeedEndIndex ?? null,
            'workerGpu.videoFrame.decodeErrorCount': frameRead.status?.decodeErrorCount ?? null,
            'workerGpu.videoFrame.lastDecodeError': frameRead.status?.lastDecodeError ?? null,
            'workerGpu.videoFrame.lastError': frameRead.status?.lastError ?? null,
            'workerGpu.videoFrame.lastDecodedFrameTimestampSeconds': frameRead.status?.lastDecodedFrameTimestampSeconds ?? null,
            'workerGpu.videoFrame.reverseFrameCacheSize': frameRead.status?.reverseFrameCacheSize ?? null,
            'workerGpu.videoFrame.reverseCaptureTargetSeconds': frameRead.status?.reverseCaptureTargetSeconds ?? null,
            'workerGpu.videoFrame.reverseCaptureWindowMinSeconds': frameRead.status?.reverseCaptureWindowMinSeconds ?? null,
            'workerGpu.videoFrame.reverseCaptureWindowMaxSeconds': frameRead.status?.reverseCaptureWindowMaxSeconds ?? null,
            'workerGpu.videoFrame.reverseFrameCacheMinTimestampSeconds': frameRead.status?.reverseFrameCacheMinTimestampSeconds ?? null,
            'workerGpu.videoFrame.reverseFrameCacheMaxTimestampSeconds': frameRead.status?.reverseFrameCacheMaxTimestampSeconds ?? null,
            'workerGpu.videoFrame.lastSeekPlanTargetIndex': frameRead.status?.lastSeekPlan?.targetIndex ?? null,
            'workerGpu.videoFrame.lastSeekPlanKeyframeIndex': frameRead.status?.lastSeekPlan?.keyframeIndex ?? null,
            'workerGpu.videoFrame.lastSeekPlanFeedEndIndex': frameRead.status?.lastSeekPlan?.feedEndIndex ?? null,
            'workerGpu.videoFrame.lastSeekPlanTargetTimeSeconds': frameRead.status?.lastSeekPlan?.targetTimeSeconds ?? null,
            'workerGpu.videoFrame.lastSeekPlanTargetSampleTimeSeconds': frameRead.status?.lastSeekPlan?.targetSampleTimeSeconds ?? null,
            'workerGpu.videoFrame.lastSeekPlanKeyframeTimeSeconds': frameRead.status?.lastSeekPlan?.keyframeTimeSeconds ?? null,
            'workerGpu.videoFrame.error': frameRead.error,
            'workerGpu.videoFrame.targetMediaTime': command.mediaTime,
            'workerGpu.videoFrame.mode': command.mode,
            'workerGpu.videoFrame.streaming': false,
          },
        },
      ],
      presentedFrameId: null,
      readback: null,
    };
  }

  const result = isGpuVideoFrameLayerRead(layerRead)
    ? await presentGpuVideoFrameLayers(surface, {
        targetId: command.targetId,
        requestId: command.commandId,
        frameIndex: command.frameIndex,
        layers: layerRead.presentLayers,
      })
    : await presentGpuVideoFrame(surface, {
        targetId: command.targetId,
        requestId: command.commandId,
        frameIndex: command.frameIndex,
        frame: frameRead.frame,
        timestampSeconds: frameRead.timestampSeconds,
      });
  const presentedFrameId = result.diagnostics.presentedFrameId;

  if (result.ok && presentedFrameId) {
    state.cache.touch(targetCacheId(command.targetId), nowMs);
    state.cache.touch(targetSurfaceCacheId(command.targetId), nowMs);
    state.lastPresentedFrameId = presentedFrameId;
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.commandId,
          presentation: surface.presentation,
        },
        {
          type: 'frame-presented',
          requestId: command.commandId,
          targetId: command.targetId,
          timelineTime: command.timelineTime,
        },
        {
          type: 'stats',
          requestId: command.commandId,
          stats: {
            'workerGpu.videoFrame.presented': true,
            'workerGpu.videoFrame.sourceReady': frameRead.status?.ready ?? true,
            'workerGpu.videoFrame.sourceFrameRate': frameRead.status?.frameRate ?? null,
            'workerGpu.videoFrame.decodePending': frameRead.status?.decodePending ?? null,
            'workerGpu.videoFrame.decodeQueueSize': frameRead.status?.decodeQueueSize ?? null,
            'workerGpu.videoFrame.samplesLoaded': frameRead.status?.samplesLoaded ?? null,
            'workerGpu.videoFrame.sampleIndex': frameRead.status?.sampleIndex ?? null,
            'workerGpu.videoFrame.feedIndex': frameRead.status?.feedIndex ?? null,
            'workerGpu.videoFrame.frameBufferSize': frameRead.status?.frameBufferSize ?? null,
            'workerGpu.videoFrame.decoderState': frameRead.status?.decoderState ?? null,
            'workerGpu.videoFrame.currentFrameTimestampSeconds': frameRead.status?.currentFrameTimestampSeconds ?? null,
            'workerGpu.videoFrame.pendingSeekKind': frameRead.status?.pendingSeekKind ?? null,
            'workerGpu.videoFrame.pendingSeekTargetSeconds': frameRead.status?.pendingSeekTargetSeconds ?? null,
            'workerGpu.videoFrame.pendingSeekFeedEndIndex': frameRead.status?.pendingSeekFeedEndIndex ?? null,
            'workerGpu.videoFrame.decodeErrorCount': frameRead.status?.decodeErrorCount ?? null,
            'workerGpu.videoFrame.lastDecodedFrameTimestampSeconds': frameRead.status?.lastDecodedFrameTimestampSeconds ?? null,
            'workerGpu.videoFrame.reverseFrameCacheSize': frameRead.status?.reverseFrameCacheSize ?? null,
            'workerGpu.videoFrame.width': frameRead.width,
            'workerGpu.videoFrame.height': frameRead.height,
            'workerGpu.videoFrame.timestampSeconds': frameRead.timestampSeconds,
            'workerGpu.videoFrame.targetMediaTime': command.mediaTime,
            'workerGpu.videoFrame.mode': command.mode,
            'workerGpu.videoFrame.streaming': false,
            'workerGpu.videoFrame.submitted': result.diagnostics.commandSubmitted,
            'workerGpu.videoFrame.workDone': result.diagnostics.submittedWorkDoneResolved,
          },
        },
      ],
      presentedFrameId,
      readback: null,
    };
  }

  return {
    statusEvents: [
      {
        type: 'command-accepted',
        commandType: command.type,
        requestId: command.commandId,
        presentation: 'not-presenting',
      },
      {
        type: 'error',
        message: result.diagnostics.error ?? 'Worker WebGPU VideoFrame presentation failed',
        recoverable: false,
      },
    ],
    presentedFrameId: null,
    readback: null,
  };
}

function paintPresentedFrame(
  targetId: RenderGraphId,
  requestId: string,
  timelineTime: number,
  nowMs: number,
): {
  readonly frameId: string;
  readonly event: WorkerRenderStatusEvent;
  readonly presentation: WorkerRenderHostTargetSurfaceCommand['presentation'];
} | null {
  const surface = state.targetSurfaces.get(targetId);
  if (!surface) return null;
  if (isWorkerGpuTargetSurface(surface)) return null;

  const width = Math.max(1, surface.canvas.width);
  const height = Math.max(1, surface.canvas.height);
  surface.frameSequence += 1;
  const frameId = `${targetId}:${requestId}:${surface.frameSequence}`;
  const stripeWidth = Math.max(1, Math.floor(width / 24));
  const stripeX = (surface.frameSequence * stripeWidth) % width;

  surface.context.clearRect(0, 0, width, height);
  surface.context.fillStyle = '#111827';
  surface.context.fillRect(0, 0, width, height);
  surface.context.fillStyle = '#16a34a';
  surface.context.fillRect(stripeX, 0, stripeWidth, height);
  surface.context.fillStyle = 'rgba(34, 197, 94, 0.28)';
  surface.context.fillRect(0, 0, width, Math.max(2, Math.round(height * 0.08)));
  surface.context.fillStyle = 'rgba(59, 130, 246, 0.22)';
  surface.context.fillRect(0, height - Math.max(2, Math.round(height * 0.08)), width, Math.max(2, Math.round(height * 0.08)));

  state.cache.touch(targetCacheId(targetId), nowMs);
  state.cache.touch(targetSurfaceCacheId(targetId), nowMs);
  state.lastPresentedFrameId = frameId;
  return {
    frameId,
    presentation: surface.presentation,
    event: {
      type: 'frame-presented',
      requestId,
      targetId,
      timelineTime,
    },
  };
}

function paintSoftwareFrame(
  targetId: RenderGraphId,
  requestId: string,
  timelineTime: number,
  frame: WorkerRenderSoftwareFrame,
  nowMs: number,
  readback = false,
): {
  readonly frameId: string;
  readonly events: readonly WorkerRenderStatusEvent[];
  readonly presentation: WorkerRenderHostTargetSurfaceCommand['presentation'];
  readonly readback: WorkerRenderHostRuntimeJobOutput['readback'];
} | null {
  const surface = state.targetSurfaces.get(targetId);
  if (!surface) {
    closeWorkerSoftwareFrameBitmaps(frame);
    return null;
  }

  if (isWorkerGpuTargetSurface(surface)) {
    closeWorkerSoftwareFrameBitmaps(frame);
    return null;
  }

  const width = Math.max(1, surface.canvas.width || frame.size.x);
  const height = Math.max(1, surface.canvas.height || frame.size.y);
  surface.frameSequence += 1;
  const frameId = `${targetId}:${requestId}:${surface.frameSequence}`;
  surface.context.clearRect(0, 0, width, height);
  surface.context.fillStyle = '#000000';
  surface.context.fillRect(0, 0, width, height);
  const resolvedFrame = resolveSoftwareFrameBitmaps(targetId, frame, nowMs);

  try {
    forEachWorkerSoftwareLayerInPaintOrder(resolvedFrame, (layer) => {
      drawWorkerSoftwareLayer(
        surface.context,
        layer,
        width,
        height,
        timelineTime,
        state.softwareFeedbackCache,
        targetId,
      );
    });
  } finally {
    closeWorkerSoftwareFrameBitmaps(resolvedFrame);
  }

  state.cache.touch(targetCacheId(targetId), nowMs);
  state.cache.touch(targetSurfaceCacheId(targetId), nowMs);
  state.lastPresentedFrameId = frameId;
  const pixels = readback
    ? surface.context.getImageData(0, 0, width, height).data
    : null;
  return {
    frameId,
    presentation: surface.presentation,
    readback: pixels ? { width, height, pixels } : null,
    events: [{
      type: 'frame-presented',
      requestId,
      targetId,
      timelineTime,
    }],
  };
}

function resetState(): void {
  stopAllGpuWebCodecsStreams('runtime reset');
  state.initialized = false;
  state.rendererId = null;
  state.strategy = null;
  state.sequence = 0;
  state.lastPresentedFrameId = null;
  state.targets = new Map();
  state.targetSurfaces = new Map();
  state.gpuWebCodecsStreams = new Map();
  releaseSoftwareBitmapCache();
  state.softwareBitmapCache = new Map();
  state.softwareFeedbackCache.clear();
  state.scheduler = new RenderJobScheduler();
  state.cache = new RenderCacheRegistry();
  resetWorkerWebCodecsRuntime();
}

function shouldEmitCommandLifecycleEvents(command: WorkerRenderHostRuntimeCommand): boolean {
  switch (command.type) {
    case 'gpu.startWebCodecsStream':
    case 'gpu.stopWebCodecsStream':
    case 'gpu.presentWebCodecsFrame':
    case 'gpu.presentTestPattern':
    case 'presentSoftwareFrame':
    case 'RenderNow':
    case 'RenderDeadline':
    case 'renderFrame':
    case 'readWebCodecsFrame':
    case 'collectStats':
      return false;
    default:
      return true;
  }
}

async function acceptCommand(command: WorkerRenderHostRuntimeCommand, nowMs: number): Promise<AcceptedRenderCommand> {
  if (isWorkerWebCodecsCommand(command)) {
    return acceptWorkerWebCodecsCommand(command);
  }

  if (command.type === 'initialize') {
    state.initialized = true;
    state.rendererId = command.rendererId;
    state.strategy = command.strategy;
    return {
      statusEvents: [{ type: 'initialized', rendererId: command.rendererId }],
      presentedFrameId: null,
    };
  }

  if (command.type === 'probeCapabilities') {
    return {
      statusEvents: [{
        type: 'command-accepted',
        commandType: command.type,
        requestId: command.requestId,
        presentation: 'not-presenting',
      }],
      presentedFrameId: null,
      capabilities: await probeRuntimeCapabilities(),
    };
  }

  if (command.type === 'dispose') {
    resetState();
    return {
      statusEvents: [{
        type: 'command-accepted',
        commandType: command.type,
        requestId: null,
        presentation: 'not-presenting',
      }],
      presentedFrameId: null,
    };
  }

  if (command.type === 'collectStats') {
    const statusEvents: WorkerRenderStatusEvent[] = [{
      type: 'command-accepted',
      commandType: command.type,
      requestId: command.requestId,
      presentation: 'not-presenting',
    }];
    const streamStats = activeGpuWebCodecsStreamStatsEvent(command.requestId);
    if (streamStats) {
      statusEvents.push(streamStats);
    }
    return {
      statusEvents,
      presentedFrameId: null,
      readback: null,
    };
  }

  if (command.type === 'attachTargetSurface') {
    return {
      statusEvents: await attachTargetSurface(command.surface, nowMs),
      presentedFrameId: null,
    };
  }

  if (command.type === 'detachTargetSurface') {
    detachTargetSurface(command.targetId);
    return {
      statusEvents: [{
        type: 'command-accepted',
        commandType: command.type,
        requestId: null,
        presentation: 'not-presenting',
      }],
      presentedFrameId: null,
    };
  }

  if (command.type === 'gpu.presentTestPattern') {
    return presentGpuTestPatternFrame(command, nowMs);
  }

  if (command.type === 'gpu.presentWebCodecsFrame') {
    return presentGpuWebCodecsFrame(command, nowMs);
  }

  if (command.type === 'gpu.startWebCodecsStream') {
    return startGpuWebCodecsStream(command, nowMs);
  }

  if (command.type === 'gpu.stopWebCodecsStream') {
    return stopGpuWebCodecsStream(command);
  }

  if (command.type === 'presentSoftwareFrame') {
    if (shouldUseWorkerGpuPresentation()) {
      closeWorkerSoftwareFrameBitmaps(command.frame);
      return {
        statusEvents: [
          {
            type: 'command-accepted',
            commandType: command.type,
            requestId: command.requestId,
            presentation: 'not-presenting',
          },
          {
            type: 'error',
            message: 'Software frame presentation is disabled for worker WebGPU presentation',
            recoverable: false,
          },
        ],
        presentedFrameId: null,
        readback: null,
      };
    }
    const presented = paintSoftwareFrame(
      command.targetId,
      command.requestId,
      command.timelineTime,
      command.frame,
      nowMs,
      command.readback === true,
    );
    return {
      statusEvents: [
        {
          type: 'command-accepted',
          commandType: command.type,
          requestId: command.requestId,
          presentation: presented?.presentation ?? 'not-presenting',
        },
        ...(presented?.events ?? []),
      ],
      presentedFrameId: presented?.frameId ?? null,
      readback: presented?.readback ?? null,
    };
  }

  if (command.type === 'registerTarget') {
    acceptTarget(command.target, nowMs);
  }

  if (command.type === 'resizeTarget') {
    const current = state.targets.get(command.targetId);
    if (current) {
      acceptTarget({ ...current, size: command.size }, nowMs);
    }
  }

  if (command.type === 'unregisterTarget') {
    state.targets.delete(command.targetId);
    detachTargetSurface(command.targetId);
    state.cache.release(targetCacheId(command.targetId));
  }

  let presentedFrameId: string | null = null;
  let presentation: WorkerCommandPresentation = 'not-presenting';
  const statusEvents: WorkerRenderStatusEvent[] = [];
  const job = jobForCommand(command, nowMs);
  if (job) {
    state.scheduler.enqueue(job);
    const active = state.scheduler.startNext(nowMs);
    if (active) {
      const targetId = active.targetId;
      if (targetId) {
        state.cache.touch(targetCacheId(targetId), nowMs);
        const presented = paintPresentedFrame(
          targetId,
          requestIdForCommand(command) ?? active.id,
          timelineTimeForCommand(command),
          nowMs,
        );
        if (presented) {
          presentedFrameId = presented.frameId;
          presentation = presented.presentation;
          statusEvents.push(presented.event);
        }
      }
      state.scheduler.complete(active.id);
    }
  }

  statusEvents.unshift({
    type: 'command-accepted',
    commandType: command.type,
    requestId: requestIdForCommand(command),
    presentation,
  });
  return {
    statusEvents,
    presentedFrameId,
    readback: null,
  };
}

export const workerRenderHostRuntimeHandler: RuntimeJobHandler<
  WorkerRenderHostRuntimeJobInput,
  WorkerRenderHostRuntimeJobOutput
> = async (input, context) => {
  const nowMs = nowFromInput(input);
  const emitLifecycleEvents = shouldEmitCommandLifecycleEvents(input.command);
  if (emitLifecycleEvents) {
    context.log('debug', 'Worker render host command accepted', {
      commandType: input.command.type,
    });
  }
  const accepted = await acceptCommand(input.command, nowMs);
  if (emitLifecycleEvents) {
    context.progress({ value: 1, stage: 'render-command', message: 'Render command accepted' });
  }
  return {
    output: {
      accepted: true,
      commandType: input.command.type,
      initialized: state.initialized,
      rendererId: state.rendererId,
      strategy: state.strategy,
      targetIds: [...state.targets.keys()],
      scheduler: state.scheduler.snapshot(nowMs),
      cache: state.cache.snapshot(),
      statusEvents: accepted.statusEvents,
      transferLatencyMs: Math.max(0, nowMs - input.sentAtMs),
      providerWaitMs: null,
      presentedFrameId: accepted.presentedFrameId ?? state.lastPresentedFrameId,
      capabilities: accepted.capabilities ?? null,
      webCodecs: accepted.webCodecs ?? null,
      readback: accepted.readback ?? null,
    },
  };
};

export const WORKER_RENDER_HOST_RUNTIME_HANDLERS: RuntimeJobHandlerRegistration<
  WorkerRenderHostRuntimeJobInput,
  WorkerRenderHostRuntimeJobOutput
>[] = [
  {
    handlerId: WORKER_RENDER_HOST_COMMAND_HANDLER_ID,
    handler: workerRenderHostRuntimeHandler,
  },
];
