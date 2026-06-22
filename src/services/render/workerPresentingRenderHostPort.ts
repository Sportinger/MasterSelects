import type {
  RenderCommandTarget,
  WorkerRenderStatusEvent,
} from '../../engine/render/contracts/workerRenderGraph';
import type { DebugInfrastructureState } from '../../engine/engineCore/debugInfrastructureState';
import type { RenderDispatcherDebugSnapshot } from '../../engine/render/RenderDispatcher';
import type {
  ScrubbingCacheStats,
  WorkerFirstCacheRuntimeSnapshot,
} from '../../engine/texture/ScrubbingCache';
import type { EngineStats } from '../../types/engineStats';
import type { Layer } from '../../types/layers';
import { flags } from '../../engine/featureFlags';
import { useEngineStore } from '../../stores/engineStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import {
  clearWorkerFirstPresentedFrameEvents,
  recordWorkerFirstCacheSnapshot,
  getWorkerFirstPresentedFrameEvents,
  recordWorkerFirstPresentedFrame,
  recordWorkerFirstSchedulerSnapshot,
  recordWorkerFirstTimingCounters,
} from '../aiTools/workerFirstCounterSources';
import { Logger } from '../logger';
import { buildPlaybackDebugStats } from '../playbackDebugStats';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { wcPipelineMonitor } from '../wcPipelineMonitor';
import type { RamPreviewRenderEngine } from '../ramPreviewEngine';
import type { RenderHostSelectionTelemetry } from './renderHostSelection';
import type {
  RenderCaptureCanvas,
  RenderFrameCallback,
  RenderHostLayerCollector,
  RenderHostPort,
  RenderHostTelemetry,
} from './renderHostTypes';
import type { WorkerRenderHostRuntimeJobOutput } from './workerRenderHostRuntimeHandlers';
import type {
  WorkerRenderHostGpuTransferredVideoFrameLayer,
  WorkerRenderHostWebCodecsSeekMode,
  WorkerRenderSoftwareLayer,
} from './workerRenderHostRuntimeCommands';
import type { WorkerGpuWebCodecsFrameLayer } from './workerGpuRuntimeCommands';
import {
  createBrowserWorkerRenderHostRuntimeBridge,
  isBrowserWorkerRenderHostRuntimeSupported,
  type WorkerRenderHostRuntimeBridge,
} from './workerRenderHostRuntimeBridge';
import {
  bitmapSnapshotMaxSizeForPresentation,
  collectWorkerSoftwareBitmapCacheKeys,
  createWorkerCanvasContext,
  createWorkerRenderTarget,
  documentVisibilityDiagnostics,
  waitForWorkerPresentingRetry,
  WORKER_PRESENTING_CACHED_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS,
  WORKER_PRESENTING_LIVE_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS,
  WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE,
  WORKER_PRESENTING_SOFTWARE_BITMAP_CACHE_KEY_LIMIT,
  WORKER_PRESENTING_TRANSIENT_RETRY_LIMIT,
} from './workerPresentingRenderHostSizing';
import { WorkerPresentingCompositeCache } from './workerPresentingCompositeCache';
import { workerSoftwareFrameContentKey } from './workerSoftwareFrameDiagnostics';
import {
  buildWorkerSoftwarePreviewFrame,
  closeWorkerSoftwarePreviewFrame,
  hasOnlyTransientWorkerSoftwareSkips,
  hasWorkerSoftwareBlockingSkips,
  type WorkerSoftwarePreviewFrameBuildResult,
  type WorkerSoftwarePreviewFrameDiagnostics,
} from './workerSoftwarePreviewFrame';
import {
  cacheWorkerSoftwareHtmlVideoSnapshot,
  canCacheWorkerSoftwareHtmlVideoSnapshot,
} from './workerSoftwareHtmlVideoSnapshotCache';
import {
  WorkerGpuMediaSourceRegistry,
  resolveWorkerGpuVideoPresentationLayerStyle,
  type WorkerGpuVideoPresentationLayer,
  type WorkerGpuVideoPresentationSource,
} from './workerGpuMediaSourceRegistry';

const log = Logger.create('WorkerPresentingRenderHostPort');
const WORKER_PRESENTING_TARGET_FPS = 60;
const WORKER_PRESENTING_SCRUB_TARGET_FPS = 30;
const WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_DRIFT_SECONDS = 0.12;
const WORKER_PRESENTING_IDLE_SNAPSHOT_MAX_DRIFT_SECONDS = 0.35;
const WORKER_PRESENTING_PLAYBACK_STATS_WINDOW_MS = 5000;
const WORKER_PRESENTING_POST_SCRUB_TRANSIENT_HOLD_MS = 450;
const WORKER_PRESENTING_GPU_SEEK_RETRY_LIMIT = 42;
const WORKER_PRESENTING_GPU_STREAM_PENDING_LIMIT = 4;
const WORKER_PRESENTING_GPU_EXACT_SEEK_PENDING_LIMIT = 60;
const WORKER_PRESENTING_GPU_STREAM_STATS_POLL_MS = 100;
const WORKER_PRESENTING_GPU_STREAM_REANCHOR_DRIFT_SECONDS = 3 / 60;
const WORKER_PRESENTING_GPU_PAUSE_HOLD_AHEAD_DRIFT_SECONDS = 5 / 60;
const WORKER_PRESENTING_GPU_PAUSE_HOLD_BEHIND_DRIFT_SECONDS = 3 / 60;
const WORKER_PRESENTING_GPU_PAUSE_HOLD_TTL_MS = 500;
const WORKER_PRESENTING_GPU_SCRUB_FAST_SEEK_MIN_DRIFT_SECONDS = 0.18;
const WORKER_PRESENTING_RAF_BACKUP_TIMEOUT_MS = 64;
export type WorkerPresentingPresentationStrategy = 'worker-cpu-present' | 'worker-webgpu-present';

export interface WorkerPresentingRenderHostPortOptions {
  readonly fallback: RenderHostPort; readonly getSelectionTelemetry: () => RenderHostSelectionTelemetry;
  readonly createBridge?: () => WorkerRenderHostRuntimeBridge;
  readonly strictWorkerOnly?: boolean | (() => boolean);
  readonly presentationStrategy?: WorkerPresentingPresentationStrategy | (() => WorkerPresentingPresentationStrategy);
}

interface WorkerRenderTargetRecord {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
  readonly target: RenderCommandTarget;
  readonly targetSurfaceGeneration: number;
}

interface WorkerSoftwarePresentationRequest {
  readonly record: WorkerRenderTargetRecord; readonly layers: readonly Layer[];
  readonly source: string; readonly sequence: number; readonly targetKey: string; readonly enforceLatestSequence: boolean;
}

interface WorkerGpuPresentationRequest {
  readonly record: WorkerRenderTargetRecord;
  readonly layers: readonly Layer[];
  readonly source: string;
  readonly sequence: number;
  readonly targetKey: string;
  readonly streamQueue: boolean;
  readonly exactSeekQueue: boolean;
}

interface WorkerGpuActiveStreamPresentation {
  readonly sourceId: string;
  readonly streamKey: string;
  readonly requestId: string;
  readonly targetSurfaceGeneration: number;
  readonly startedAtMs: number;
  readonly sequence: number;
  baseMediaTime: number;
  anchoredAtMs: number;
  playbackRate: number;
  lastPresentedTimestampSeconds: number | null;
  lastPresentedFrameCount: number;
  lastDistinctFrameCount: number;
  lastRepeatedFrameCount: number;
}

interface WorkerGpuPauseHold {
  readonly sourceId: string;
  readonly timestampSeconds: number;
  readonly expiresAtMs: number;
}

function numberTargetKey(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : 'na';
}

function mediaFrameTargetKey(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 1000)) : 'na';
}

function rotationTargetKey(rotation: Layer['rotation']): string {
  if (typeof rotation === 'number') return numberTargetKey(rotation);
  return numberTargetKey(rotation?.z);
}

function layerSourceTargetKey(layer: Layer): string {
  const source = layer.source;
  if (!source) return 'missing';
  const sourceClipId = layer.sourceClipId ?? layer.id;
  if (source.videoElement) {
    return [
      'video',
      sourceClipId,
      mediaFrameTargetKey(source.mediaTime),
      mediaFrameTargetKey(source.videoElement.currentTime),
    ].join(':');
  }
  if (source.type === 'video' && source.file) {
    return [
      'worker-gpu-video',
      sourceClipId,
      source.runtimeSourceId ?? source.mediaFileId ?? 'file',
      mediaFrameTargetKey(source.mediaTime ?? source.targetMediaTime),
    ].join(':');
  }
  if (source.videoFrame) {
    return ['video-frame', sourceClipId, mediaFrameTargetKey(source.mediaTime)].join(':');
  }
  if (source.textCanvas) return `text:${sourceClipId}:${source.textCanvas.width}x${source.textCanvas.height}`;
  if (source.imageElement) return `image:${sourceClipId}:${source.imageElement.naturalWidth}x${source.imageElement.naturalHeight}`;
  if (source.type === 'solid') return `solid:${source.color}`;
  if (source.nestedComposition) return ['nested', sourceClipId, mediaFrameTargetKey(source.mediaTime)].join(':');
  return source.type;
}

function workerPresentationTargetKey(layers: readonly Layer[]): string {
  return layers.map((layer) => [
    layer.id,
    layer.visible ? '1' : '0',
    numberTargetKey(layer.opacity),
    numberTargetKey(layer.position?.x),
    numberTargetKey(layer.position?.y),
    numberTargetKey(layer.scale?.x),
    numberTargetKey(layer.scale?.y),
    rotationTargetKey(layer.rotation),
    layerSourceTargetKey(layer),
  ].join(',')).join('|');
}

export function isWorkerPresentingCanvasSupported(): boolean {
  return isBrowserWorkerRenderHostRuntimeSupported()
    && typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
    && !prefersSoftwareTimelineCanvas();
}

class WorkerPresentingRenderHostPortCore {
  private readonly fallback: RenderHostPort;
  private readonly getSelectionTelemetry: () => RenderHostSelectionTelemetry;
  private readonly createBridge: () => WorkerRenderHostRuntimeBridge;
  private readonly readStrictWorkerOnly: () => boolean;
  private readonly readPresentationStrategy: () => WorkerPresentingPresentationStrategy;
  private readonly targetRecords = new Map<string, WorkerRenderTargetRecord>();
  private readonly fallbackTargetIds = new Set<string>();
  private readonly pendingTargetDetachTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private bridge: WorkerRenderHostRuntimeBridge | null = null;
  private bridgeFailed = false;
  private initializePromise: Promise<boolean> | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private renderFrame: RenderFrameCallback | null = null;
  private rafId: number | null = null;
  private requestSequence = 0;
  private renderLoopActive = false;
  private renderRequested = false;
  private isPlaying = false;
  private playbackSpeed = 1;
  private isScrubbing = false;
  private lastScrubEndedAt = 0;
  private timelineVisualDemand = false;
  private continuousRender = false;
  private readonly attachedWorkerTargetIds = new Set<string>();
  private rafBackupTimer: ReturnType<typeof setTimeout> | null = null;
  private renderCount = 0;
  private lastSuccessfulRenderTime = 0;
  private lastRenderDurationMs = 0;
  private fpsWindowStartedAt = 0;
  private fpsWindowFrames = 0;
  private currentFps = 0;
  private currentTargetFps = WORKER_PRESENTING_TARGET_FPS;
  private fpsWindowTargetFps = WORKER_PRESENTING_TARGET_FPS;
  private lastCadenceRenderAt = 0;
  private totalDrops = 0;
  private dropsLastSecond = 0;
  private lastLayerCount = 0;
  private presentationAttempts = 0;
  private presentationFailures = 0;
  private staleSoftwareFrameCount = 0;
  private transientSoftwareFrameRetryCount = 0;
  private lastPresentedFrameId: string | null = null;
  private lastSoftwareFrameDiagnostics: WorkerSoftwarePreviewFrameDiagnostics | null = null;
  private lastAttemptedSoftwareFrameDiagnostics: WorkerSoftwarePreviewFrameDiagnostics | null = null;
  private heldEmptySoftwareFrameCount = 0;
  private latestPresentationSequenceByTarget = new Map<string, number>();
  private inFlightSoftwarePresentationTargets = new Set<string>();
  private pendingSoftwarePresentationsByTarget = new Map<string, WorkerSoftwarePresentationRequest>();
  private coalescedSoftwareFrameCount = 0;
  private readonly workerBitmapCacheKeys = new Set<string>();
  private readonly heldSoftwareLayersById = new Map<string, WorkerRenderSoftwareLayer>();
  private readonly lastContentKeyByTarget = new Map<string, string>();
  private readonly lastTargetKeyByTarget = new Map<string, string>();
  private readonly compositeCache = new WorkerPresentingCompositeCache();
  private readonly ramPreviewRenderEngine: RamPreviewRenderEngine = {
    render: (layers) => this.render(layers),
    cacheCompositeFrame: (time) => this.cacheCompositeFrame(time),
  };
  private latestRenderedLayers: readonly Layer[] = [];
  private fallbackBlockedCount = 0;
  private fallbackBlockedOperations: string[] = [];
  private gpuOnlySoftwareFrameBlockedCount = 0;
  private gpuOnlySoftwareSnapshotBlockedCount = 0;
  private gpuOnlyTestPatternFrameCount = 0;
  private gpuOnlyTestPatternFailureCount = 0;
  private gpuOnlyVideoFrameCount = 0;
  private gpuOnlyVideoFrameFailureCount = 0;
  private gpuOnlyDistinctVideoFrameCount = 0;
  private gpuOnlyRepeatedVideoFrameCount = 0;
  private lastGpuOnlyVideoFrameTimestampSeconds: number | null = null;
  private lastGpuOnlyVideoFrameSourceFrameRate: number | null = null;
  private lastGpuOnlyVideoFrameStats: Record<string, unknown> | null = null;
  private gpuOnlyVideoSourceLoadCount = 0;
  private gpuOnlyVideoSourceLoadFailureCount = 0;
  private coalescedGpuFrameCount = 0;
  private readonly inFlightGpuPresentationTargets = new Set<string>();
  private readonly pendingGpuPresentationsByTarget = new Map<string, WorkerGpuPresentationRequest[]>();
  private readonly activeGpuStreamPresentationsByTarget = new Map<string, WorkerGpuActiveStreamPresentation>();
  private readonly pendingGpuStreamStartsByTarget = new Set<string>();
  private readonly pendingGpuStreamStopsByTarget = new Set<string>();
  private readonly pendingGpuPauseHoldsByTarget = new Map<string, WorkerGpuPauseHold>();
  private readonly targetSurfaceGenerationByTarget = new Map<string, number>();
  private gpuStreamStatsInterval: ReturnType<typeof setInterval> | null = null;
  private gpuStreamStatsPollInFlight = false;
  private readonly gpuSeekRetryCountByTarget = new Map<string, { targetKey: string; count: number }>();
  private readonly workerGpuMediaSources = new WorkerGpuMediaSourceRegistry();
  private readonly lastPresentedVideoTimes = new WeakMap<HTMLVideoElement, number>();

  constructor(options: WorkerPresentingRenderHostPortOptions) {
    this.fallback = options.fallback;
    this.getSelectionTelemetry = options.getSelectionTelemetry;
    this.createBridge = options.createBridge ?? createBrowserWorkerRenderHostRuntimeBridge;
    this.readStrictWorkerOnly = typeof options.strictWorkerOnly === 'function'
      ? options.strictWorkerOnly
      : () => options.strictWorkerOnly === true;
    const presentationStrategy = options.presentationStrategy;
    this.readPresentationStrategy = typeof presentationStrategy === 'function'
      ? presentationStrategy
      : () => presentationStrategy ?? 'worker-cpu-present';
  }

  private get strictWorkerOnly(): boolean {
    return this.readStrictWorkerOnly();
  }

  private get presentationStrategy(): WorkerPresentingPresentationStrategy {
    return this.readPresentationStrategy();
  }

  private get isGpuOnlyPresentation(): boolean {
    return this.strictWorkerOnly && this.presentationStrategy === 'worker-webgpu-present';
  }

  private rememberWorkerBitmapCacheKeys(cacheKeys: readonly string[]): void {
    for (const cacheKey of cacheKeys) {
      this.workerBitmapCacheKeys.delete(cacheKey);
      this.workerBitmapCacheKeys.add(cacheKey);
    }
    while (this.workerBitmapCacheKeys.size > WORKER_PRESENTING_SOFTWARE_BITMAP_CACHE_KEY_LIMIT) {
      const oldest = this.workerBitmapCacheKeys.values().next().value as string | undefined;
      if (!oldest) return;
      this.workerBitmapCacheKeys.delete(oldest);
    }
  }

  getTelemetry(): RenderHostTelemetry {
    return {
      mode: this.strictWorkerOnly
        ? this.presentationStrategy === 'worker-webgpu-present'
          ? 'worker-gpu-only'
          : 'worker-only'
        : 'worker-presenting',
      presentationStrategy: this.presentationStrategy,
      lifecycleOwner: 'renderHostPort',
      statsOwner: 'renderHostPort',
      watchdogOwner: 'renderHostPort',
      selection: this.getSelectionTelemetry(),
      diagnostics: this.getDiagnostics(),
    };
  }

  initialize(): Promise<boolean> {
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = this.initializeWorker();
    return this.initializePromise;
  }

  startRenderLoop(renderFrame: RenderFrameCallback): void {
    this.renderFrame = renderFrame;
    this.renderLoopActive = true;
    this.requestRender();
    void import('../playbackHealthMonitor')
      .then(({ playbackHealthMonitor }) => {
        playbackHealthMonitor?.start?.();
      })
      .catch((error) => {
        log.warn('Failed to start playback health monitor', error);
      });
  }

  startStatsAndWatchdog(_renderFrame: RenderFrameCallback): () => void {
    if (this.statsInterval === null) {
      this.statsInterval = setInterval(() => {
        this.publishEngineStats();
        const bridge = this.getBridge();
        if (!bridge) return;
        void this.withBridge((runtime) => runtime.collectStats(`worker-presenting:stats:${this.requestSequence++}`));
      }, 1000);
    }
    return () => {
      if (this.statsInterval !== null) {
        clearInterval(this.statsInterval);
        this.statsInterval = null;
      }
    };
  }

  stopRenderLoopForDiagnostics(): void {
    this.renderLoopActive = false;
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = null;
    if (this.rafBackupTimer !== null) {
      clearTimeout(this.rafBackupTimer);
      this.rafBackupTimer = null;
    }
  }

  startExistingRenderLoopForDiagnostics(): void {
    this.renderLoopActive = true;
    this.requestRender();
  }

  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null {
    const existing = this.targetRecords.get(targetId);
    if (existing?.canvas === canvas) {
      const canceledPendingDetach = this.cancelPendingTargetDetach(targetId);
      if (this.isGpuOnlyPresentation && (canceledPendingDetach || !this.isPlaying)) {
        this.requestRender();
      }
      return existing.context;
    }

    if (!isWorkerPresentingCanvasSupported()) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback('registerTargetCanvas:unsupported-worker-canvas');
        return null;
      }
      this.fallbackTargetIds.add(targetId);
      return this.fallback.registerTargetCanvas(targetId, canvas);
    }

    if (existing) {
      const canceledPendingDetach = this.cancelPendingTargetDetach(targetId);
      this.targetRecords.delete(targetId);
      this.attachedWorkerTargetIds.delete(targetId);
      if (!canceledPendingDetach) {
        void this.withBridge(async (bridge) => {
          await bridge.detachTargetSurface(targetId);
          return bridge.sendCommand({ type: 'unregisterTarget', targetId });
        });
      }
    }

    const target = createWorkerRenderTarget(targetId, canvas);
    const context = createWorkerCanvasContext(targetId, canvas);
    const targetSurfaceGeneration = this.nextTargetSurfaceGeneration(targetId);
    this.targetRecords.set(targetId, { canvas, context, target, targetSurfaceGeneration });
    this.attachedWorkerTargetIds.delete(targetId);

    try {
      const offscreen = canvas.transferControlToOffscreen();
      void this.withBridge(async (bridge) => {
        await bridge.registerTarget(target);
        const output = await bridge.attachTargetSurface({
          targetId,
          canvas: offscreen,
          presentation: 'offscreen-canvas',
        });
        if (!this.runtimeOutputHasError(output)) {
          this.attachedWorkerTargetIds.add(targetId);
          this.startPendingGpuPresentationIfReady(targetId);
          if (this.isGpuOnlyPresentation) {
            this.requestRender();
          }
        }
        return output;
      });
      return context;
    } catch (error) {
      this.targetRecords.delete(targetId);
      this.attachedWorkerTargetIds.delete(targetId);
      if (this.strictWorkerOnly) {
        this.blockMainFallback('registerTargetCanvas:transfer-failed');
        log.warn('Worker-only render target transfer failed; main fallback is disabled', error);
        return null;
      }
      this.fallbackTargetIds.add(targetId);
      log.warn('Worker render target transfer failed; using fallback target', error);
      return this.fallback.registerTargetCanvas(targetId, canvas);
    }
  }

  unregisterTargetCanvas(targetId: string): void {
    if (this.fallbackTargetIds.delete(targetId)) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback('unregisterTargetCanvas:fallback-target');
        return;
      }
      this.fallback.unregisterTargetCanvas(targetId);
      return;
    }
    if (!this.targetRecords.has(targetId) || this.pendingTargetDetachTimers.has(targetId)) return;
    this.stopGpuOnlyStreamPresentation(targetId, 'target unregistered');
    const timer = setTimeout(() => {
      this.pendingTargetDetachTimers.delete(targetId);
      this.targetRecords.delete(targetId);
      this.attachedWorkerTargetIds.delete(targetId);
      this.latestPresentationSequenceByTarget.delete(targetId);
      this.workerBitmapCacheKeys.clear();
      void this.withBridge(async (bridge) => {
        await bridge.detachTargetSurface(targetId);
        return bridge.sendCommand({ type: 'unregisterTarget', targetId });
      });
    }, 500);
    this.pendingTargetDetachTimers.set(targetId, timer);
  }

  setPreviewCanvas(canvas: HTMLCanvasElement): void {
    if (!this.targetRecords.has('preview') && !this.fallbackTargetIds.has('preview')) {
      this.registerTargetCanvas('preview', canvas);
    }
  }

  render(_layers: Layer[]): void {
    this.latestRenderedLayers = _layers;
    if (this.fallbackTargetIds.has('preview')) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback('render:fallback-target');
        return;
      }
      this.fallback.render(_layers);
      return;
    }
    this.presentLayers('preview', _layers, 'render');
  }

  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    if (this.fallbackTargetIds.has(canvasId)) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback(`renderToPreviewCanvas:fallback-target:${canvasId}`);
        return;
      }
      this.fallback.renderToPreviewCanvas(canvasId, layers);
      return;
    }
    this.presentLayers(canvasId, layers, 'render-to-preview-canvas');
  }

  getIsExporting(): boolean {
    return false;
  }

  requestRender(): void {
    if (this.fallbackTargetIds.has('preview')) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback('requestRender:fallback-target');
        return;
      }
      this.fallback.requestRender();
      return;
    }
    this.renderRequested = true;
    this.startAnimationLoop();
  }

  requestNewFrameRender(): void {
    if (this.fallbackTargetIds.has('preview')) {
      if (this.strictWorkerOnly) {
        this.blockMainFallback('requestNewFrameRender:fallback-target');
        return;
      }
      this.fallback.requestNewFrameRender();
      return;
    }
    this.renderRequested = true;
    this.startAnimationLoop();
  }

  setTimelineVisualDemand(hasDemand: boolean): void {
    if (this.timelineVisualDemand === hasDemand) return;
    this.timelineVisualDemand = hasDemand;
    this.requestRender();
  }

  setVisualTargetFps(_targetFps: number): void {
    // Worker presentation derives cadence from the active composition directly.
  }

  setIsPlaying(isPlaying: boolean): void {
    if (this.isPlaying === isPlaying) return;
    const startingPlayback = isPlaying && !this.isPlaying;
    const stoppingActiveGpuStream = !isPlaying && (
      this.activeGpuStreamPresentationsByTarget.size > 0 ||
      this.pendingGpuStreamStartsByTarget.size > 0
    );
    this.isPlaying = isPlaying;
    if (startingPlayback) {
      this.pendingGpuPauseHoldsByTarget.clear();
      clearWorkerFirstPresentedFrameEvents();
    } else if (!isPlaying) {
      if (stoppingActiveGpuStream) {
        this.captureGpuPauseHolds();
      }
      this.clearQueuedGpuStreamPresentations();
      this.stopAllGpuOnlyStreamPresentations('playback paused');
    }
    this.resetFpsWindowForCadenceChange();
    if (stoppingActiveGpuStream && this.isGpuOnlyPresentation && !this.isScrubbing) {
      this.publishEngineStats();
      return;
    }
    this.requestRender();
  }

  setPlaybackSpeed(playbackSpeed: number): void {
    const nextPlaybackSpeed = Number.isFinite(playbackSpeed) && playbackSpeed !== 0
      ? playbackSpeed
      : 1;
    if (Math.abs(this.playbackSpeed - nextPlaybackSpeed) < 0.001) return;
    this.playbackSpeed = nextPlaybackSpeed;
    if (Math.abs(this.playbackSpeed - 1) > 0.001) {
      this.stopAllGpuOnlyStreamPresentations('playback speed changed');
    }
    if (this.isPlaying) {
      this.resetFpsWindowForCadenceChange();
      this.requestRender();
    }
  }

  setIsScrubbing(isScrubbing: boolean): void {
    if (this.isScrubbing !== isScrubbing) {
      this.isScrubbing = isScrubbing;
      if (isScrubbing) {
        this.pendingGpuPauseHoldsByTarget.clear();
        this.stopAllGpuOnlyStreamPresentations('scrub started');
      }
      this.lastScrubEndedAt = isScrubbing ? 0 : performance.now();
      this.resetFpsWindowForCadenceChange();
      this.requestRender();
    }
  }

  setContinuousRender(enabled: boolean): void {
    if (this.continuousRender === enabled) return;
    this.continuousRender = enabled;
    this.requestRender();
  }

  getRamPreviewRenderEngine(): RamPreviewRenderEngine {
    return this.ramPreviewRenderEngine;
  }

  renderCachedFrame(time: number): boolean {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareFrameBlockedCount += 1;
      return false;
    }
    if (!this.compositeCache.canPresent(time) || !this.resolvePresentationRecord('preview') || !this.getBridge()) {
      return false;
    }
    void this.presentCachedCompositeFrame(time);
    return true;
  }

  cacheCompositeFrame(time: number): Promise<void> {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareFrameBlockedCount += 1;
      return Promise.resolve();
    }
    return this.cacheLatestWorkerCompositeFrame(time);
  }

  cacheActiveCompOutput(_compositionId: string): void {
    // Worker-presenting cache ownership is runtime-side; legacy composite cache is intentionally not populated here.
  }

  clearCompositeCache(): void {
    this.compositeCache.clear();
  }

  getCompositeCacheStats(): { count: number; maxFrames: number; memoryMB: number } {
    return this.compositeCache.stats();
  }

  getScrubbingCacheStats(): ScrubbingCacheStats {
    return {
      count: 0,
      maxCount: 0,
      fillPct: 0,
      approxMemoryMB: 0,
      evictions: 0,
      budgetMode: 'static',
      background: {
        activeSessions: 0,
        queuedFrames: 0,
        activePreloads: 0,
        filledFrames: 0,
        skippedFrames: 0,
        failedFrames: 0,
        lastFillLatencyMs: 0,
      },
    };
  }

  getScrubbingCachedRanges(videoSrc: string): Array<{ start: number; end: number }> {
    if (this.strictWorkerOnly) {
      this.blockMainFallback('getScrubbingCachedRanges');
      return [];
    }
    const ranges = this.fallback.getScrubbingCachedRanges(videoSrc);
    return Array.isArray(ranges) ? ranges : [];
  }

  getWorkerFirstCacheRuntimeSnapshot(): WorkerFirstCacheRuntimeSnapshot {
    const composite = this.compositeCache.stats();
    const records = composite.count > 0 || composite.memoryMB > 0
      ? [{
          cacheId: 'worker-presenting:composite-cache',
          owner: 'composite-frame' as const,
          entries: composite.count,
          bytes: Math.max(0, Math.round(composite.memoryMB * 1024 * 1024)),
          allocations: composite.count,
          reuses: composite.count,
          evictions: 0,
          transfers: 0,
          releases: 0,
          leakChecks: 0,
        }]
      : [];
    return {
      generatedAtMs: Date.now(),
      records,
    };
  }

  setGeneratingRamPreview(_generating: boolean): void {
    // Worker-presenting RAM/bake generation is host-owned; no main export canvas flag is needed here.
  }

  getCaptureCanvas(): RenderCaptureCanvas | null {
    const preview = this.targetRecords.get('preview');
    if (preview) return { canvas: preview.canvas, source: 'workerRenderHost:preview' };
    const first = this.targetRecords.values().next().value as WorkerRenderTargetRecord | undefined;
    if (first) return { canvas: first.canvas, source: `workerRenderHost:${first.target.id}` };
    if (this.strictWorkerOnly) {
      this.blockMainFallback('getCaptureCanvas');
      return null;
    }
    return this.fallback.getCaptureCanvas();
  }

  getOutputDimensions(): { width: number; height: number } {
    const preview = this.targetRecords.get('preview');
    if (preview) return { width: preview.target.size.x, height: preview.target.size.y };
    if (this.strictWorkerOnly) {
      this.blockMainFallback('getOutputDimensions');
      return { width: 0, height: 0 };
    }
    return this.fallback.getOutputDimensions();
  }

  setResolution(width: number, height: number): void {
    this.targetRecords.forEach((record, targetId) => {
      const size = { x: width, y: height };
      this.targetRecords.set(targetId, {
        ...record,
        target: { ...record.target, size },
      });
      void this.withBridge((bridge) => bridge.sendCommand({ type: 'resizeTarget', targetId, size }));
    });
  }

  readPixels(): Promise<Uint8ClampedArray | null> { return Promise.resolve(null); }

  getDevice(): GPUDevice | null { return null; }

  getLastRenderedTexture(): GPUTexture | null { return null; }

  getStats(): EngineStats { return this.buildEngineStats(); }

  getLayerCollector(): RenderHostLayerCollector | null { return null; }

  getRenderLoop(): Record<string, unknown> {
    return {
      isRunning: this.renderLoopActive,
      animationId: this.rafId,
      animationIdNull: this.rafId == null,
      idleSuppressed: this.isWorkerIdle(),
      renderRequested: this.renderRequested,
      hasActiveVideo: (this.lastSoftwareFrameDiagnostics?.bitmapLayerCount ?? 0) > 0,
      isScrubbing: this.isScrubbing,
      getTimelineVisualDemand: () => this.timelineVisualDemand,
      getIsIdle: () => this.isWorkerIdle(),
      getIsPlaying: () => this.isPlaying,
      getRenderCount: () => this.renderCount,
      getLastSuccessfulRenderTime: () => this.lastSuccessfulRenderTime,
      lastRenderTime: this.lastSuccessfulRenderTime,
      watchdogTimer: this.statsInterval,
      workerPresenting: this.getDiagnostics(),
    };
  }

  getDebugInfrastructureState(): DebugInfrastructureState {
    return {
      hasDevice: false,
      hasRenderDispatcher: false,
      hasRenderTargetManager: this.targetRecords.size > 0,
      hasPreviewContext: this.targetRecords.has('preview'),
      targetCanvasCount: this.targetRecords.size,
      hasLayerCollector: false,
      hasCompositor: false,
      hasSampler: false,
      hasCompositorPipeline: false,
      hasOutputPipeline: false,
      hasPingView: false,
      hasPongView: false,
    };
  }

  getRenderDispatcherDebugSnapshot(): RenderDispatcherDebugSnapshot | null { return null; }

  captureVideoFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): boolean {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareSnapshotBlockedCount += 1;
      return false;
    }
    if (this.strictWorkerOnly) {
      if (this.isScrubbing && canCacheWorkerSoftwareHtmlVideoSnapshot(video)) {
        void cacheWorkerSoftwareHtmlVideoSnapshot({
          video,
          mediaTime: time,
          ownerId,
          maxSize: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE,
          resizeQuality: 'medium',
        }).then((cached) => {
          if (cached) this.requestNewFrameRender();
        });
      }
      return false;
    }
    const captured = this.fallback.captureVideoFrameAtTime(video, time, ownerId);
    if (this.isScrubbing) void cacheWorkerSoftwareHtmlVideoSnapshot({
      video, mediaTime: time, ownerId, maxSize: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE, resizeQuality: 'medium',
    }).then((cached) => {
      if (cached) this.requestNewFrameRender();
    });
    return captured;
  }

  async preCacheVideoFrame(video: HTMLVideoElement, ownerId?: string): Promise<boolean> {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareSnapshotBlockedCount += 1;
      return false;
    }
    const cached = await cacheWorkerSoftwareHtmlVideoSnapshot({
      video,
      mediaTime: video.currentTime,
      ownerId,
      maxSize: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE,
      resizeQuality: this.isScrubbing ? 'medium' : 'high',
    });
    if (cached) {
      this.requestNewFrameRender();
    }
    if (this.strictWorkerOnly) {
      return cached;
    }
    const fallbackCached = await this.fallback.preCacheVideoFrame(video, ownerId);
    return cached || fallbackCached;
  }

  ensureVideoFrameCached(video: HTMLVideoElement, ownerId?: string): void {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareSnapshotBlockedCount += 1;
      return;
    }
    if (this.isPlaying && !this.isScrubbing) {
      return;
    }
    void cacheWorkerSoftwareHtmlVideoSnapshot({
      video,
      mediaTime: video.currentTime,
      ownerId,
      maxSize: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE,
      resizeQuality: this.isScrubbing ? 'medium' : 'high',
      skipIfCached: true,
    }).then((cached) => {
      if (cached) this.requestNewFrameRender();
    });
    if (!this.strictWorkerOnly) {
      this.fallback.ensureVideoFrameCached(video, ownerId);
    }
  }

  cacheFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): void {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareSnapshotBlockedCount += 1;
      return;
    }
    void cacheWorkerSoftwareHtmlVideoSnapshot({
      video,
      mediaTime: time,
      ownerId,
      maxSize: this.isScrubbing ? WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_SIZE : undefined,
      resizeQuality: this.isScrubbing ? 'medium' : undefined,
    }).then((cached) => {
      if (cached) this.requestNewFrameRender();
    });
    if (!this.strictWorkerOnly) {
      this.fallback.cacheFrameAtTime(video, time);
    }
  }

  markVideoFramePresented(video: HTMLVideoElement, time?: number, ownerId?: string): void {
    const presentedTime = typeof time === 'number' && Number.isFinite(time)
      ? time
      : video.currentTime;
    if (typeof presentedTime === 'number' && Number.isFinite(presentedTime)) {
      this.lastPresentedVideoTimes.set(video, presentedTime);
    }
    if (!this.strictWorkerOnly) {
      this.fallback.markVideoFramePresented(video, time, ownerId);
    }
  }

  getLastPresentedVideoTime(video: HTMLVideoElement): number | undefined {
    const localTime = this.lastPresentedVideoTimes.get(video);
    if (typeof localTime === 'number') {
      return localTime;
    }
    return this.strictWorkerOnly
      ? undefined
      : this.fallback.getLastPresentedVideoTime(video);
  }

  markVideoGpuReady(video: HTMLVideoElement): void {
    if (!this.strictWorkerOnly) {
      this.fallback.markVideoGpuReady(video);
    }
  }

  cleanupVideo(video: HTMLVideoElement): void {
    this.lastPresentedVideoTimes.delete(video);
    if (!this.strictWorkerOnly) {
      this.fallback.cleanupVideo(video);
    }
  }

  private async initializeWorker(): Promise<boolean> {
    const output = await this.withBridge((bridge) => (
      bridge.initialize('worker-presenting-render-host', this.presentationStrategy)
    ));
    const success = output?.accepted === true;
    const engineStore = useEngineStore.getState();
    engineStore.setEngineReady(success);
    engineStore.setEngineInitFailed(!success, success ? undefined : 'Worker render host failed to initialize');
    if (success) {
      engineStore.setGpuInfo(null);
    }
    return success;
  }

  private startAnimationLoop(): void {
    if (!this.renderLoopActive || this.rafId !== null || !this.renderFrame || typeof requestAnimationFrame !== 'function') {
      return;
    }
    const tick = (timestamp: number) => {
      this.rafId = null;
      if (this.rafBackupTimer !== null) {
        clearTimeout(this.rafBackupTimer);
        this.rafBackupTimer = null;
      }
      const startedAt = performance.now();
      const cadenceAt = Number.isFinite(timestamp) ? timestamp : startedAt;
      const shouldRender = this.shouldRenderAnimationTick(cadenceAt);
      if (!shouldRender) {
        if (this.shouldContinueAnimationLoop()) {
          this.startAnimationLoop();
        } else {
          this.publishEngineStats();
        }
        return;
      }
      this.renderRequested = false;
      this.renderFrame?.();
      this.lastCadenceRenderAt = cadenceAt;
      this.recordRenderLoopTick(performance.now() - startedAt);
      if (this.shouldContinueAnimationLoop()) {
        this.startAnimationLoop();
      } else {
        this.publishEngineStats();
      }
    };
    this.rafId = requestAnimationFrame(tick);
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      this.rafBackupTimer = setTimeout(() => {
        if (this.rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(this.rafId);
        }
        this.rafId = null;
        this.rafBackupTimer = null;
        tick(performance.now());
      }, WORKER_PRESENTING_RAF_BACKUP_TIMEOUT_MS);
    }
  }

  private shouldRenderAnimationTick(now: number): boolean {
    if (this.renderRequested || this.isScrubbing || this.continuousRender) {
      return true;
    }
    if (!this.isPlaying) {
      return false;
    }
    const frameIntervalMs = 1000 / Math.max(1, this.currentCadenceTargetFps());
    return this.lastCadenceRenderAt <= 0 || now - this.lastCadenceRenderAt >= frameIntervalMs * 0.9;
  }

  private shouldContinueAnimationLoop(): boolean {
    return this.renderLoopActive
      && this.renderFrame !== null
      && (
        this.renderRequested ||
        this.isPlaying ||
        this.isScrubbing ||
        this.continuousRender
      );
  }

  private getBridge(): WorkerRenderHostRuntimeBridge | null {
    if (this.bridge) return this.bridge;
    if (this.bridgeFailed) return null;
    try {
      this.bridge = this.createBridge();
      return this.bridge;
    } catch (error) {
      this.bridgeFailed = true;
      log.warn('Worker presenting render host bridge unavailable', error);
      return null;
    }
  }

  private async withBridge(
    action: (bridge: WorkerRenderHostRuntimeBridge) => Promise<WorkerRenderHostRuntimeJobOutput>,
  ): Promise<WorkerRenderHostRuntimeJobOutput | null> {
    const bridge = this.getBridge();
    if (!bridge) return null;
    try {
      const output = await action(bridge);
      this.recordRuntimeOutput(output);
      return output;
    } catch (error) {
      log.warn('Worker presenting render host command failed', error);
      return null;
    }
  }

  private getTelemetrySourcePrefix(): 'worker-presenting' | 'worker-only' | 'worker-gpu-only' {
    if (!this.strictWorkerOnly) return 'worker-presenting';
    return this.presentationStrategy === 'worker-webgpu-present' ? 'worker-gpu-only' : 'worker-only';
  }

  private resolvePresentedTelemetrySource(
    output: WorkerRenderHostRuntimeJobOutput,
    requestedSource: string | undefined,
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics | null | undefined,
  ): string {
    if (output.presentedFrameId?.includes(':gpu-video-composite:')) {
      return 'worker-gpu-only:video-frame-compositor';
    }
    return requestedSource ?? `${this.getTelemetrySourcePrefix()}:${this.getPresentedDecoder(diagnostics)}`;
  }

  private recordRuntimeOutput(
    output: WorkerRenderHostRuntimeJobOutput,
    options: {
      readonly changed?: boolean;
      readonly targetMoved?: boolean;
      readonly diagnostics?: WorkerSoftwarePreviewFrameDiagnostics | null;
      readonly source?: string;
    } = {},
  ): void {
    const capturedAt = Date.now();
    this.lastPresentedFrameId = output.presentedFrameId ?? this.lastPresentedFrameId;
    const framePresentedEvent = output.statusEvents.find((event) => event.type === 'frame-presented') as
      | { readonly targetId?: string }
      | undefined;
    recordWorkerFirstSchedulerSnapshot(output.scheduler, capturedAt);
    recordWorkerFirstCacheSnapshot(output.cache, capturedAt);
    const timingCounters: {
      transferLatencyMs: number | null;
      providerWaitMs: number | null;
      presentedFrameId?: string;
    } = {
      transferLatencyMs: output.transferLatencyMs ?? null,
      providerWaitMs: output.providerWaitMs ?? null,
    };
    if (output.presentedFrameId) {
      timingCounters.presentedFrameId = output.presentedFrameId;
    }
    recordWorkerFirstTimingCounters(timingCounters, capturedAt);
    this.recordGpuWorkerStreamStats(output, capturedAt);
    const canRecordPresentedFrame = Boolean(output.presentedFrameId) && (
      Boolean(framePresentedEvent) ||
      output.commandType === 'presentSoftwareFrame' ||
      output.commandType === 'gpu.presentTestPattern' ||
      output.commandType === 'gpu.presentWebCodecsFrame' ||
      output.commandType === 'RenderNow' ||
      output.commandType === 'renderFrame' ||
      output.commandType === 'scrub' ||
      output.commandType === 'seek'
    );
    if (canRecordPresentedFrame && output.presentedFrameId) {
      recordWorkerFirstPresentedFrame({
        frameId: output.presentedFrameId,
        targetId: framePresentedEvent?.targetId ?? output.presentedFrameId.split(':')[0] ?? 'preview',
        source: this.resolvePresentedTelemetrySource(
          output,
          options.source,
          options.diagnostics,
        ),
        changed: options.changed ?? true,
        targetMoved: options.targetMoved ?? options.changed ?? true,
        driftMs: options.diagnostics?.maxVideoDriftMs,
      }, capturedAt);
    }
  }

  private runtimeOutputHasError(output: WorkerRenderHostRuntimeJobOutput | null): boolean {
    return output?.statusEvents.some((event) => event.type === 'error') ?? true;
  }

  private recordHeldSoftwareFrame(
    targetId: string,
    sequence: number,
    targetMoved: boolean,
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics | null,
  ): void {
    recordWorkerFirstPresentedFrame({
      frameId: this.lastPresentedFrameId ?? `${targetId}:worker-presenting:hold:${sequence}`,
      targetId,
      source: `${this.getTelemetrySourcePrefix()}:${this.getPresentedDecoder(diagnostics)}`,
      changed: false,
      targetMoved,
      driftMs: diagnostics?.maxVideoDriftMs,
    }, Date.now());
  }

  private presentLayers(targetId: string, layers: readonly Layer[], source: string): void {
    this.lastLayerCount = layers.length;
    if (this.isGpuOnlyPresentation) {
      this.presentGpuOnlyPattern(targetId, layers, source);
      this.publishEngineStats();
      return;
    }
    const record = this.resolvePresentationRecord(targetId);
    if (!record) {
      this.sendRenderNow(targetId, source);
      return;
    }
    const sequence = this.requestSequence++;
    this.latestPresentationSequenceByTarget.set(record.target.id, sequence);
    const request = {
      record,
      layers,
      source,
      sequence,
      targetKey: workerPresentationTargetKey(layers),
      enforceLatestSequence: !this.isScrubbing,
    };
    if (this.inFlightSoftwarePresentationTargets.has(record.target.id)) {
      this.pendingSoftwarePresentationsByTarget.set(record.target.id, request);
      this.coalescedSoftwareFrameCount += 1;
      this.publishEngineStats();
      return;
    }
    this.startSoftwarePresentation(request);
  }

  private presentGpuOnlyPattern(targetId: string, layers: readonly Layer[], source: string): void {
    const record = this.resolvePresentationRecord(targetId);
    if (!record) {
      this.gpuOnlyTestPatternFailureCount += 1;
      return;
    }
    const sequence = this.requestSequence++;
    this.latestPresentationSequenceByTarget.set(record.target.id, sequence);
    const request: WorkerGpuPresentationRequest = {
      record,
      layers,
      source,
      sequence,
      targetKey: workerPresentationTargetKey(layers),
      streamQueue: this.shouldQueueGpuStreamPresentation(layers),
      exactSeekQueue: this.shouldQueueGpuExactSeekPresentation(layers),
    };
    if (request.streamQueue) {
      const videoSources = this.resolveGpuOnlyVideoPresentationSources(layers);
      const videoSource = videoSources[0] ?? null;
      if (this.pendingGpuStreamStopsByTarget.has(record.target.id)) {
        this.queuePendingGpuPresentation(request);
        this.publishEngineStats();
        return;
      }
      const active = this.activeGpuStreamPresentationsByTarget.get(record.target.id);
      if (
        videoSource &&
        active?.streamKey === this.gpuStreamKey(videoSources) &&
        this.shouldKeepActiveGpuStream(active, videoSource, this.currentTargetSurfaceGeneration(record.target.id))
      ) {
        this.startGpuStreamStatsPolling();
        this.publishEngineStats();
        return;
      }
      if (this.pendingGpuStreamStartsByTarget.has(record.target.id)) {
        this.publishEngineStats();
        return;
      }
    }
    if (!this.attachedWorkerTargetIds.has(record.target.id)) {
      this.pendingGpuPresentationsByTarget.set(record.target.id, [request]);
      this.coalescedGpuFrameCount += 1;
      return;
    }
    if (this.inFlightGpuPresentationTargets.has(record.target.id)) {
      this.queuePendingGpuPresentation(request);
      return;
    }
    this.startGpuOnlyPresentation(request);
  }

  private shouldQueueGpuStreamPresentation(layers: readonly Layer[]): boolean {
    return this.isGpuOnlyPresentation &&
      this.isPlaying &&
      !this.isScrubbing &&
      this.isWorkerGpuStreamPlaybackSpeed() &&
      this.hasVisibleGpuOnlyVideoLayer(layers);
  }

  private isWorkerGpuStreamPlaybackSpeed(): boolean {
    return Math.abs(Math.abs(this.playbackSpeed) - 1) <= 0.001;
  }

  private shouldQueueGpuExactSeekPresentation(layers: readonly Layer[]): boolean {
    return this.isGpuOnlyPresentation &&
      !this.isPlaying &&
      !this.isScrubbing &&
      this.hasVisibleGpuOnlyVideoLayer(layers);
  }

  private queuePendingGpuPresentation(request: WorkerGpuPresentationRequest): void {
    const targetId = request.record.target.id;
    if (!request.streamQueue && !request.exactSeekQueue) {
      this.pendingGpuPresentationsByTarget.set(targetId, [request]);
      this.coalescedGpuFrameCount += 1;
      this.publishEngineStats();
      return;
    }

    const queue = this.pendingGpuPresentationsByTarget.get(targetId) ?? [];
    const queueLimit = request.streamQueue
      ? WORKER_PRESENTING_GPU_STREAM_PENDING_LIMIT
      : WORKER_PRESENTING_GPU_EXACT_SEEK_PENDING_LIMIT;
    if (queue.length >= queueLimit) {
      queue.shift();
      this.coalescedGpuFrameCount += 1;
    }
    queue.push(request);
    this.pendingGpuPresentationsByTarget.set(targetId, queue);
    this.publishEngineStats();
  }

  private clearQueuedGpuStreamPresentations(): void {
    for (const [targetId, queue] of this.pendingGpuPresentationsByTarget) {
      const retained = queue.filter((request) => !request.streamQueue);
      if (retained.length === 0) {
        this.pendingGpuPresentationsByTarget.delete(targetId);
      } else {
        this.pendingGpuPresentationsByTarget.set(targetId, retained);
      }
    }
  }

  private pendingGpuPresentationCount(): number {
    let count = 0;
    for (const queue of this.pendingGpuPresentationsByTarget.values()) {
      count += queue.length;
    }
    return count;
  }

  private startPendingGpuPresentationIfReady(targetId: string): void {
    if (!this.attachedWorkerTargetIds.has(targetId) || this.inFlightGpuPresentationTargets.has(targetId)) return;
    const queue = this.pendingGpuPresentationsByTarget.get(targetId);
    if (!queue || queue.length === 0) return;

    while (queue.length > 0) {
      const pending = queue.shift()!;
      if (queue.length === 0) {
        this.pendingGpuPresentationsByTarget.delete(targetId);
      } else {
        this.pendingGpuPresentationsByTarget.set(targetId, queue);
      }
      if (pending.streamQueue || pending.exactSeekQueue || this.latestPresentationSequenceByTarget.get(targetId) === pending.sequence) {
        this.startGpuOnlyPresentation(pending);
        return;
      }
    }
  }

  private startGpuOnlyPresentation(request: WorkerGpuPresentationRequest): void {
    this.inFlightGpuPresentationTargets.add(request.record.target.id);
    void this.runGpuOnlyPresentation(request)
      .finally(() => {
        this.inFlightGpuPresentationTargets.delete(request.record.target.id);
        this.startPendingGpuPresentationIfReady(request.record.target.id);
      });
  }

  private resolveGpuOnlyVideoPresentationSources(
    layers: readonly Layer[],
  ): readonly WorkerGpuVideoPresentationLayer[] {
    return this.workerGpuMediaSources.resolveVideoPresentationSources(
      layers,
      useMediaStore.getState().files,
    );
  }

  private createGpuOnlyVideoFrameLayers(
    sources: readonly WorkerGpuVideoPresentationLayer[],
  ): readonly WorkerGpuWebCodecsFrameLayer[] {
    return [...sources].reverse().map((source) => ({
      sourceId: source.sourceId,
      mediaTime: source.mediaTime,
      opacity: source.opacity,
      blendMode: source.blendMode,
      renderLayer: source.renderLayer,
      inlineBrightness: source.inlineBrightness,
      inlineContrast: source.inlineContrast,
      inlineSaturation: source.inlineSaturation,
      inlineInvert: source.inlineInvert,
      hueShift: source.hueShift,
      pixelateSize: source.pixelateSize,
      kaleidoscopeSegments: source.kaleidoscopeSegments,
      kaleidoscopeRotation: source.kaleidoscopeRotation,
      mirrorHorizontal: source.mirrorHorizontal,
      mirrorVertical: source.mirrorVertical,
      rgbSplitAmount: source.rgbSplitAmount,
      rgbSplitAngle: source.rgbSplitAngle,
      blurRadius: source.blurRadius,
      exposure: source.exposure,
      exposureOffset: source.exposureOffset,
      exposureGamma: source.exposureGamma,
      temperature: source.temperature,
      tint: source.tint,
      vibrance: source.vibrance,
      thresholdLevel: source.thresholdLevel,
      posterizeLevels: source.posterizeLevels,
      vignetteAmount: source.vignetteAmount,
      vignetteSize: source.vignetteSize,
      vignetteSoftness: source.vignetteSoftness,
      vignetteRoundness: source.vignetteRoundness,
      chromaKeyMode: source.chromaKeyMode,
      chromaKeyTolerance: source.chromaKeyTolerance,
      chromaKeySoftness: source.chromaKeySoftness,
      chromaKeySpill: source.chromaKeySpill,
      scanlineDensity: source.scanlineDensity,
      scanlineOpacity: source.scanlineOpacity,
      scanlineSpeed: source.scanlineSpeed,
      grainAmount: source.grainAmount,
      grainSize: source.grainSize,
      grainSpeed: source.grainSpeed,
      waveAmplitudeX: source.waveAmplitudeX,
      waveAmplitudeY: source.waveAmplitudeY,
      waveFrequencyX: source.waveFrequencyX,
      waveFrequencyY: source.waveFrequencyY,
      twirlAmount: source.twirlAmount,
      twirlRadius: source.twirlRadius,
      twirlCenterX: source.twirlCenterX,
      twirlCenterY: source.twirlCenterY,
      bulgeAmount: source.bulgeAmount,
      bulgeRadius: source.bulgeRadius,
      bulgeCenterX: source.bulgeCenterX,
      bulgeCenterY: source.bulgeCenterY,
      sharpenAmount: source.sharpenAmount,
      sharpenRadius: source.sharpenRadius,
      edgeDetectStrength: source.edgeDetectStrength,
      edgeDetectInvert: source.edgeDetectInvert,
      glowAmount: source.glowAmount,
      glowThreshold: source.glowThreshold,
      glowRadius: source.glowRadius,
      levelsInputBlack: source.levelsInputBlack,
      levelsInputWhite: source.levelsInputWhite,
      levelsGamma: source.levelsGamma,
      levelsOutputBlack: source.levelsOutputBlack,
      levelsOutputWhite: source.levelsOutputWhite,
      levelsEnabled: source.levelsEnabled,
      complexEffectCount: source.complexEffectCount,
    }));
  }

  private async createGpuOnlyHtmlVideoFrameLayers(
    layers: readonly Layer[],
  ): Promise<{
    readonly layers: readonly WorkerRenderHostGpuTransferredVideoFrameLayer[];
    readonly transfer: Transferable[];
  }> {
    if (typeof createImageBitmap !== 'function') {
      return { layers: [], transfer: [] };
    }

    const capturedLayers = await Promise.all([...layers].reverse().map(async (
      layer,
    ): Promise<WorkerRenderHostGpuTransferredVideoFrameLayer | null> => {
      const source = layer.source;
      if (!layer.visible || source?.type !== 'video' || !source.videoElement) return null;
      const video = source.videoElement;
      if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return null;

      const mediaTime = typeof source.mediaTime === 'number' && Number.isFinite(source.mediaTime)
        ? source.mediaTime
        : video.currentTime;
      const timestampSeconds = Number.isFinite(video.currentTime)
        ? video.currentTime
        : mediaTime;

      try {
        const frame = await createImageBitmap(video);
        return {
          sourceId: `html-video:${layer.sourceClipId ?? layer.id}`,
          mediaTime,
          frame,
          timestampSeconds,
          ...resolveWorkerGpuVideoPresentationLayerStyle(layer),
        };
      } catch (error) {
        log.warn('HTMLVideo frame transfer capture failed', {
          layerId: layer.id,
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }));
    const htmlLayers = capturedLayers.filter((layer): layer is WorkerRenderHostGpuTransferredVideoFrameLayer => !!layer);

    return {
      layers: htmlLayers,
      transfer: htmlLayers.map((layer) => layer.frame as unknown as Transferable),
    };
  }

  private async ensureGpuOnlyVideoSourceLoaded(
    bridge: WorkerRenderHostRuntimeBridge,
    source: WorkerGpuVideoPresentationSource,
    sequence: number,
  ): Promise<boolean> {
    const result = await this.workerGpuMediaSources.loadVideoSource(
      bridge,
      source,
      `worker-gpu-only:load-video:${sequence}`,
    );
    if (result.status === 'loaded') {
      this.gpuOnlyVideoSourceLoadCount += 1;
      return true;
    }
    if (result.status === 'already-loaded') {
      return true;
    }
    this.gpuOnlyVideoSourceLoadFailureCount += 1;
    log.warn('Worker WebGPU video source load failed', { sourceId: source.sourceId });
    return false;
  }

  private async ensureGpuOnlyVideoSourcesLoaded(
    bridge: WorkerRenderHostRuntimeBridge,
    sources: readonly WorkerGpuVideoPresentationSource[],
    sequence: number,
  ): Promise<boolean> {
    const results = await Promise.all(
      sources.map((source) => this.ensureGpuOnlyVideoSourceLoaded(bridge, source, sequence)),
    );
    return results.every(Boolean);
  }

  private hasVisibleGpuOnlyVideoLayer(layers: readonly Layer[]): boolean {
    return layers.some((layer) => layer.visible && layer.source?.type === 'video');
  }

  private resolveGpuOnlyWebCodecsMode(
    source?: WorkerGpuVideoPresentationSource,
  ): WorkerRenderHostWebCodecsSeekMode {
    if (this.isScrubbing) {
      if (source && this.shouldUseFastGpuOnlyScrubSeek(source)) {
        return 'fast';
      }
      return 'scrub';
    }
    if (!this.isPlaying) return 'seek';
    if (this.isWorkerGpuStreamPlaybackSpeed()) return 'stream';
    if (this.playbackSpeed < 0) return 'reverse';
    if (Math.abs(this.playbackSpeed - 1) > 0.001) return 'fast';
    return 'stream';
  }

  private shouldUseFastGpuOnlyScrubSeek(source: WorkerGpuVideoPresentationSource): boolean {
    const lastTimestamp = this.lastGpuOnlyVideoFrameTimestampSeconds;
    if (lastTimestamp === null || !Number.isFinite(lastTimestamp) || !Number.isFinite(source.mediaTime)) {
      return false;
    }
    const frameRate = this.lastGpuOnlyVideoFrameSourceFrameRate !== null &&
      this.lastGpuOnlyVideoFrameSourceFrameRate > 0
      ? this.lastGpuOnlyVideoFrameSourceFrameRate
      : WORKER_PRESENTING_TARGET_FPS;
    const drift = Math.abs(source.mediaTime - lastTimestamp);
    return drift >= Math.max(
      WORKER_PRESENTING_GPU_SCRUB_FAST_SEEK_MIN_DRIFT_SECONDS,
      10 / Math.max(1, frameRate),
    );
  }

  private timeoutForGpuOnlyWebCodecsMode(mode: WorkerRenderHostWebCodecsSeekMode): number {
    switch (mode) {
      case 'stream':
        return 0;
      case 'fast':
        return 90;
      case 'reverse':
        return 120;
      case 'scrub':
        return 32;
      case 'advance':
        return 80;
      case 'seek':
        return 120;
    }
  }

  private runtimeOutputPresentedRequest(
    output: WorkerRenderHostRuntimeJobOutput,
    requestId: string,
  ): boolean {
    return output.statusEvents.some((event) => (
      event.type === 'frame-presented' &&
      event.requestId === requestId
    ));
  }

  private runtimeOutputStats(
    output: WorkerRenderHostRuntimeJobOutput,
  ): Extract<WorkerRenderStatusEvent, { readonly type: 'stats' }>['stats'] | null {
    const event = output.statusEvents.find((
      candidate,
    ): candidate is Extract<WorkerRenderStatusEvent, { readonly type: 'stats' }> => (
      candidate.type === 'stats'
    ));
    return event?.stats ?? null;
  }

  private runtimeOutputNumberStat(
    output: WorkerRenderHostRuntimeJobOutput,
    key: string,
  ): number | null {
    const value = this.runtimeOutputStats(output)?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private runtimeOutputStringStat(
    output: WorkerRenderHostRuntimeJobOutput,
    key: string,
  ): string | null {
    const value = this.runtimeOutputStats(output)?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private runtimeOutputBooleanStat(
    output: WorkerRenderHostRuntimeJobOutput,
    key: string,
  ): boolean | null {
    const value = this.runtimeOutputStats(output)?.[key];
    return typeof value === 'boolean' ? value : null;
  }

  private recordGpuWorkerStreamStats(
    output: WorkerRenderHostRuntimeJobOutput,
    capturedAt: number,
  ): void {
    const presentedFrameCount = this.runtimeOutputNumberStat(
      output,
      'workerGpu.videoFrame.workerStream.presentedFrameCount',
    );
    const targetId = this.runtimeOutputStringStat(output, 'workerGpu.videoFrame.workerStream.targetId');
    if (presentedFrameCount === null || !targetId) return;

    const active = this.runtimeOutputBooleanStat(output, 'workerGpu.videoFrame.workerStream.active');
    const sourceId = this.runtimeOutputStringStat(output, 'workerGpu.videoFrame.workerStream.sourceId') ?? 'worker-stream';
    const stream = this.activeGpuStreamPresentationsByTarget.get(targetId);
    if (!stream && active === false) return;
    const previousPresented = stream?.lastPresentedFrameCount ?? 0;
    const nextPresented = Math.max(previousPresented, presentedFrameCount);
    const deltaPresented = Math.max(0, nextPresented - previousPresented);
    const distinctFrameCount = this.runtimeOutputNumberStat(
      output,
      'workerGpu.videoFrame.workerStream.distinctFrameCount',
    );
    const repeatedFrameCount = this.runtimeOutputNumberStat(
      output,
      'workerGpu.videoFrame.workerStream.repeatedFrameCount',
    );
    const previousDistinct = stream?.lastDistinctFrameCount ?? 0;
    const previousRepeated = stream?.lastRepeatedFrameCount ?? 0;
    const nextDistinct = Math.max(previousDistinct, distinctFrameCount ?? previousDistinct);
    const nextRepeated = Math.max(previousRepeated, repeatedFrameCount ?? previousRepeated);
    const deltaDistinct = Math.max(0, nextDistinct - previousDistinct);
    const deltaRepeated = Math.max(0, nextRepeated - previousRepeated);

    if (stream) {
      stream.lastPresentedFrameCount = nextPresented;
      stream.lastDistinctFrameCount = nextDistinct;
      stream.lastRepeatedFrameCount = nextRepeated;
    }

    this.lastGpuOnlyVideoFrameStats = this.runtimeOutputStats(output);
    const sourceFrameRate = this.runtimeOutputNumberStat(output, 'workerGpu.videoFrame.sourceFrameRate');
    if (sourceFrameRate !== null) {
      this.lastGpuOnlyVideoFrameSourceFrameRate = sourceFrameRate;
    }
    const timestampSeconds = this.runtimeOutputNumberStat(output, 'workerGpu.videoFrame.timestampSeconds');
    if (timestampSeconds !== null) {
      this.lastGpuOnlyVideoFrameTimestampSeconds = timestampSeconds;
      if (stream) {
        stream.lastPresentedTimestampSeconds = timestampSeconds;
      }
    }

    if (deltaPresented > 0) {
      const inferredDistinctDelta = Math.max(0, deltaPresented - deltaRepeated);
      const changedFrameDelta = deltaDistinct > 0 ? deltaDistinct : inferredDistinctDelta;
      this.gpuOnlyVideoFrameCount += deltaPresented;
      this.gpuOnlyDistinctVideoFrameCount += changedFrameDelta;
      this.gpuOnlyRepeatedVideoFrameCount += deltaRepeated;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const frameIntervalMs = Math.max(1, 1000 / Math.max(1, sourceFrameRate ?? WORKER_PRESENTING_TARGET_FPS));
      for (let index = 0; index < deltaPresented; index++) {
        const changed = index < changedFrameDelta;
        recordWorkerFirstPresentedFrame({
          frameId: `${targetId}:${sourceId}:worker-stream:${previousPresented + index + 1}`,
          targetId,
          source: this.resolvePresentedTelemetrySource(
            output,
            'worker-gpu-only:video-frame',
            null,
          ),
          changed,
          targetMoved: true,
          t: now - (deltaPresented - index - 1) * frameIntervalMs,
        }, capturedAt);
      }
    }

    if (active === false) {
      this.activeGpuStreamPresentationsByTarget.delete(targetId);
    }
  }

  private updateGpuOnlyVideoFrameTimestamp(timestampSeconds: number | null): boolean {
    if (timestampSeconds === null) {
      this.lastGpuOnlyVideoFrameTimestampSeconds = null;
      return true;
    }
    const previousTimestampSeconds = this.lastGpuOnlyVideoFrameTimestampSeconds;
    this.lastGpuOnlyVideoFrameTimestampSeconds = timestampSeconds;
    return previousTimestampSeconds === null ||
      Math.abs(timestampSeconds - previousTimestampSeconds) > 0.000001;
  }

  private resetGpuOnlySeekRetry(targetId: string): void {
    this.gpuSeekRetryCountByTarget.delete(targetId);
  }

  private scheduleGpuOnlySeekRetry(targetId: string, targetKey: string, mode: WorkerRenderHostWebCodecsSeekMode): void {
    if (mode !== 'seek' || this.isPlaying || this.isScrubbing) {
      return;
    }
    const current = this.gpuSeekRetryCountByTarget.get(targetId);
    const count = current?.targetKey === targetKey ? current.count + 1 : 1;
    if (count > WORKER_PRESENTING_GPU_SEEK_RETRY_LIMIT) {
      this.gpuSeekRetryCountByTarget.delete(targetId);
      return;
    }
    this.gpuSeekRetryCountByTarget.set(targetId, { targetKey, count });
    this.requestNewFrameRender();
  }

  private gpuStreamKey(
    sourceOrSources: WorkerGpuVideoPresentationSource | readonly WorkerGpuVideoPresentationLayer[],
  ): string {
    const sources = Array.isArray(sourceOrSources) ? sourceOrSources : [sourceOrSources];
    const sourceKey = sources.map((source) => {
      const layer = source as Partial<WorkerGpuVideoPresentationLayer>;
      return [
        source.sourceId,
        numberTargetKey(layer.opacity),
        layer.blendMode ?? 'normal',
        numberTargetKey(layer.inlineBrightness),
        numberTargetKey(layer.inlineContrast),
        numberTargetKey(layer.inlineSaturation),
        layer.inlineInvert === true ? 'invert' : 'no-invert',
        numberTargetKey(layer.hueShift),
        numberTargetKey(layer.pixelateSize),
        numberTargetKey(layer.kaleidoscopeSegments),
        numberTargetKey(layer.kaleidoscopeRotation),
        layer.mirrorHorizontal === true ? 'mh' : 'no-mh',
        layer.mirrorVertical === true ? 'mv' : 'no-mv',
        numberTargetKey(layer.rgbSplitAmount),
        numberTargetKey(layer.rgbSplitAngle),
        numberTargetKey(layer.blurRadius),
        numberTargetKey(layer.exposure),
        numberTargetKey(layer.exposureOffset),
        numberTargetKey(layer.exposureGamma),
        numberTargetKey(layer.temperature),
        numberTargetKey(layer.tint),
        numberTargetKey(layer.vibrance),
        numberTargetKey(layer.thresholdLevel),
        numberTargetKey(layer.posterizeLevels),
        numberTargetKey(layer.vignetteAmount),
        numberTargetKey(layer.vignetteSize),
        numberTargetKey(layer.vignetteSoftness),
        numberTargetKey(layer.vignetteRoundness),
        numberTargetKey(layer.chromaKeyMode),
        numberTargetKey(layer.chromaKeyTolerance),
        numberTargetKey(layer.chromaKeySoftness),
        numberTargetKey(layer.chromaKeySpill),
        numberTargetKey(layer.scanlineDensity),
        numberTargetKey(layer.scanlineOpacity),
        numberTargetKey(layer.scanlineSpeed),
        numberTargetKey(layer.grainAmount),
        numberTargetKey(layer.grainSize),
        numberTargetKey(layer.grainSpeed),
        numberTargetKey(layer.waveAmplitudeX),
        numberTargetKey(layer.waveAmplitudeY),
        numberTargetKey(layer.waveFrequencyX),
        numberTargetKey(layer.waveFrequencyY),
        numberTargetKey(layer.twirlAmount),
        numberTargetKey(layer.twirlRadius),
        numberTargetKey(layer.twirlCenterX),
        numberTargetKey(layer.twirlCenterY),
        numberTargetKey(layer.bulgeAmount),
        numberTargetKey(layer.bulgeRadius),
        numberTargetKey(layer.bulgeCenterX),
        numberTargetKey(layer.bulgeCenterY),
        numberTargetKey(layer.sharpenAmount),
        numberTargetKey(layer.sharpenRadius),
        numberTargetKey(layer.edgeDetectStrength),
        layer.edgeDetectInvert === true ? 'edge-invert' : 'no-edge-invert',
        numberTargetKey(layer.glowAmount),
        numberTargetKey(layer.glowThreshold),
        numberTargetKey(layer.glowRadius),
        numberTargetKey(layer.levelsInputBlack),
        numberTargetKey(layer.levelsInputWhite),
        numberTargetKey(layer.levelsGamma),
        numberTargetKey(layer.levelsOutputBlack),
        numberTargetKey(layer.levelsOutputWhite),
        layer.levelsEnabled === true ? 'levels' : 'no-levels',
        String(layer.complexEffectCount ?? 0),
      ].join('@');
    }).join('|');
    return [
      sourceKey,
      this.playbackSpeed.toFixed(3),
      this.currentCadenceTargetFps(),
    ].join(':');
  }

  private captureGpuPauseHolds(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const [targetId, active] of this.activeGpuStreamPresentationsByTarget) {
      const timestamp = active.lastPresentedTimestampSeconds ?? this.lastGpuOnlyVideoFrameTimestampSeconds;
      if (timestamp === null || !Number.isFinite(timestamp)) continue;
      this.pendingGpuPauseHoldsByTarget.set(targetId, {
        sourceId: active.sourceId,
        timestampSeconds: timestamp,
        expiresAtMs: now + WORKER_PRESENTING_GPU_PAUSE_HOLD_TTL_MS,
      });
    }
  }

  private resolveGpuOnlySeekMediaTime(
    targetId: string,
    source: WorkerGpuVideoPresentationSource,
    mode: WorkerRenderHostWebCodecsSeekMode,
  ): number {
    if (mode !== 'seek' || this.isPlaying || this.isScrubbing) {
      return source.mediaTime;
    }
    const hold = this.pendingGpuPauseHoldsByTarget.get(targetId);
    this.pendingGpuPauseHoldsByTarget.delete(targetId);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      !hold ||
      hold.sourceId !== source.sourceId ||
      hold.expiresAtMs < now ||
      !Number.isFinite(hold.timestampSeconds)
    ) {
      return source.mediaTime;
    }
    const sourceFrameRate = this.lastGpuOnlyVideoFrameSourceFrameRate;
    const frameRate = sourceFrameRate !== null && sourceFrameRate > 0
      ? sourceFrameRate
      : WORKER_PRESENTING_TARGET_FPS;
    const heldTimestamp = hold.timestampSeconds;
    const drift = heldTimestamp - source.mediaTime;
    const maxHoldDrift = drift >= 0
      ? Math.max(WORKER_PRESENTING_GPU_PAUSE_HOLD_AHEAD_DRIFT_SECONDS, 5 / Math.max(1, frameRate))
      : Math.max(WORKER_PRESENTING_GPU_PAUSE_HOLD_BEHIND_DRIFT_SECONDS, 3 / Math.max(1, frameRate));
    return Math.abs(drift) <= maxHoldDrift
      ? heldTimestamp
      : source.mediaTime;
  }

  private expectedActiveGpuStreamMediaTime(active: WorkerGpuActiveStreamPresentation): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSeconds = Math.max(0, (now - active.anchoredAtMs) / 1000);
    return active.baseMediaTime + elapsedSeconds * active.playbackRate;
  }

  private shouldKeepActiveGpuStream(
    active: WorkerGpuActiveStreamPresentation,
    source: WorkerGpuVideoPresentationSource,
    targetSurfaceGeneration: number,
  ): boolean {
    if (active.targetSurfaceGeneration !== targetSurfaceGeneration) {
      return false;
    }
    if (!Number.isFinite(source.mediaTime)) {
      return true;
    }
    return Math.abs(source.mediaTime - this.expectedActiveGpuStreamMediaTime(active)) <=
      WORKER_PRESENTING_GPU_STREAM_REANCHOR_DRIFT_SECONDS;
  }

  private startGpuStreamStatsPolling(): void {
    if (this.gpuStreamStatsInterval !== null) return;
    this.gpuStreamStatsInterval = setInterval(() => {
      if (this.activeGpuStreamPresentationsByTarget.size === 0) {
        this.stopGpuStreamStatsPollingIfIdle();
        return;
      }
      if (this.gpuStreamStatsPollInFlight) return;
      const bridge = this.getBridge();
      if (!bridge) return;
      this.gpuStreamStatsPollInFlight = true;
      void this.withBridge((runtime) => runtime.collectStats(`worker-gpu-only:stream-stats:${this.requestSequence++}`))
        .finally(() => {
          this.gpuStreamStatsPollInFlight = false;
        });
    }, WORKER_PRESENTING_GPU_STREAM_STATS_POLL_MS);
  }

  private stopGpuStreamStatsPollingIfIdle(): void {
    if (this.activeGpuStreamPresentationsByTarget.size > 0) return;
    if (this.gpuStreamStatsInterval !== null) {
      clearInterval(this.gpuStreamStatsInterval);
      this.gpuStreamStatsInterval = null;
    }
    this.gpuStreamStatsPollInFlight = false;
  }

  private stopGpuOnlyStreamPresentation(targetId: string, reason: string): void {
    this.pendingGpuStreamStartsByTarget.delete(targetId);
    const active = this.activeGpuStreamPresentationsByTarget.get(targetId);
    if (!active) {
      this.pendingGpuStreamStopsByTarget.delete(targetId);
      this.stopGpuStreamStatsPollingIfIdle();
      return;
    }
    if (this.pendingGpuStreamStopsByTarget.has(targetId)) {
      return;
    }
    this.pendingGpuStreamStopsByTarget.add(targetId);
    const requestId = `worker-gpu-only:stop-stream:${this.requestSequence++}`;
    void this.withBridge((bridge) => bridge.stopGpuWebCodecsStream(requestId, targetId, {
      sourceId: active.sourceId,
      reason,
    })).finally(() => {
      this.pendingGpuStreamStopsByTarget.delete(targetId);
      const current = this.activeGpuStreamPresentationsByTarget.get(targetId);
      if (current?.requestId === active.requestId) {
        this.activeGpuStreamPresentationsByTarget.delete(targetId);
      }
      this.stopGpuStreamStatsPollingIfIdle();
      this.publishEngineStats();
      this.startPendingGpuPresentationIfReady(targetId);
      if (
        this.isGpuOnlyPresentation &&
        this.isPlaying &&
        !this.activeGpuStreamPresentationsByTarget.has(targetId) &&
        !this.pendingGpuStreamStartsByTarget.has(targetId) &&
        !this.pendingGpuStreamStopsByTarget.has(targetId) &&
        this.attachedWorkerTargetIds.has(targetId)
      ) {
        this.requestRender();
      }
    });
  }

  private stopAllGpuOnlyStreamPresentations(reason: string): void {
    for (const targetId of [...this.activeGpuStreamPresentationsByTarget.keys()]) {
      this.stopGpuOnlyStreamPresentation(targetId, reason);
    }
    this.pendingGpuStreamStartsByTarget.clear();
  }

  private async startOrKeepGpuOnlyStreamPresentation(input: {
    readonly bridge: WorkerRenderHostRuntimeBridge;
    readonly record: WorkerRenderTargetRecord;
    readonly videoSource: WorkerGpuVideoPresentationSource;
    readonly videoSources: readonly WorkerGpuVideoPresentationLayer[];
    readonly request: WorkerGpuPresentationRequest;
  }): Promise<void> {
    const targetId = input.record.target.id;
    const streamKey = this.gpuStreamKey(input.videoSources);
    const active = this.activeGpuStreamPresentationsByTarget.get(targetId);
    if (this.pendingGpuStreamStopsByTarget.has(targetId)) {
      return;
    }
    if (active) {
      if (
        active.streamKey === streamKey &&
        this.shouldKeepActiveGpuStream(active, input.videoSource, input.record.targetSurfaceGeneration)
      ) {
        this.startGpuStreamStatsPolling();
        this.publishEngineStats();
        return;
      }
      this.stopGpuOnlyStreamPresentation(targetId, 'stream target or source changed');
      return;
    }
    if (this.pendingGpuStreamStartsByTarget.has(targetId)) {
      return;
    }

    this.stopGpuOnlyStreamPresentation(targetId, 'stream source changed');
    this.pendingGpuStreamStartsByTarget.add(targetId);
    this.publishEngineStats();

    const loaded = await this.ensureGpuOnlyVideoSourcesLoaded(
      input.bridge,
      input.videoSources,
      input.request.sequence,
    );
    if (!loaded) {
      this.pendingGpuStreamStartsByTarget.delete(targetId);
      this.presentationFailures += 1;
      this.gpuOnlyVideoFrameFailureCount += 1;
      this.publishEngineStats();
      return;
    }

    const requestId = `worker-gpu-only:stream:${input.request.source}:${input.request.sequence}`;
    this.activeGpuStreamPresentationsByTarget.set(targetId, {
      sourceId: input.videoSource.sourceId,
      streamKey,
      requestId,
      targetSurfaceGeneration: input.record.targetSurfaceGeneration,
      startedAtMs: Date.now(),
      sequence: input.request.sequence,
      baseMediaTime: input.videoSource.mediaTime,
      anchoredAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      playbackRate: this.playbackSpeed,
      lastPresentedTimestampSeconds: null,
      lastPresentedFrameCount: 0,
      lastDistinctFrameCount: 0,
      lastRepeatedFrameCount: 0,
    });
    try {
      const output = await input.bridge.startGpuWebCodecsStream(
        requestId,
        targetId,
        input.videoSource.sourceId,
        input.videoSource.timelineTime,
        input.videoSource.mediaTime,
        input.request.sequence,
        {
          playbackRate: this.playbackSpeed,
          targetFps: this.currentCadenceTargetFps(),
          timeoutMs: 48,
          layers: this.createGpuOnlyVideoFrameLayers(input.videoSources),
        },
      );
      this.pendingGpuStreamStartsByTarget.delete(targetId);
      this.lastGpuOnlyVideoFrameStats = this.runtimeOutputStats(output);
      this.recordRuntimeOutput(output, {
        changed: true,
        targetMoved: true,
        source: 'worker-gpu-only:video-frame',
      });
      if (this.runtimeOutputHasError(output) && !output.presentedFrameId) {
        this.presentationFailures += 1;
        this.gpuOnlyVideoFrameFailureCount += 1;
        const activeAfterFailure = this.activeGpuStreamPresentationsByTarget.get(targetId);
        if (activeAfterFailure?.requestId === requestId) {
          this.activeGpuStreamPresentationsByTarget.delete(targetId);
        }
        this.stopGpuStreamStatsPollingIfIdle();
        if (this.isPlaying && this.attachedWorkerTargetIds.has(targetId)) {
          this.requestRender();
        }
      } else {
        this.resetGpuOnlySeekRetry(targetId);
        this.startGpuStreamStatsPolling();
      }
      this.publishEngineStats();
    } catch (error) {
      this.pendingGpuStreamStartsByTarget.delete(targetId);
      this.activeGpuStreamPresentationsByTarget.delete(targetId);
      this.presentationFailures += 1;
      this.gpuOnlyVideoFrameFailureCount += 1;
      this.stopGpuStreamStatsPollingIfIdle();
      this.publishEngineStats();
      log.warn('Worker WebGPU stream presentation failed', error);
    }
  }

  private async runGpuOnlyPresentation(request: WorkerGpuPresentationRequest): Promise<void> {
    const { record, source, sequence } = request;
    const requestId = `worker-gpu-only:${source}:${sequence}`;
    this.presentationAttempts += 1;
    this.publishEngineStats();
    const bridge = this.getBridge();
    if (!bridge) {
      this.presentationFailures += 1;
      this.gpuOnlyTestPatternFailureCount += 1;
      this.publishEngineStats();
      return;
    }

    let attemptedVideoFrame = false;
    try {
      const previousTargetKey = this.lastTargetKeyByTarget.get(record.target.id);
      const targetMoved = previousTargetKey !== undefined && previousTargetKey !== request.targetKey;
      const htmlFramePacket = !flags.useFullWebCodecsPlayback
        ? await this.createGpuOnlyHtmlVideoFrameLayers(request.layers)
        : null;
      if (htmlFramePacket && htmlFramePacket.layers.length > 0) {
        attemptedVideoFrame = true;
        this.stopGpuOnlyStreamPresentation(record.target.id, 'transferred HTMLVideo frame');
        const output = await bridge.presentGpuTransferredVideoFrames(
          requestId,
          record.target.id,
          request.layers[0]?.source?.mediaTime ?? 0,
          sequence,
          htmlFramePacket.layers,
          htmlFramePacket.transfer,
        );
        this.lastGpuOnlyVideoFrameStats = this.runtimeOutputStats(output);
        const presented = this.runtimeOutputPresentedRequest(output, requestId);
        const sourceFrameChanged = presented
          ? this.updateGpuOnlyVideoFrameTimestamp(
            this.runtimeOutputNumberStat(output, 'workerGpu.videoFrame.timestampSeconds')
          )
          : false;
        const playbackTargetMoved = (this.isPlaying || this.isScrubbing) && targetMoved;
        this.recordRuntimeOutput(output, {
          changed: sourceFrameChanged,
          targetMoved: playbackTargetMoved,
          source: 'worker-gpu-only:video-frame',
        });
        if (!presented) {
          this.presentationFailures += 1;
          this.gpuOnlyVideoFrameFailureCount += 1;
        } else {
          this.resetGpuOnlySeekRetry(record.target.id);
          this.gpuOnlyVideoFrameCount += 1;
          if (sourceFrameChanged) {
            this.gpuOnlyDistinctVideoFrameCount += 1;
          } else {
            this.gpuOnlyRepeatedVideoFrameCount += 1;
          }
          this.lastTargetKeyByTarget.set(record.target.id, request.targetKey);
        }
        this.publishEngineStats();
        return;
      }

      const videoSources = flags.useFullWebCodecsPlayback
        ? this.resolveGpuOnlyVideoPresentationSources(request.layers)
        : [];
      const videoSource = videoSources[0] ?? null;
      if (videoSource) {
        attemptedVideoFrame = true;
        const mode = this.resolveGpuOnlyWebCodecsMode(videoSource);
        if (mode === 'stream') {
          await this.startOrKeepGpuOnlyStreamPresentation({
            bridge,
            record,
            videoSource,
            videoSources,
            request,
          });
          return;
        }
        const loaded = await this.ensureGpuOnlyVideoSourcesLoaded(bridge, videoSources, sequence);
        if (!loaded) {
          this.presentationFailures += 1;
          this.gpuOnlyVideoFrameFailureCount += 1;
          this.publishEngineStats();
          return;
        }
        this.stopGpuOnlyStreamPresentation(record.target.id, `gpu mode ${mode}`);
        const mediaTime = this.resolveGpuOnlySeekMediaTime(record.target.id, videoSource, mode);
        const output = await bridge.presentGpuWebCodecsFrame(
          requestId,
          record.target.id,
          videoSource.sourceId,
          videoSource.timelineTime,
          mediaTime,
          sequence,
          {
            mode,
            timeoutMs: this.timeoutForGpuOnlyWebCodecsMode(mode),
            layers: this.createGpuOnlyVideoFrameLayers(videoSources),
          },
        );
        this.lastGpuOnlyVideoFrameStats = this.runtimeOutputStats(output);
        const presented = this.runtimeOutputPresentedRequest(output, requestId);
        const sourceFrameRate = this.runtimeOutputNumberStat(output, 'workerGpu.videoFrame.sourceFrameRate');
        if (sourceFrameRate !== null) {
          this.lastGpuOnlyVideoFrameSourceFrameRate = sourceFrameRate;
        }
        const sourceFrameChanged = presented
          ? this.updateGpuOnlyVideoFrameTimestamp(
            this.runtimeOutputNumberStat(output, 'workerGpu.videoFrame.timestampSeconds')
          )
          : false;
        const playbackTargetMoved = (this.isPlaying || this.isScrubbing) && targetMoved;
        this.recordRuntimeOutput(output, {
          changed: sourceFrameChanged,
          targetMoved: playbackTargetMoved,
          source: 'worker-gpu-only:video-frame',
        });
        if (!presented) {
          this.presentationFailures += 1;
          this.gpuOnlyVideoFrameFailureCount += 1;
          this.scheduleGpuOnlySeekRetry(record.target.id, request.targetKey, mode);
        } else {
          this.resetGpuOnlySeekRetry(record.target.id);
          this.gpuOnlyVideoFrameCount += 1;
          if (sourceFrameChanged) {
            this.gpuOnlyDistinctVideoFrameCount += 1;
          } else {
            this.gpuOnlyRepeatedVideoFrameCount += 1;
          }
          this.lastTargetKeyByTarget.set(record.target.id, request.targetKey);
        }
        this.publishEngineStats();
        return;
      }

      this.stopGpuOnlyStreamPresentation(record.target.id, 'no stream video source');
      if (this.hasVisibleGpuOnlyVideoLayer(request.layers)) {
        this.presentationFailures += 1;
        this.gpuOnlyVideoFrameFailureCount += 1;
        this.publishEngineStats();
        return;
      }

      const output = await bridge.presentGpuTestPattern(
        requestId,
        record.target.id,
        0,
        sequence,
      );
      this.recordRuntimeOutput(output, {
        changed: true,
        targetMoved,
        source: 'worker-gpu-only:gpu-test-pattern',
      });
      if (!output.presentedFrameId) {
        this.presentationFailures += 1;
        this.gpuOnlyTestPatternFailureCount += 1;
      } else {
        this.gpuOnlyTestPatternFrameCount += 1;
        this.lastTargetKeyByTarget.set(record.target.id, request.targetKey);
      }
      this.publishEngineStats();
    } catch (error) {
      this.presentationFailures += 1;
      if (attemptedVideoFrame) {
        this.gpuOnlyVideoFrameFailureCount += 1;
      } else {
        this.gpuOnlyTestPatternFailureCount += 1;
      }
      this.publishEngineStats();
      log.warn('Worker WebGPU presentation failed', error);
    }
  }

  private async cacheLatestWorkerCompositeFrame(time: number): Promise<void> {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareFrameBlockedCount += 1;
      return;
    }
    if (this.compositeCache.has(time) || this.latestRenderedLayers.length === 0) return;
    const record = this.resolvePresentationRecord('preview');
    if (!record) {
      this.sendRenderNow('preview', 'cache-composite-frame');
      return;
    }
    const bridge = this.getBridge();
    if (!bridge) return;

    const sequence = this.requestSequence++;
    const requestId = `worker-presenting:cache-composite:${sequence}`;
    const packet = await this.buildSoftwareFrameForPresentation(this.latestRenderedLayers, record, sequence, {
      enforceLatestSequence: false,
    });
    if (!packet) return;
    this.lastAttemptedSoftwareFrameDiagnostics = packet.diagnostics;
    if (this.shouldHoldSoftwareFrame(packet, this.latestRenderedLayers)) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.publishEngineStats();
      return;
    }

    try {
      const output = await bridge.presentSoftwareFrame(
        requestId,
        record.target.id,
        time,
        packet.frame,
        packet.transfer,
        { readback: true },
      );
      this.recordRuntimeOutput(output, { changed: true, diagnostics: packet.diagnostics });
      if (output.presentedFrameId) {
        this.lastSoftwareFrameDiagnostics = packet.diagnostics;
      }
      this.compositeCache.cacheReadback(time, output.readback);
      this.publishEngineStats();
    } catch (error) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.presentationFailures += 1;
      this.publishEngineStats();
      log.warn('Worker composite cache readback failed', error);
    }
  }

  private async presentCachedCompositeFrame(time: number): Promise<void> {
    if (this.isGpuOnlyPresentation) {
      this.gpuOnlySoftwareFrameBlockedCount += 1;
      return;
    }
    const record = this.resolvePresentationRecord('preview');
    if (!record) return;
    const packet = await this.compositeCache.createFrame(time);
    if (!packet) return;
    const bridge = this.getBridge();
    if (!bridge) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      return;
    }

    try {
      const output = await bridge.presentSoftwareFrame(
        `worker-presenting:cached-composite:${this.requestSequence++}`,
        record.target.id,
        time,
        packet.frame,
        packet.transfer,
      );
      this.recordRuntimeOutput(output, { changed: true });
      this.publishEngineStats();
    } catch (error) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.presentationFailures += 1;
      this.publishEngineStats();
      log.warn('Worker cached composite presentation failed', error);
    }
  }

  private resolvePresentationRecord(targetId: string): WorkerRenderTargetRecord | null {
    const directRecord = this.targetRecords.get(targetId);
    if (directRecord) return directRecord;
    const previewRecord = this.targetRecords.get('preview');
    if (previewRecord) return previewRecord;
    if (targetId !== 'preview') return null;

    const targetStore = useRenderTargetStore.getState();
    for (const target of targetStore.targets.values()) {
      if (target.source.type !== 'activeComp' && target.source.type !== 'program') continue;
      const record = this.targetRecords.get(target.id);
      if (record) return record;
    }

    for (const target of targetStore.getActiveCompTargets()) {
      const record = this.targetRecords.get(target.id);
      if (record) return record;
    }
    return null;
  }

  private startSoftwarePresentation(request: WorkerSoftwarePresentationRequest): void {
    this.inFlightSoftwarePresentationTargets.add(request.record.target.id);
    void this.runSoftwarePresentation(request)
      .finally(() => {
        this.inFlightSoftwarePresentationTargets.delete(request.record.target.id);
        const pending = this.pendingSoftwarePresentationsByTarget.get(request.record.target.id);
        if (!pending) return;
        this.pendingSoftwarePresentationsByTarget.delete(request.record.target.id);
        if (this.latestPresentationSequenceByTarget.get(request.record.target.id) === pending.sequence) {
          this.startSoftwarePresentation(pending);
        }
      });
  }

  private async runSoftwarePresentation(request: WorkerSoftwarePresentationRequest): Promise<void> {
    const { record, layers, source, sequence } = request;
    const requestId = `worker-presenting:${source}:${sequence}`;
    const packet = await this.buildSoftwareFrameForPresentation(layers, record, sequence, {
      enforceLatestSequence: request.enforceLatestSequence,
    });
    if (!packet) {
      return;
    }
    this.lastAttemptedSoftwareFrameDiagnostics = packet.diagnostics;
    if (this.shouldHoldSoftwareFrame(packet, layers)) {
      this.heldEmptySoftwareFrameCount += 1;
      const previousTargetKey = this.lastTargetKeyByTarget.get(record.target.id);
      this.recordHeldSoftwareFrame(
        record.target.id,
        sequence,
        previousTargetKey !== undefined && previousTargetKey !== request.targetKey,
        packet.diagnostics,
      );
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.publishEngineStats();
      return;
    }
    this.presentationAttempts += 1;
    this.publishEngineStats();
    const bridge = this.getBridge();
    if (!bridge) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.presentationFailures += 1;
      this.publishEngineStats();
      return;
    }
    try {
      const contentKey = workerSoftwareFrameContentKey(packet.frame);
      const contentChanged = this.lastContentKeyByTarget.get(record.target.id) !== contentKey;
      const previousTargetKey = this.lastTargetKeyByTarget.get(record.target.id);
      const targetMoved = previousTargetKey !== undefined && previousTargetKey !== request.targetKey;
      const output = await bridge.presentSoftwareFrame(
        requestId,
        record.target.id,
        0,
        packet.frame,
        packet.transfer,
      );
      this.recordRuntimeOutput(output, {
        changed: contentChanged,
        targetMoved,
        diagnostics: packet.diagnostics,
      });
      if (!output.presentedFrameId) {
        this.presentationFailures += 1;
      } else {
        this.lastSoftwareFrameDiagnostics = packet.diagnostics;
        this.lastContentKeyByTarget.set(record.target.id, contentKey);
        this.lastTargetKeyByTarget.set(record.target.id, request.targetKey);
        this.rememberHeldSoftwareLayers(packet.frame);
        this.rememberWorkerBitmapCacheKeys(collectWorkerSoftwareBitmapCacheKeys(packet.frame));
      }
      this.publishEngineStats();
    } catch (error) {
      closeWorkerSoftwarePreviewFrame(packet.frame);
      this.presentationFailures += 1;
      this.publishEngineStats();
      log.warn('Worker software preview presentation failed', error);
    }
  }

  private async buildSoftwareFrameForPresentation(
    layers: readonly Layer[],
    record: WorkerRenderTargetRecord,
    sequence: number,
    options: { readonly enforceLatestSequence?: boolean } = {},
  ): Promise<WorkerSoftwarePreviewFrameBuildResult | null> {
    const enforceLatestSequence = options.enforceLatestSequence !== false;
    for (let attempt = 0; ; attempt++) {
      if (enforceLatestSequence && this.latestPresentationSequenceByTarget.get(record.target.id) !== sequence) {
        return null;
      }
      const packet = await buildWorkerSoftwarePreviewFrame(layers, {
        width: record.target.size.x,
        height: record.target.size.y,
      }, {
        allowHtmlVideoSnapshots: true,
        allowCachedVideoSnapshots: (
          this.isPlaying ||
          this.timelineVisualDemand ||
          this.isWithinPostScrubTransientHoldWindow()
        ),
        cacheHtmlVideoSnapshots: this.isPlaying || this.isScrubbing || this.timelineVisualDemand,
        preferCachedVideoSnapshots: !this.isPlaying && !this.isScrubbing,
        allowTransientVideoSnapshots: (
          this.isPlaying ||
          this.isScrubbing
        ),
        cachedVideoSnapshotMaxDriftSeconds: this.isScrubbing
          ? WORKER_PRESENTING_CACHED_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS
          : this.isPlaying
            ? WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_DRIFT_SECONDS
            : WORKER_PRESENTING_IDLE_SNAPSHOT_MAX_DRIFT_SECONDS,
        videoSnapshotMaxDriftSeconds: this.isScrubbing
          ? WORKER_PRESENTING_LIVE_SCRUB_SNAPSHOT_MAX_DRIFT_SECONDS
          : undefined,
        workerBitmapCacheKeys: this.workerBitmapCacheKeys,
        heldVideoLayers: this.heldSoftwareLayersById,
        maxBitmapSnapshotSize: bitmapSnapshotMaxSizeForPresentation(
          record,
          this.isScrubbing,
          this.isPlaying,
          this.currentCadenceTargetFps(),
        ),
        bitmapSnapshotResizeQuality: this.isScrubbing ? 'medium' : 'high',
      });
      if (enforceLatestSequence && this.latestPresentationSequenceByTarget.get(record.target.id) !== sequence) {
        this.staleSoftwareFrameCount += 1;
        closeWorkerSoftwarePreviewFrame(packet.frame);
        this.publishEngineStats();
        return null;
      }
      if (this.canHoldLastCompleteFrameForTransientSkips(packet.diagnostics, layers.length)) {
        return packet;
      }
      if (
        (!this.isPlaying && !this.isScrubbing) ||
        !hasWorkerSoftwareBlockingSkips(packet.diagnostics) ||
        !hasOnlyTransientWorkerSoftwareSkips(packet.diagnostics) ||
        attempt >= WORKER_PRESENTING_TRANSIENT_RETRY_LIMIT
      ) {
        return packet;
      }
      this.transientSoftwareFrameRetryCount += 1;
      closeWorkerSoftwarePreviewFrame(packet.frame);
      await waitForWorkerPresentingRetry();
    }
  }

  private shouldHoldSoftwareFrame(
    packet: WorkerSoftwarePreviewFrameBuildResult,
    sourceLayers: readonly Layer[],
  ): boolean {
    return this.shouldHoldSoftwareFrameDiagnostics(packet.diagnostics, sourceLayers.length);
  }

  private rememberHeldSoftwareLayers(frame: WorkerSoftwarePreviewFrameBuildResult['frame']): void {
    for (const layer of frame.layers) {
      if (layer.source.kind !== 'bitmap' || !layer.source.cacheKey) {
        continue;
      }
      this.heldSoftwareLayersById.set(layer.id, {
        ...layer,
        source: {
          kind: 'cached-bitmap',
          cacheKey: layer.source.cacheKey,
          width: layer.source.width,
          height: layer.source.height,
        },
      });
    }
  }

  private shouldHoldSoftwareFrameDiagnostics(
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics,
    sourceLayerCount: number,
  ): boolean {
    if (sourceLayerCount <= 0 || !hasWorkerSoftwareBlockingSkips(diagnostics)) {
      return false;
    }
    if (diagnostics.presentableLayerCount === 0) {
      return true;
    }
    return this.shouldHoldTransientSoftwareFrameDiagnostics(diagnostics, sourceLayerCount);
  }

  private canHoldLastCompleteFrameForTransientSkips(
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics,
    sourceLayerCount: number,
  ): boolean {
    if (!this.shouldHoldTransientSoftwareFrameDiagnostics(diagnostics, sourceLayerCount)) {
      return false;
    }
    const lastFrame = this.lastSoftwareFrameDiagnostics;
    if (
      !lastFrame ||
      lastFrame.sourceLayerCount !== sourceLayerCount ||
      lastFrame.presentableLayerCount !== sourceLayerCount ||
      lastFrame.skippedLayerCount !== 0
    ) {
      return false;
    }
    return true;
  }

  private shouldHoldTransientSoftwareFrameDiagnostics(
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics,
    sourceLayerCount: number,
  ): boolean {
    if (
      sourceLayerCount <= 0 ||
      diagnostics.skippedLayerCount <= 0 ||
      diagnostics.presentableLayerCount >= sourceLayerCount ||
      !hasOnlyTransientWorkerSoftwareSkips(diagnostics)
    ) {
      return false;
    }
    return (
      this.isScrubbing ||
      this.isPlaying ||
      this.timelineVisualDemand ||
      this.isWithinPostScrubTransientHoldWindow()
    );
  }

  private isWithinPostScrubTransientHoldWindow(): boolean {
    if (this.lastScrubEndedAt <= 0) {
      return false;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return now - this.lastScrubEndedAt <= WORKER_PRESENTING_POST_SCRUB_TRANSIENT_HOLD_MS;
  }

  private sendRenderNow(targetId: string, source: string): void {
    const requestId = `worker-presenting:${source}:${this.requestSequence++}`;
    this.presentationAttempts += 1;
    void this.withBridge((bridge) => bridge.renderNow(requestId, targetId, 0));
  }

  private cancelPendingTargetDetach(targetId: string): boolean {
    const timer = this.pendingTargetDetachTimers.get(targetId);
    if (!timer) return false;
    clearTimeout(timer);
    this.pendingTargetDetachTimers.delete(targetId);
    return true;
  }

  private nextTargetSurfaceGeneration(targetId: string): number {
    const nextGeneration = (this.targetSurfaceGenerationByTarget.get(targetId) ?? 0) + 1;
    this.targetSurfaceGenerationByTarget.set(targetId, nextGeneration);
    return nextGeneration;
  }

  private currentTargetSurfaceGeneration(targetId: string): number {
    return this.targetSurfaceGenerationByTarget.get(targetId) ?? 0;
  }

  private recordRenderLoopTick(durationMs: number): void {
    const now = performance.now();
    this.renderCount += 1;
    this.lastSuccessfulRenderTime = now;
    this.lastRenderDurationMs = durationMs;
    const tickTargetFps = this.currentCadenceTargetFps();
    this.fpsWindowTargetFps = Math.min(this.fpsWindowTargetFps, tickTargetFps);
    if (this.fpsWindowStartedAt === 0) {
      this.fpsWindowStartedAt = now;
      this.fpsWindowTargetFps = tickTargetFps;
    } else if (now - this.fpsWindowStartedAt >= 1000) {
      this.currentFps = this.fpsWindowFrames;
      this.currentTargetFps = this.fpsWindowTargetFps;
      this.dropsLastSecond = Math.max(0, this.currentTargetFps - this.fpsWindowFrames);
      this.totalDrops += this.dropsLastSecond;
      this.fpsWindowStartedAt = now;
      this.fpsWindowFrames = 0;
      this.fpsWindowTargetFps = tickTargetFps;
    }
    this.fpsWindowFrames += 1;
  }

  private currentCadenceTargetFps(): number {
    if (this.isScrubbing) return WORKER_PRESENTING_SCRUB_TARGET_FPS;
    if (this.isPlaying) {
      const { activeCompositionId, compositions } = useMediaStore.getState();
      const activeComposition = activeCompositionId
        ? compositions.find((composition) => composition.id === activeCompositionId)
        : null;
      const frameRate = activeComposition?.frameRate;
      if (typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0) {
        return Math.max(1, Math.min(WORKER_PRESENTING_TARGET_FPS, Math.round(frameRate)));
      }
    }
    return WORKER_PRESENTING_TARGET_FPS;
  }

  private resetFpsWindowForCadenceChange(): void {
    const targetFps = this.currentCadenceTargetFps();
    this.currentTargetFps = targetFps;
    this.fpsWindowTargetFps = targetFps;
    this.fpsWindowStartedAt = 0;
    this.fpsWindowFrames = 0;
    this.dropsLastSecond = 0;
    this.lastCadenceRenderAt = 0;
  }

  private isWorkerIdle(): boolean {
    return !this.isPlaying
      && !this.isScrubbing
      && !this.continuousRender
      && !this.renderRequested
      && this.rafId === null
      && this.inFlightSoftwarePresentationTargets.size === 0
      && this.pendingSoftwarePresentationsByTarget.size === 0
      && this.inFlightGpuPresentationTargets.size === 0
      && this.pendingGpuPresentationCount() === 0
      && this.activeGpuStreamPresentationsByTarget.size === 0
      && this.pendingGpuStreamStartsByTarget.size === 0;
  }

  private buildEngineStats(): EngineStats {
    const decoder = this.getPresentedDecoder();
    const playbackWindowMs = WORKER_PRESENTING_PLAYBACK_STATS_WINDOW_MS;
    const playbackNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const workerPreviewEvents = getWorkerFirstPresentedFrameEvents(playbackWindowMs, playbackNow);
    const isIdle = this.isWorkerIdle();
    const dropsLastSecond = isIdle ? 0 : this.dropsLastSecond;
    return {
      fps: isIdle ? 0 : this.currentFps,
      frameTime: this.lastRenderDurationMs,
      gpuMemory: 0,
      timing: {
        rafGap: 0,
        importTexture: 0,
        renderPass: this.lastRenderDurationMs,
        submit: 0,
        total: this.lastRenderDurationMs,
      },
      drops: {
        count: this.totalDrops,
        lastSecond: dropsLastSecond,
        reason: dropsLastSecond > 0 ? 'slow_render' : 'none',
      },
      layerCount: this.lastLayerCount,
      targetFps: this.currentCadenceTargetFps(),
      decoder,
      audio: {
        playing: 0,
        drift: 0,
        status: 'silent',
      },
      playback: buildPlaybackDebugStats({
        decoder,
        now: playbackNow,
        windowMs: playbackWindowMs,
        wcTimeline: wcPipelineMonitor.timeline(playbackWindowMs),
        vfTimeline: vfPipelineMonitor.timeline(playbackWindowMs),
        workerPreviewEvents,
      }),
      isIdle,
    };
  }

  private getPresentedDecoder(
    diagnostics: WorkerSoftwarePreviewFrameDiagnostics | null = this.lastSoftwareFrameDiagnostics,
  ): EngineStats['decoder'] {
    if (this.isGpuOnlyPresentation && this.gpuOnlyVideoFrameCount > 0) {
      return 'WebCodecs';
    }
    const lastSoftwareFrame = diagnostics;
    if (!lastSoftwareFrame) return 'none';
    const htmlVideoLayers = lastSoftwareFrame.htmlVideoLayerCount ?? 0;
    const webCodecsLayers = lastSoftwareFrame.webCodecsLayerCount ?? 0;
    if (webCodecsLayers > 0 && htmlVideoLayers > 0) {
      return 'WebCodecs+HTMLVideo';
    }
    if (webCodecsLayers > 0) {
      return 'WebCodecs';
    }
    if (htmlVideoLayers > 0) {
      return 'HTMLVideo';
    }
    return 'none';
  }

  private publishEngineStats(): void {
    useEngineStore.getState().setEngineStats(this.buildEngineStats());
  }

  blockMainFallback(operation: string): void {
    this.fallbackBlockedCount += 1;
    this.fallbackBlockedOperations = [
      operation,
      ...this.fallbackBlockedOperations.filter((entry) => entry !== operation),
    ].slice(0, 12);
  }

  private getDiagnostics(): Record<string, unknown> {
    const lastSoftwareFrame = this.lastSoftwareFrameDiagnostics;
    const lastAttemptedSoftwareFrame = this.lastAttemptedSoftwareFrameDiagnostics;
    const documentVisibility = documentVisibilityDiagnostics();
    const latestRenderedForcedRuntimeFrameLayerCount = this.latestRenderedLayers.filter(
      (layer) => layer.source?.forceRuntimeFramePreview === true
    ).length;
    return {
      strictWorkerOnly: this.strictWorkerOnly,
      presentationStrategy: this.presentationStrategy,
      fallbackBlockedCount: this.fallbackBlockedCount,
      fallbackBlockedOperations: this.fallbackBlockedOperations,
      gpuOnlySoftwareFrameBlockedCount: this.gpuOnlySoftwareFrameBlockedCount,
      gpuOnlySoftwareSnapshotBlockedCount: this.gpuOnlySoftwareSnapshotBlockedCount,
      gpuOnlyTestPatternFrameCount: this.gpuOnlyTestPatternFrameCount,
      gpuOnlyTestPatternFailureCount: this.gpuOnlyTestPatternFailureCount,
      gpuOnlyVideoFrameCount: this.gpuOnlyVideoFrameCount,
      gpuOnlyVideoFrameFailureCount: this.gpuOnlyVideoFrameFailureCount,
      gpuOnlyDistinctVideoFrameCount: this.gpuOnlyDistinctVideoFrameCount,
      gpuOnlyRepeatedVideoFrameCount: this.gpuOnlyRepeatedVideoFrameCount,
      lastGpuOnlyVideoFrameTimestampSeconds: this.lastGpuOnlyVideoFrameTimestampSeconds,
      lastGpuOnlyVideoFrameSourceFrameRate: this.lastGpuOnlyVideoFrameSourceFrameRate,
      lastGpuOnlyVideoFrameStats: this.lastGpuOnlyVideoFrameStats,
      gpuOnlyVideoSourceLoadCount: this.gpuOnlyVideoSourceLoadCount,
      gpuOnlyVideoSourceLoadFailureCount: this.gpuOnlyVideoSourceLoadFailureCount,
      gpuOnlyUnsupportedRenderEffectFallbackCount: this.workerGpuMediaSources.unsupportedRenderEffectFallbackCount,
      gpuOnlyUnsupportedRenderEffectFallbacks: this.workerGpuMediaSources.lastUnsupportedRenderEffectFallbacks,
      loadedGpuVideoSourceCount: this.workerGpuMediaSources.loadedSourceCount,
      pendingGpuVideoSourceLoadCount: this.workerGpuMediaSources.pendingLoadCount,
      targetIds: [...this.targetRecords.keys()],
      fallbackTargetIds: [...this.fallbackTargetIds],
      documentVisibility,
      rafThrottledByHiddenDocument: documentVisibility.hidden === true && this.renderLoopActive,
      renderLoopActive: this.renderLoopActive,
      isPlaying: this.isPlaying,
      isScrubbing: this.isScrubbing,
      timelineVisualDemand: this.timelineVisualDemand,
      continuousRender: this.continuousRender,
      renderRequested: this.renderRequested,
      renderCount: this.renderCount,
      fps: this.currentFps,
      lastLayerCount: this.lastLayerCount,
      latestRenderedForcedRuntimeFrameLayerCount,
      presentationAttempts: this.presentationAttempts,
      presentationFailures: this.presentationFailures,
      staleSoftwareFrameCount: this.staleSoftwareFrameCount,
      transientSoftwareFrameRetryCount: this.transientSoftwareFrameRetryCount,
      coalescedSoftwareFrameCount: this.coalescedSoftwareFrameCount,
      coalescedGpuFrameCount: this.coalescedGpuFrameCount,
      inFlightSoftwareFrameCount: this.inFlightSoftwarePresentationTargets.size,
      pendingSoftwareFrameCount: this.pendingSoftwarePresentationsByTarget.size,
      inFlightGpuFrameCount: this.inFlightGpuPresentationTargets.size,
      pendingGpuFrameCount: this.pendingGpuPresentationCount(),
      activeGpuStreamCount: this.activeGpuStreamPresentationsByTarget.size,
      pendingGpuStreamStartCount: this.pendingGpuStreamStartsByTarget.size,
      pendingGpuStreamStopCount: this.pendingGpuStreamStopsByTarget.size,
      lastPresentedFrameId: this.lastPresentedFrameId,
      lastSoftwareFrame,
      lastAttemptedSoftwareFrame,
      holdingLastSoftwareFrame: lastAttemptedSoftwareFrame
        ? this.shouldHoldSoftwareFrameDiagnostics(lastAttemptedSoftwareFrame, this.lastLayerCount)
        : false,
      heldEmptySoftwareFrameCount: this.heldEmptySoftwareFrameCount,
    };
  }
}

export function createWorkerPresentingRenderHostPort(options: WorkerPresentingRenderHostPortOptions): RenderHostPort {
  const core = new WorkerPresentingRenderHostPortCore(options);
  const fallback = options.fallback;
  const readStrictWorkerOnly = typeof options.strictWorkerOnly === 'function'
    ? options.strictWorkerOnly
    : () => options.strictWorkerOnly === true;
  return new Proxy({} as RenderHostPort, {
    get(_target, propertyKey: keyof RenderHostPort) {
      const presentingValue = (core as unknown as Record<keyof RenderHostPort, unknown>)[propertyKey];
      if (typeof presentingValue === 'function') {
        return presentingValue.bind(core);
      }
      if (presentingValue !== undefined) {
        return presentingValue;
      }
      const fallbackValue = fallback[propertyKey];
      if (readStrictWorkerOnly()) {
        if (typeof fallbackValue === 'function') {
          return () => {
            core.blockMainFallback(`proxy:${String(propertyKey)}`);
            return undefined;
          };
        }
        core.blockMainFallback(`proxy:${String(propertyKey)}`);
        return undefined;
      }
      return typeof fallbackValue === 'function'
        ? fallbackValue.bind(fallback)
        : fallbackValue;
    },
  });
}
