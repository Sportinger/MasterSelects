// RenderDispatcher — extracted render methods from WebGPUEngine
// Handles: render(), renderEmptyFrame(), renderToPreviewCanvas(), renderCachedFrame()

import type { Layer, LayerRenderData } from '../core/types';
import type { TextureManager } from '../texture/TextureManager';
import type { MaskTextureManager } from '../texture/MaskTextureManager';
import type { CacheManager } from '../managers/CacheManager';
import type { ExportCanvasManager } from '../managers/ExportCanvasManager';
import type { CompositorPipeline } from '../pipeline/CompositorPipeline';
import type { OutputPipeline } from '../pipeline/OutputPipeline';
import type { SlicePipeline } from '../pipeline/SlicePipeline';
import type { RenderTargetManager } from '../core/RenderTargetManager';
import type { LayerCollector } from './LayerCollector';
import type { Compositor } from './Compositor';
import type { NestedCompRenderer } from './NestedCompRenderer';
import type { PerformanceStats } from '../stats/PerformanceStats';
import type { RenderLoop } from './RenderLoop';
import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { useSliceStore } from '../../stores/sliceStore';
import { useTimelineStore } from '../../stores/timeline';
import { reportRenderTime } from '../../services/performanceMonitor';
import { Logger } from '../../services/logger';
import { scrubSettleState } from '../../services/scrubSettleState';
import { vfPipelineMonitor } from '../../services/vfPipelineMonitor';
import { getCopiedHtmlVideoPreviewFrame } from './htmlVideoPreviewFallback';
import { flags } from '../featureFlags';
import type { NativeSceneRenderer } from '../native3d/NativeSceneRenderer';
import { collectActiveSceneSplatEffectors } from '../scene/SceneEffectorUtils';
import { collectScene3DLayers } from '../scene/SceneLayerCollector';
import { resolveRenderableSharedSceneCamera } from '../scene/SceneCameraUtils';
import type { SceneSplatEffectorRuntimeData, SceneSplatLayer } from '../scene/types';
import { useMediaStore } from '../../stores/mediaStore';
import { useEngineStore, type GaussianSplatLoadPhase } from '../../stores/engineStore';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { loadGaussianSplatAssetCached, type GaussianSplatLoadProgress } from '../gaussian/loaders';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { getGaussianSplatSequenceFrameIndex } from '../../utils/gaussianSplatSequence';
import {
  buildSharedSplatRuntimeRequest,
  resolveSharedSplatSceneKey,
} from '../scene/runtime/SharedSplatRuntimeUtils';

const log = Logger.create('RenderDispatcher');
const GAUSSIAN_PLAYBACK_SORT_FREQUENCY = 6;
const MAX_EXPORT_LAYER_NESTING_DEPTH = 8;

type GaussianSplatSceneLoadRequest = {
  sceneKey: string;
  clipId?: string;
  url?: string;
  fileName: string;
  file?: File;
  showProgress?: boolean;
  maxSplats?: number;
};

const SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS = 65536;
const SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS = 3;
const SPLAT_SEQUENCE_PLAYBACK_PRELOAD_FRAMES = 72;
const SPLAT_SEQUENCE_PLAYBACK_RETAIN_BEHIND_FRAMES = 12;
const SPLAT_SEQUENCE_PLAYBACK_RETAIN_AHEAD_FRAMES = 72;

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/**
 * Mutable deps bag — the engine updates these references as they change
 * (e.g. after device loss/restore, canvas attach/detach).
 */
export interface RenderDeps {
  getDevice: () => GPUDevice | null;
  isRecovering: () => boolean;
  sampler: GPUSampler | null;
  previewContext: GPUCanvasContext | null;
  targetCanvases: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  compositorPipeline: CompositorPipeline | null;
  outputPipeline: OutputPipeline | null;
  slicePipeline: SlicePipeline | null;
  textureManager: TextureManager | null;
  maskTextureManager: MaskTextureManager | null;
  renderTargetManager: RenderTargetManager | null;
  layerCollector: LayerCollector | null;
  compositor: Compositor | null;
  nestedCompRenderer: NestedCompRenderer | null;
  cacheManager: CacheManager;
  exportCanvasManager: ExportCanvasManager;
  performanceStats: PerformanceStats;
  renderLoop: RenderLoop | null;
  sceneRenderer?: NativeSceneRenderer | null;
}

export interface RenderDispatcherDebugSnapshot {
  inputLayers: number;
  collectedLayerData: number;
  after3DLayerData: number;
  gaussianCandidates: number;
  gaussianRendered: number;
  gaussianPendingLoad: number;
  gaussianMissingUrl: number;
  gaussianNoTextureView: number;
  finalLayerData: number;
  splatSequence?: {
    targetSceneKey?: string;
    renderedSceneKey?: string;
    mode: 'target' | 'held' | 'missing';
    visualFrameChangesLastSecond: number;
    backgroundLoads: number;
  };
}

export class RenderDispatcher {
  /** Whether the last render() call produced visible content */
  lastRenderHadContent = false;
  lastRenderDebugSnapshot: RenderDispatcherDebugSnapshot | null = null;
  private deps: RenderDeps;
  private renderTimeOverride: number | null = null;
  private lastPreviewSignature = '';
  private lastPreviewTargetTimeMs?: number;
  private static readonly MAX_DRAG_FALLBACK_DRIFT_SECONDS = 1.2;
  private static readonly MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS = 0.9;
  private sceneRendererInitializing = false;
  // Native Gaussian Splat rendering state (new WebGPU path)
  private splatLoadingClips = new Set<string>();
  private backgroundSplatSequenceLoads = new Set<string>();
  private splatSceneBounds = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();
  private exportReadySceneRendererResolutions = new Set<string>();
  private exportReadyNativeSplatSceneKeys = new Set<string>();
  private exportReadyModelUrls = new Set<string>();
  private lastSceneRenderDebugKey = '';
  private lastSharedSplatSequenceFrame: {
    textureView: GPUTextureView;
    sceneKey: string;
    width: number;
    height: number;
  } | null = null;
  private lastRenderedSplatSequenceSceneKey: string | null = null;
  private splatSequenceVisualFrameChanges: number[] = [];

  constructor(deps: RenderDeps) {
    this.deps = deps;
    // Legacy gaussian-avatar code stays on disk for migration/reference only.
    void this.processGaussianLayers;
    // Legacy per-layer native splat bridge stays on disk for migration/reference only.
    void this.processGaussianSplatLayers;
  }

  setRenderTimeOverride(time: number | null): void {
    this.renderTimeOverride = typeof time === 'number' && Number.isFinite(time) ? time : null;
  }

  private getEffectiveTimelineTime(): number {
    if (this.renderTimeOverride !== null) {
      return this.renderTimeOverride;
    }
    return useTimelineStore.getState().playheadPosition;
  }

  private isNativeGaussianSplatSource(source: Layer['source'] | undefined): boolean {
    return source?.type === 'gaussian-splat';
  }

  private getNativeGaussianSplatSceneKey(
    clipId: string,
    runtimeKey?: string,
  ): string {
    return resolveSharedSplatSceneKey({
      clipId,
      runtimeKey,
    });
  }

  private getGaussianSplatFrameRuntimeKey(
    frame: NonNullable<SceneSplatLayer['gaussianSplatSequence']>['frames'][number] | undefined,
    fallbackKey: string,
  ): string {
    return frame?.projectPath || frame?.absolutePath || frame?.sourcePath || frame?.name || fallbackKey;
  }

  private getSplatSequencePreviewMaxSplats(layer: SceneSplatLayer): number | undefined {
    if (layer.gaussianSplatIsSequence !== true) {
      return undefined;
    }

    const requestedMaxSplats = Math.floor(layer.gaussianSplatSettings?.render?.maxSplats ?? 0);
    if (Number.isFinite(requestedMaxSplats) && requestedMaxSplats > 0) {
      return Math.min(requestedMaxSplats, SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS);
    }
    return SPLAT_SEQUENCE_PREVIEW_MAX_SPLATS;
  }

  private getGaussianSplatSequenceRuntimeKey(runtimeKey: string | undefined, maxSplats?: number): string | undefined {
    if (!runtimeKey || !maxSplats || maxSplats <= 0) {
      return runtimeKey;
    }
    return `${runtimeKey}|preview-lod-${maxSplats}`;
  }

  private getGaussianSplatSequenceFrameSceneKey(
    layer: SceneSplatLayer,
    frameIndex: number,
    maxSplats?: number,
  ): { sceneKey: string; runtimeKey: string; frame?: NonNullable<SceneSplatLayer['gaussianSplatSequence']>['frames'][number] } | null {
    const sequence = layer.gaussianSplatSequence;
    const frame = sequence?.frames[frameIndex];
    if (!sequence || !frame) {
      return null;
    }

    const fallbackKey = `${layer.clipId}:sequence:${frameIndex}`;
    const runtimeKey = this.getGaussianSplatSequenceRuntimeKey(
      this.getGaussianSplatFrameRuntimeKey(frame, fallbackKey),
      maxSplats,
    ) ?? fallbackKey;

    return {
      sceneKey: this.getNativeGaussianSplatSceneKey(layer.clipId, runtimeKey),
      runtimeKey,
      frame,
    };
  }

  private recordSplatSequenceVisualFrame(sceneKey: string | undefined, countAsChange: boolean): number {
    const now = performance.now();
    if (sceneKey && sceneKey !== this.lastRenderedSplatSequenceSceneKey) {
      if (countAsChange && this.lastRenderedSplatSequenceSceneKey !== null) {
        this.splatSequenceVisualFrameChanges.push(now);
      }
      this.lastRenderedSplatSequenceSceneKey = sceneKey;
    }

    const cutoff = now - 1000;
    this.splatSequenceVisualFrameChanges = this.splatSequenceVisualFrameChanges
      .filter((timestamp) => timestamp >= cutoff);
    return this.splatSequenceVisualFrameChanges.length;
  }

  private setSplatSequenceDebugSnapshot(
    snapshot: NonNullable<RenderDispatcherDebugSnapshot['splatSequence']>,
  ): void {
    if (this.lastRenderDebugSnapshot) {
      this.lastRenderDebugSnapshot.splatSequence = snapshot;
    }
  }

  private preloadNearbyGaussianSplatSequenceFrames(
    layer: SceneSplatLayer,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
    realtimePlayback: boolean,
    draggingPlayhead: boolean,
    maxSplats?: number,
  ): void {
    const sequence = layer.gaussianSplatSequence;
    if (!sequence || sequence.frames.length <= 1 || layer.mediaTime == null) {
      return;
    }
    if (draggingPlayhead && !realtimePlayback) {
      return;
    }

    const currentIndex = getGaussianSplatSequenceFrameIndex(sequence, layer.mediaTime);
    const usePlaybackPreloadWindow = realtimePlayback || !draggingPlayhead;
    const offsets = usePlaybackPreloadWindow
      ? Array.from({ length: SPLAT_SEQUENCE_PLAYBACK_PRELOAD_FRAMES + 1 }, (_, index) => index)
      : [0, -1, 1, -2, 2];
    let scheduled = 0;
    const maxSchedulePerPass = usePlaybackPreloadWindow ? SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS : 1;

    for (const offset of offsets) {
      if (
        scheduled >= maxSchedulePerPass ||
        this.backgroundSplatSequenceLoads.size >= SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS
      ) {
        continue;
      }

      const frameIndex = currentIndex + offset;
      if (frameIndex < 0 || frameIndex >= sequence.frames.length) {
        continue;
      }

      const frameInfo = this.getGaussianSplatSequenceFrameSceneKey(layer, frameIndex, maxSplats);
      if (!frameInfo) {
        continue;
      }
      const frame = frameInfo.frame;
      if (!frame?.file && !frame?.splatUrl) {
        continue;
      }

      const sceneKey = frameInfo.sceneKey;
      if (renderer.hasScene(sceneKey) || this.splatLoadingClips.has(sceneKey)) {
        continue;
      }

      scheduled += 1;
      this.scheduleBackgroundGaussianSplatSequenceLoad({
        sceneKey,
        clipId: layer.clipId,
        url: frame.splatUrl,
        fileName: frame.name || layer.gaussianSplatFileName || layer.layerId,
        file: frame.file,
        showProgress: false,
        maxSplats,
      });
    }
  }

  private scheduleBackgroundGaussianSplatSequenceLoad(
    request: GaussianSplatSceneLoadRequest,
    priority = false,
  ): void {
    if (
      this.backgroundSplatSequenceLoads.has(request.sceneKey) ||
      this.splatLoadingClips.has(request.sceneKey) ||
      (!priority && this.backgroundSplatSequenceLoads.size >= SPLAT_SEQUENCE_MAX_BACKGROUND_LOADS)
    ) {
      return;
    }

    this.backgroundSplatSequenceLoads.add(request.sceneKey);
    void this.ensureGaussianSplatSceneLoaded({
      ...request,
      showProgress: false,
    }).finally(() => {
      this.backgroundSplatSequenceLoads.delete(request.sceneKey);
    });
  }

  private pruneGaussianSplatSequencePreviewScenes(
    layer: SceneSplatLayer,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
    maxSplats: number | undefined,
  ): void {
    const sequence = layer.gaussianSplatSequence;
    if (!sequence || !maxSplats || maxSplats <= 0 || layer.mediaTime == null) {
      return;
    }

    const currentIndex = getGaussianSplatSequenceFrameIndex(sequence, layer.mediaTime);
    const retainStart = Math.max(0, currentIndex - SPLAT_SEQUENCE_PLAYBACK_RETAIN_BEHIND_FRAMES);
    const retainEnd = Math.min(sequence.frames.length - 1, currentIndex + SPLAT_SEQUENCE_PLAYBACK_RETAIN_AHEAD_FRAMES);

    for (let frameIndex = 0; frameIndex < sequence.frames.length; frameIndex += 1) {
      if (frameIndex >= retainStart && frameIndex <= retainEnd) {
        continue;
      }

      const frameInfo = this.getGaussianSplatSequenceFrameSceneKey(layer, frameIndex, maxSplats);
      if (!frameInfo || this.backgroundSplatSequenceLoads.has(frameInfo.sceneKey)) {
        continue;
      }
      if (this.lastSharedSplatSequenceFrame?.sceneKey === frameInfo.sceneKey) {
        continue;
      }

      renderer.releaseScene(frameInfo.sceneKey);
    }
  }

  private collectActiveSplatEffectors(width: number, height: number): SceneSplatEffectorRuntimeData[] {
    return collectActiveSceneSplatEffectors(
      width,
      height,
      this.getEffectiveTimelineTime(),
    );
  }

  async ensureGaussianSplatSceneLoaded(options: GaussianSplatSceneLoadRequest): Promise<boolean> {
    if (!options.url && !options.file) return false;

    const device = this.deps.getDevice();
    if (!device) return false;

    const renderer = getGaussianSplatGpuRenderer();
    if (!renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (renderer.hasScene(options.sceneKey)) {
      useEngineStore.getState().clearGaussianSplatLoadProgress(options.sceneKey);
      return true;
    }

    if (this.splatLoadingClips.has(options.sceneKey)) {
      return this.waitForGaussianSplatScene(options.sceneKey, renderer);
    }

    await this.loadAndUploadSplatScene(options, renderer);
    return renderer.hasScene(options.sceneKey);
  }

  async ensureSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    const { getNativeSceneRenderer } = await import('../native3d/NativeSceneRenderer');
    const renderer = this.deps.sceneRenderer ?? getNativeSceneRenderer();
    const initialized = await renderer.initialize(width, height);
    if (initialized) {
      this.deps.sceneRenderer = renderer;
    }
    return initialized;
  }

  async preloadSceneModelAsset(url: string, fileName: string): Promise<boolean> {
    if (!url) return false;

    const existingRenderer = this.deps.sceneRenderer;
    let renderer = existingRenderer;
    if (!renderer?.isInitialized) {
      const resolution = this.deps.renderTargetManager?.getResolution() ?? { width: 1, height: 1 };
      const initialized = await this.ensureSceneRendererInitialized(resolution.width, resolution.height);
      if (!initialized) {
        return false;
      }
      renderer = this.deps.sceneRenderer ?? null;
    }

    if (!renderer) {
      return false;
    }

    return renderer.preloadModel(url, fileName);
  }

  clearExportReadinessCache(): void {
    this.exportReadySceneRendererResolutions.clear();
    this.exportReadyNativeSplatSceneKeys.clear();
    this.exportReadyModelUrls.clear();
  }

  async ensureExportLayersReady(layers: Layer[]): Promise<void> {
    const visibleLayers = this.collectVisibleExportLayers(layers);
    if (visibleLayers.length === 0) {
      return;
    }

    const nativeSplats = new Map<string, ReturnType<typeof buildSharedSplatRuntimeRequest>>();
    const modelAssets = new Map<string, { url: string; fileName: string }>();
    let needsSceneRenderer = false;

    for (const layer of visibleLayers) {
      const source = layer.source;
      if (!source) {
        continue;
      }

      if (
        layer.is3D === true &&
        source.type !== 'camera'
      ) {
        needsSceneRenderer = true;
      }

      if (source.type === 'model' && source.modelUrl) {
        modelAssets.set(source.modelUrl, {
          url: source.modelUrl,
          fileName: source.file?.name ?? layer.name,
        });
      }

      if (source.type !== 'gaussian-splat') {
        continue;
      }

      const mediaFileId = source.mediaFileId;
      const mediaFile = mediaFileId
        ? useMediaStore.getState().files.find((file) => file.id === mediaFileId) ?? null
        : null;
      const fileName =
        source.gaussianSplatFileName ??
        mediaFile?.file?.name ??
        source.file?.name ??
        mediaFile?.name ??
        layer.name;
      const file =
        source.file && (typeof source.file.size !== 'number' || source.file.size > 0)
          ? source.file
          : mediaFile?.file && (typeof mediaFile.file.size !== 'number' || mediaFile.file.size > 0)
            ? mediaFile.file
            : undefined;
      const gaussianSplatSequence = source.gaussianSplatSequence ?? mediaFile?.gaussianSplatSequence;
      const preferBaseRuntime = !!gaussianSplatSequence;
      const fileHash = preferBaseRuntime ? undefined : (source.gaussianSplatFileHash ?? mediaFile?.fileHash);
      const requestedMaxSplats = source.gaussianSplatSettings?.render.maxSplats ?? 0;
      const request = buildSharedSplatRuntimeRequest({
        clipId: layer.sourceClipId ?? layer.id,
        runtimeKey: source.gaussianSplatRuntimeKey,
        url: source.gaussianSplatUrl,
        file,
        fileName,
        fileHash,
        mediaFileId,
        gaussianSplatSequence,
        gaussianSplatSettings: source.gaussianSplatSettings,
        requestedMaxSplats,
      });

      if (!request.url && !request.file) {
        throw new Error(`Precise export cannot load gaussian splat "${layer.name}" without a URL or file`);
      }
      nativeSplats.set(request.sceneKey, request);
    }

    if (needsSceneRenderer || modelAssets.size > 0) {
      const resolution = this.deps.renderTargetManager?.getResolution() ?? { width: 1, height: 1 };
      const resolutionKey = `${resolution.width}x${resolution.height}`;
      if (!this.exportReadySceneRendererResolutions.has(resolutionKey)) {
        const initialized = await this.ensureSceneRendererInitialized(resolution.width, resolution.height);
        if (!initialized) {
          throw new Error('Precise export could not initialize the shared scene renderer');
        }
        this.exportReadySceneRendererResolutions.add(resolutionKey);
      }
    }

    const readinessChecks = [
      ...[...nativeSplats.values()].map(async (request) => {
        if (this.exportReadyNativeSplatSceneKeys.has(request.sceneKey)) {
          return;
        }
        const ready = await this.ensureGaussianSplatSceneLoaded({
          sceneKey: request.sceneKey,
          clipId: request.clipId,
          url: request.url,
          fileName: request.fileName,
          file: request.file,
        });
        if (!ready) {
          throw new Error(`Native gaussian splat "${request.fileName}" was not ready in time`);
        }
        this.exportReadyNativeSplatSceneKeys.add(request.sceneKey);
      }),
      ...[...modelAssets.values()].map(async ({ url, fileName }) => {
        if (this.exportReadyModelUrls.has(url)) {
          return;
        }
        const ready = await this.preloadSceneModelAsset(url, fileName);
        if (!ready) {
          throw new Error(`3D model "${fileName}" was not ready in time`);
        }
        this.exportReadyModelUrls.add(url);
      }),
    ];

    if (readinessChecks.length === 0) {
      return;
    }

    const results = await Promise.allSettled(readinessChecks);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') {
      throw new Error(
        `Precise export asset wait failed: ${
          failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
        }`,
      );
    }
  }

  private collectVisibleExportLayers(
    layers: Layer[],
    depth = 0,
    result: Layer[] = [],
  ): Layer[] {
    if (depth >= MAX_EXPORT_LAYER_NESTING_DEPTH) {
      return result;
    }

    for (const layer of layers) {
      if (!layer || layer.visible === false || layer.opacity === 0) {
        continue;
      }

      result.push(layer);

      const nestedLayers = layer.source?.nestedComposition?.layers;
      if (Array.isArray(nestedLayers) && nestedLayers.length > 0) {
        this.collectVisibleExportLayers(nestedLayers, depth + 1, result);
      }
    }

    return result;
  }

  private async waitForGaussianSplatScene(
    sceneKey: string,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
    timeoutMs = 15000,
  ): Promise<boolean> {
    const startedAt = performance.now();

    while (this.splatLoadingClips.has(sceneKey)) {
      if (renderer.hasScene(sceneKey)) {
        return true;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        break;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }

    return renderer.hasScene(sceneKey);
  }

  private getTargetVideoTime(layer: Layer, video: HTMLVideoElement): number {
    return layer.source?.mediaTime ?? video.currentTime;
  }

  private getSafePreviewFallback(
    layer: Layer,
    video: HTMLVideoElement
  ): { view: GPUTextureView; width: number; height: number; mediaTime?: number } | null {
    const scrubbingCache = this.deps.cacheManager.getScrubbingCache();
    if (!scrubbingCache) {
      return null;
    }
    const isDragging = useTimelineStore.getState().isDraggingPlayhead;
    const tolerance = video.seeking || isDragging ? 0.35 : 0.2;
    return scrubbingCache.getLastFrameNearTime(
      video,
      this.getTargetVideoTime(layer, video),
      tolerance,
      layer.sourceClipId
    );
  }

  private isFrameNearTarget(
    frame: { mediaTime?: number } | null | undefined,
    targetTime: number,
    maxDeltaSeconds: number = 0.35
  ): boolean {
    return (
      typeof frame?.mediaTime === 'number' &&
      Number.isFinite(frame.mediaTime) &&
      Math.abs(frame.mediaTime - targetTime) <= maxDeltaSeconds
    );
  }

  private toMediaTimeMs(time?: number): number | undefined {
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      return undefined;
    }
    return Math.round(time * 1000);
  }

  private getPreviewFallbackFromLayers(
    layers: Layer[]
  ): { clipId?: string; targetTimeMs?: number } {
    const primary =
      layers.find((layer) => layer?.visible && layer.opacity !== 0 && layer.source?.type === 'video') ??
      layers.find((layer) => layer?.visible && layer.opacity !== 0 && !!layer.source);

    return {
      clipId: primary?.sourceClipId ?? primary?.id,
      targetTimeMs: this.toMediaTimeMs(primary?.source?.mediaTime),
    };
  }

  private shouldHoldLastFrameOnEmptyPlayback(targetTimeMs?: number): boolean {
    if (!this.lastRenderHadContent) {
      return false;
    }

    if (
      typeof targetTimeMs === 'number' &&
      typeof this.lastPreviewTargetTimeMs === 'number' &&
      Math.abs(targetTimeMs - this.lastPreviewTargetTimeMs) >= 250
    ) {
      return false;
    }

    return true;
  }

  private recordMainPreviewFrame(
    mode: string,
    layerData?: LayerRenderData[],
    fallback?: { clipId?: string; targetTimeMs?: number; displayedTimeMs?: number }
  ): void {
    const primary = layerData?.find((data) => data.layer.source?.type === 'video') ?? layerData?.[0];
    const clipId = fallback?.clipId ?? primary?.layer.sourceClipId ?? primary?.layer.id;
    const targetTimeMs =
      fallback?.targetTimeMs ??
      this.toMediaTimeMs(primary?.targetMediaTime);
    const displayedTimeMs =
      fallback?.displayedTimeMs ??
      this.toMediaTimeMs(primary?.displayedMediaTime ?? primary?.targetMediaTime);
    const previewPath =
      primary?.previewPath ??
      primary?.layer.source?.type ??
      mode;
    const signature = layerData && layerData.length > 0
      ? layerData
        .slice(0, 4)
        .map((data) => {
          const id = data.layer.sourceClipId ?? data.layer.id;
          const mediaTimeMs = this.toMediaTimeMs(data.displayedMediaTime ?? data.targetMediaTime) ?? -1;
          return `${id}:${data.previewPath ?? data.layer.source?.type ?? 'layer'}:${mediaTimeMs}`;
        })
        .join('|')
      : `${mode}:${clipId ?? 'none'}:${displayedTimeMs ?? -1}`;
    const changed = signature !== this.lastPreviewSignature;
    const targetMoved =
      targetTimeMs !== undefined &&
      this.lastPreviewTargetTimeMs !== undefined &&
      Math.abs(targetTimeMs - this.lastPreviewTargetTimeMs) >= 12;
    const driftMs =
      targetTimeMs !== undefined && displayedTimeMs !== undefined
        ? Math.abs(targetTimeMs - displayedTimeMs)
        : undefined;

    vfPipelineMonitor.record('vf_preview_frame', {
      mode,
      changed: changed ? 'true' : 'false',
      targetMoved: targetMoved ? 'true' : 'false',
      previewPath,
      ...(clipId ? { clipId } : {}),
      ...(targetTimeMs !== undefined ? { targetTimeMs } : {}),
      ...(displayedTimeMs !== undefined ? { displayedTimeMs } : {}),
      ...(driftMs !== undefined ? { driftMs } : {}),
    });

    this.lastPreviewSignature = signature;
    this.lastPreviewTargetTimeMs = targetTimeMs;
  }

  // === MAIN RENDER ===

  render(layers: Layer[]): void {
    const d = this.deps;
    if (d.isRecovering()) return;

    const device = d.getDevice();
    if (!device || !d.compositorPipeline || !d.outputPipeline || !d.sampler) return;
    if (!d.renderTargetManager || !d.layerCollector || !d.compositor || !d.textureManager) return;

    const pingView = d.renderTargetManager.getPingView();
    const pongView = d.renderTargetManager.getPongView();
    if (!pingView || !pongView) return;

    // Clear frame-scoped caches (external texture bind groups)
    d.compositorPipeline.beginFrame();

    const t0 = performance.now();
    const { width, height } = d.renderTargetManager.getResolution();
    const skipEffects = false;

    // Collect layer data
    const t1 = performance.now();
    const layerData = d.layerCollector.collect(layers, {
      textureManager: d.textureManager!,
      scrubbingCache: d.cacheManager.getScrubbingCache(),
      getLastVideoTime: (key) => d.cacheManager.getLastVideoTime(key),
      setLastVideoTime: (key, time) => d.cacheManager.setLastVideoTime(key, time),
      isExporting: d.exportCanvasManager.getIsExporting(),
      isPlaying: d.renderLoop?.getIsPlaying() ?? false,
    });
    const importTime = performance.now() - t1;
    const debugSnapshot: RenderDispatcherDebugSnapshot = {
      inputLayers: layers.length,
      collectedLayerData: layerData.length,
      after3DLayerData: layerData.length,
      gaussianCandidates: layerData.filter((data) => this.isNativeGaussianSplatSource(data.layer.source)).length,
      gaussianRendered: 0,
      gaussianPendingLoad: 0,
      gaussianMissingUrl: 0,
      gaussianNoTextureView: 0,
      finalLayerData: layerData.length,
    };
    this.lastRenderDebugSnapshot = debugSnapshot;
    const sceneRenderDebugPayload = {
      input: layers.map((layer) => layer ? {
        id: layer.id,
        sourceClipId: layer.sourceClipId,
        sourceType: layer.source?.type,
        hasGaussianSplatUrl: !!layer.source?.gaussianSplatUrl,
        is3D: layer.is3D === true,
        visible: layer.visible !== false,
        opacity: layer.opacity,
      } : null),
      collected: layerData.map((data) => ({
        id: data.layer.id,
        sourceClipId: data.layer.sourceClipId,
        sourceType: data.layer.source?.type,
        hasGaussianSplatUrl: !!data.layer.source?.gaussianSplatUrl,
        is3D: data.layer.is3D === true,
        hasTextureView: !!data.textureView,
      })),
    };
    const sceneRenderDebugKey = JSON.stringify(sceneRenderDebugPayload);
    if (sceneRenderDebugKey !== this.lastSceneRenderDebugKey) {
      this.lastSceneRenderDebugKey = sceneRenderDebugKey;
      log.debug('Shared scene render input changed', sceneRenderDebugPayload);
    }

    // Update stats
    d.performanceStats.setDecoder(d.layerCollector.getDecoder());
    d.performanceStats.setWebCodecsInfo(d.layerCollector.getWebCodecsInfo());
    d.renderLoop?.setHasActiveVideo(d.layerCollector.hasActiveVideo());

    // Handle empty layers
    if (layerData.length === 0) {
      const previewFallback = this.getPreviewFallbackFromLayers(layers);
      // During playback, if we just had content, hold the last frame on screen
      // instead of flashing black. This handles transient decoder stalls on
      // Windows/Linux where readyState drops briefly.
      const isPlaying = d.renderLoop?.getIsPlaying() ?? false;
      if (isPlaying && this.shouldHoldLastFrameOnEmptyPlayback(previewFallback.targetTimeMs)) {
        // Don't render anything — canvas retains previous frame automatically.
        // Log once so the stall is visible in telemetry.
        log.debug('Holding last frame during playback stall (empty layerData)');
        d.performanceStats.setLayerCount(0);
        return;
      }
      this.lastRenderHadContent = false;
      this.renderEmptyFrame(device);
      this.recordMainPreviewFrame('empty', undefined, previewFallback);
      d.performanceStats.setLayerCount(0);
      return;
    }
    this.lastRenderHadContent = true;

    // === Shared 3D Scene Pass ===
    if (flags.use3DLayers) {
      this.process3DLayers(layerData, device, width, height);
    }
    debugSnapshot.after3DLayerData = layerData.length;

    const commandBuffers: GPUCommandBuffer[] = [];
    debugSnapshot.finalLayerData = layerData.length;

    // Pre-render nested compositions (batched with main composite)
    let hasNestedComps = false;

    const preRenderEncoder = device.createCommandEncoder();
    for (const data of layerData) {
      if (data.layer.source?.nestedComposition) {
        hasNestedComps = true;
        const nc = data.layer.source.nestedComposition;
        const view = d.nestedCompRenderer!.preRender(
          nc.compositionId,
          nc.layers,
          nc.width,
          nc.height,
          preRenderEncoder,
          d.sampler,
          nc.currentTime,
          nc.sceneClips,
          nc.sceneTracks,
          0,
          skipEffects,
        );
        if (view) data.textureView = view;
      }
    }
    if (hasNestedComps) {
      commandBuffers.push(preRenderEncoder.finish());
    }

    // Composite
    const t2 = performance.now();

    // Get effect temp textures for pre-processing effects on source layers
    const effectTempTexture = d.renderTargetManager.getEffectTempTexture() ?? undefined;
    const effectTempView = d.renderTargetManager.getEffectTempView() ?? undefined;
    const effectTempTexture2 = d.renderTargetManager.getEffectTempTexture2() ?? undefined;
    const effectTempView2 = d.renderTargetManager.getEffectTempView2() ?? undefined;

    const commandEncoder = device.createCommandEncoder();
    const result = d.compositor.composite(layerData, commandEncoder, {
      device, sampler: d.sampler, pingView, pongView, outputWidth: width, outputHeight: height,
      skipEffects,
      effectTempTexture, effectTempView, effectTempTexture2, effectTempView2,
    });
    const renderTime = performance.now() - t2;

    // Output
    d.outputPipeline!.updateResolution(width, height);

    const skipCanvas = d.exportCanvasManager.shouldSkipPreviewOutput();
    if (!skipCanvas) {
      // Output to main preview canvas (legacy — no grid)
      if (d.previewContext) {
        const mainBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler, result.finalView, 'normal');
        d.outputPipeline!.renderToCanvas(commandEncoder, d.previewContext, mainBindGroup);
        this.recordMainPreviewFrame('composite', layerData);
      }
      // Output to all activeComp render targets (from unified store)
      const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
      const sliceState = useSliceStore.getState();
      const sliceConfigs = sliceState.configs;
      for (const target of activeTargets) {
        const ctx = d.targetCanvases.get(target.id)?.context;
        if (!ctx) continue;

        // For the OM preview canvas, use the previewed target's slices (if in output mode)
        let sliceLookupId = target.id;
        if (target.id === '__om_preview__' && sliceState.previewingTargetId) {
          if (sliceState.activeTab === 'output') {
            sliceLookupId = sliceState.previewingTargetId;
          }
        }

        const config = sliceConfigs.get(sliceLookupId);
        const enabledSlices = config?.slices.filter((s) => s.enabled) ?? [];

        if (enabledSlices.length > 0 && d.slicePipeline) {
          d.slicePipeline.buildVertexBuffer(enabledSlices);
          d.slicePipeline.renderSlicedOutput(commandEncoder, ctx, result.finalView, d.sampler!);
        } else {
          const targetBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler, result.finalView, target.showTransparencyGrid ? 'grid' : 'normal');
          d.outputPipeline!.renderToCanvas(commandEncoder, ctx, targetBindGroup);
        }
      }
      if (!d.previewContext && activeTargets.length > 0) {
        this.recordMainPreviewFrame('target-composite', layerData);
      }
    }

    // Render to export canvas for zero-copy VideoFrame creation (never show grid)
    const exportCtx = d.exportCanvasManager.getExportCanvasContext();
    if (d.exportCanvasManager.getIsExporting() && exportCtx) {
      const exportMode = d.exportCanvasManager.isStackedAlpha() ? 'stackedAlpha' as const : 'normal' as const;
      const exportBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler, result.finalView, exportMode);
      d.outputPipeline!.renderToCanvas(commandEncoder, exportCtx, exportBindGroup);
    }

    // Batch submit all command buffers in single call
    commandBuffers.push(commandEncoder.finish());
    const t3 = performance.now();
    try {
      device.queue.submit(commandBuffers);
    } catch (e) {
      // GPU submit failed - likely device lost or validation error
      log.error('GPU submit failed', e);
      return;
    }
    const submitTime = performance.now() - t3;

    // Cleanup after submit
    if (hasNestedComps) {
      d.nestedCompRenderer!.cleanupPendingTextures();
    }

    // Stats
    const totalTime = performance.now() - t0;
    d.performanceStats.recordRenderTiming({
      importTexture: importTime,
      createBindGroup: 0,
      renderPass: renderTime,
      submit: submitTime,
      total: totalTime,
    });
    d.performanceStats.setLayerCount(result.layerCount);
    d.performanceStats.updateStats();
    reportRenderTime(totalTime);
  }

  /**
   * Process 3D layers through the shared scene renderer and replace them
   * with a single synthetic LayerRenderData entry.
   */
  private process3DLayers(layerData: LayerRenderData[], device: GPUDevice, width: number, height: number): void {
    const indices3D: number[] = [];
    for (let i = 0; i < layerData.length; i++) {
      const source = layerData[i].layer.source;
      if (!layerData[i].layer.is3D || source?.type === 'gaussian-avatar') {
        continue;
      }
      indices3D.push(i);
    }
    if (indices3D.length === 0) return;
    const d = this.deps;
    const renderer = d.sceneRenderer;
    const isRealtimePlayback = (this.deps.renderLoop?.getIsPlaying() ?? false)
      && !this.deps.exportCanvasManager.getIsExporting();
    const preciseSplatSorting = this.deps.exportCanvasManager.getIsExporting();

    if (!renderer || !renderer.isInitialized) {
      // Lazy init happens async — on the first frame with 3D layers,
      // we trigger init and skip the 3D pass. Next frames will render.
      if (!this.sceneRendererInitializing && !renderer?.isInitialized) {
        this.sceneRendererInitializing = true;
        import('../native3d/NativeSceneRenderer').then(({ getNativeSceneRenderer }) => {
          const r = getNativeSceneRenderer();
          r.initialize(width, height).then((ok) => {
            if (ok) {
              d.sceneRenderer = r;
              log.info('Shared scene renderer initialized lazily');
            }
            this.sceneRendererInitializing = false;
          });
        });
      }
      // Remove 3D layers from layerData so the old 2D shader doesn't render them
      // with its fake perspective distortion while the shared scene renderer is loading.
      for (let i = indices3D.length - 1; i >= 0; i--) {
        layerData.splice(indices3D[i], 1);
      }
      return;
    }

    const includedLayers = new Set(indices3D.map((index) => layerData[index]));
    const layers3D = collectScene3DLayers(layerData, {
      width,
      height,
      preciseVideoSampling: !isRealtimePlayback,
      preciseSplatSorting,
      includeLayer: (data) => includedLayers.has(data),
    });

    const camera = resolveRenderableSharedSceneCamera(
      { width, height },
      this.getEffectiveTimelineTime(),
    );
    const activeSplatEffectors = this.collectActiveSplatEffectors(width, height);
    const renderLayers3D = layers3D.map((layer) => {
      if (layer.kind !== 'splat' || layer.gaussianSplatIsSequence !== true) {
        return layer;
      }
      const previewMaxSplats = preciseSplatSorting ? undefined : this.getSplatSequencePreviewMaxSplats(layer);
      if (!previewMaxSplats) {
        return layer;
      }
      return {
        ...layer,
        gaussianSplatRuntimeKey: this.getGaussianSplatSequenceRuntimeKey(
          layer.gaussianSplatRuntimeKey,
          previewMaxSplats,
        ),
        gaussianSplatSettings: {
          ...(layer.gaussianSplatSettings ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS),
          render: {
            ...(layer.gaussianSplatSettings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render),
            maxSplats: previewMaxSplats,
          },
        },
      };
    });
    const nativeSplatLayers = renderLayers3D.filter((layer): layer is SceneSplatLayer =>
      layer.kind === 'splat',
    );
    const nativeRenderer = getGaussianSplatGpuRenderer();
    const timelineState = useTimelineStore.getState();
    const engineState = useEngineStore.getState();
    const isDraggingPlayhead = timelineState.isDraggingPlayhead;
    const primarySelectedClipId = timelineState.primarySelectedClipId && timelineState.selectedClipIds.has(timelineState.primarySelectedClipId)
      ? timelineState.primarySelectedClipId
      : timelineState.selectedClipIds.values().next().value as string | undefined;
    const sceneGizmo = primarySelectedClipId &&
      timelineState.isExporting !== true &&
      timelineState.isPlaying !== true &&
      renderLayers3D.some((layer) => layer.clipId === primarySelectedClipId)
      ? {
          clipId: primarySelectedClipId,
          mode: engineState.sceneGizmoMode,
          hoveredAxis: engineState.sceneGizmoHoveredAxis,
        }
      : null;
    for (const layer of nativeSplatLayers) {
      const previewMaxSplats = preciseSplatSorting ? undefined : this.getSplatSequencePreviewMaxSplats(layer);
      const sceneKey = this.getNativeGaussianSplatSceneKey(layer.clipId, layer.gaussianSplatRuntimeKey);
      const canHoldSequenceFrame = layer.gaussianSplatIsSequence === true && this.lastSharedSplatSequenceFrame !== null;
      if (!nativeRenderer.hasScene(sceneKey) && !this.splatLoadingClips.has(sceneKey)) {
        const canDeferDragLoad =
          layer.gaussianSplatIsSequence === true &&
          isDraggingPlayhead &&
          !isRealtimePlayback &&
          canHoldSequenceFrame;
        if (!canDeferDragLoad) {
          const request = {
            sceneKey,
            clipId: layer.clipId,
            url: layer.gaussianSplatUrl,
            fileName: layer.gaussianSplatFileName ?? layer.layerId,
            file: layer.gaussianSplatFile,
            showProgress: layer.gaussianSplatIsSequence === true && previewMaxSplats ? false : undefined,
            maxSplats: previewMaxSplats,
          };
          if (layer.gaussianSplatIsSequence === true && canHoldSequenceFrame) {
            this.scheduleBackgroundGaussianSplatSequenceLoad(request, true);
          } else {
            void this.ensureGaussianSplatSceneLoaded(request);
          }
        }
      }
      if (!preciseSplatSorting) {
        this.preloadNearbyGaussianSplatSequenceFrames(
          layer,
          nativeRenderer,
          isRealtimePlayback,
          isDraggingPlayhead,
          previewMaxSplats,
        );
        this.pruneGaussianSplatSequencePreviewScenes(layer, nativeRenderer, previewMaxSplats);
      }
    }

    const sequenceTargetLayer = nativeSplatLayers.find((layer) => layer.gaussianSplatIsSequence === true);
    const sequenceTargetSceneKey = sequenceTargetLayer
      ? this.getNativeGaussianSplatSceneKey(sequenceTargetLayer.clipId, sequenceTargetLayer.gaussianSplatRuntimeKey)
      : undefined;
    const sequenceRenderedSceneKey = sequenceTargetSceneKey && nativeRenderer.hasScene(sequenceTargetSceneKey)
      ? sequenceTargetSceneKey
      : undefined;

    let textureView = renderer.renderScene(
      device,
      renderLayers3D,
      camera,
      activeSplatEffectors,
      isRealtimePlayback,
      sceneGizmo,
    );
    const hasSplatSequence = nativeSplatLayers.some((layer) => layer.gaussianSplatIsSequence === true);
    if (textureView && hasSplatSequence) {
      this.lastSharedSplatSequenceFrame = {
        textureView,
        sceneKey: sequenceRenderedSceneKey ?? sequenceTargetSceneKey ?? '',
        width,
        height,
      };
    }
    if (!textureView) {
      const canHoldLastSplatSequenceFrame =
        hasSplatSequence &&
        this.lastSharedSplatSequenceFrame !== null &&
        this.lastSharedSplatSequenceFrame.width === width &&
        this.lastSharedSplatSequenceFrame.height === height;
      if (canHoldLastSplatSequenceFrame) {
        textureView = this.lastSharedSplatSequenceFrame!.textureView;
        this.setSplatSequenceDebugSnapshot({
          targetSceneKey: sequenceTargetSceneKey,
          renderedSceneKey: this.lastSharedSplatSequenceFrame!.sceneKey || undefined,
          mode: 'held',
          visualFrameChangesLastSecond: this.recordSplatSequenceVisualFrame(
            this.lastSharedSplatSequenceFrame!.sceneKey || undefined,
            false,
          ),
          backgroundLoads: this.backgroundSplatSequenceLoads.size,
        });
      } else {
        if (!hasSplatSequence) {
          this.lastSharedSplatSequenceFrame = null;
        }
        if (hasSplatSequence) {
          this.setSplatSequenceDebugSnapshot({
            targetSceneKey: sequenceTargetSceneKey,
            renderedSceneKey: undefined,
            mode: 'missing',
            visualFrameChangesLastSecond: this.recordSplatSequenceVisualFrame(undefined, false),
            backgroundLoads: this.backgroundSplatSequenceLoads.size,
          });
        }
        for (let i = indices3D.length - 1; i >= 0; i--) {
          layerData.splice(indices3D[i], 1);
        }
        return;
      }
    } else if (hasSplatSequence) {
      this.setSplatSequenceDebugSnapshot({
        targetSceneKey: sequenceTargetSceneKey,
        renderedSceneKey: sequenceRenderedSceneKey,
        mode: 'target',
        visualFrameChangesLastSecond: this.recordSplatSequenceVisualFrame(sequenceRenderedSceneKey, true),
        backgroundLoads: this.backgroundSplatSequenceLoads.size,
      });
    }

    if (!textureView) {
      for (let i = indices3D.length - 1; i >= 0; i--) {
        layerData.splice(indices3D[i], 1);
      }
      return;
    }

    // Create a synthetic layer for the 3D scene
    // For a single 3D layer, pass its opacity/blendMode to the compositor directly.
    // For multiple, the shared scene renderer handles per-layer opacity internally.
    const insertIdx = indices3D[0];
    const firstLayer = layerData[indices3D[0]].layer;
    const isSingle3D = indices3D.length === 1;
    const syntheticLayer: Layer = {
      id: '__scene_3d__',
      name: '3D Scene',
      visible: true,
      opacity: isSingle3D ? firstLayer.opacity : 1,
      blendMode: isSingle3D ? firstLayer.blendMode : 'normal',
      source: { type: 'image' },
      effects: isSingle3D ? firstLayer.effects : [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    const syntheticData: LayerRenderData = {
      layer: syntheticLayer,
      isVideo: false,
      externalTexture: null,
      textureView,
      sourceWidth: width,
      sourceHeight: height,
    };

    // Remove 3D layers (in reverse to keep indices valid) and insert synthetic
    for (let i = indices3D.length - 1; i >= 0; i--) {
      layerData.splice(indices3D[i], 1);
    }
    layerData.splice(insertIdx, 0, syntheticData);
  }

  /**
   * Process Gaussian Splat avatar layers: grab the renderer's canvas,
   * import as GPU texture, replace with synthetic layer.
   * Unlike the old frame-on-demand shared-scene path, the Gaussian renderer runs its own rAF loop —
   * we simply capture the latest frame each compositor cycle.
   */
  private processGaussianLayers(layerData: LayerRenderData[], device: GPUDevice, width: number, height: number): void {
    void layerData;
    void device;
    void width;
    void height;
    return;
    /*
    // Find gaussian-avatar layers
    const indices: number[] = [];
    for (let i = 0; i < layerData.length; i++) {
      if (layerData[i].layer.source?.type === 'gaussian-avatar') {
        indices.push(i);
      }
    }
    if (indices.length === 0) return;

    const d = this.deps;
    const renderer = d.gaussianSplatRenderer;

    // Capture avatar URL before any async work (layerData may be mutated)
    const firstLayerData = layerData[indices[0]];
    const avatarUrl = firstLayerData.layer.source?.gaussianAvatarUrl;

    if (!renderer || !renderer.isInitialized) {
      // Lazy init — trigger on first frame with gaussian layers
      if (!this.gaussianInitializing) {
        this.gaussianInitializing = true;
        // Capture URL now — layerData will be stale by the time the promise resolves
        const capturedAvatarUrl = avatarUrl;
        import('../gaussian/GaussianSplatSceneRenderer').then(({ getGaussianSplatSceneRenderer }) => {
          const r = getGaussianSplatSceneRenderer();
          r.initialize().then((ok) => {
            if (ok) {
              d.gaussianSplatRenderer = r;
              if (capturedAvatarUrl) {
                r.loadAvatar(capturedAvatarUrl);
              }
              log.info('Gaussian Splat renderer initialized lazily');
            }
            this.gaussianInitializing = false;
          });
        });
      }
      // Remove gaussian layers while loading
      for (let i = indices.length - 1; i >= 0; i--) {
        layerData.splice(indices[i], 1);
      }
      return;
    }

    // Ensure avatar is loaded for the current layer (guard against concurrent loads)
    if (avatarUrl && !renderer.isAvatarLoaded && !renderer.isLoading) {
      renderer.loadAvatar(avatarUrl);
      // Remove layers while loading
      for (let i = indices.length - 1; i >= 0; i--) {
        layerData.splice(indices[i], 1);
      }
      return;
    }

    // Still loading — skip rendering but don't call loadAvatar again
    if (renderer.isLoading || !renderer.isAvatarLoaded) {
      for (let i = indices.length - 1; i >= 0; i--) {
        layerData.splice(indices[i], 1);
      }
      return;
    }

    // Update blendshapes from layer source
    const blendshapes = firstLayerData.layer.source?.gaussianBlendshapes;
    if (blendshapes) {
      renderer.setBlendshapes(blendshapes);
    }

    // Resize renderer to match compositor resolution
    renderer.resize(width, height);

    // Get the renderer's canvas (already rendered by its own rAF loop)
    const canvas = renderer.getCanvas();
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      // Canvas not ready yet — remove layers
      for (let i = indices.length - 1; i >= 0; i--) {
        layerData.splice(indices[i], 1);
      }
      return;
    }

    // Create/resize GPU texture
    if (!this.gaussianTexture || this.gaussianTexture.width !== width || this.gaussianTexture.height !== height) {
      this.gaussianTexture?.destroy();
      this.gaussianTexture = device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.gaussianTextureView = this.gaussianTexture.createView();
    }

    // Copy canvas to GPU texture — guard against canvas without rendering context
    try {
      device.queue.copyExternalImageToTexture(
        { source: canvas },
        { texture: this.gaussianTexture },
        { width, height },
      );
      this.gaussianErrorLogged = false; // reset on success
    } catch (err) {
      if (!this.gaussianErrorLogged) {
        log.error('Gaussian canvas copy failed (logging once)', err);
        this.gaussianErrorLogged = true;
      }
      // Remove gaussian layers — canvas is not usable
      for (let i = indices.length - 1; i >= 0; i--) {
        layerData.splice(indices[i], 1);
      }
      return;
    }

    // Create synthetic layer for the bridged renderer output.
    const insertIdx = indices[0];
    const firstLayer = layerData[indices[0]].layer;
    const isSingle = indices.length === 1;

    const syntheticLayer: Layer = {
      id: '__gaussian_splat__',
      name: 'Gaussian Avatar',
      visible: true,
      opacity: isSingle ? firstLayer.opacity : 1,
      blendMode: isSingle ? firstLayer.blendMode : 'normal',
      source: { type: 'image' },
      effects: isSingle ? firstLayer.effects : [],
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    };

    const syntheticData: LayerRenderData = {
      layer: syntheticLayer,
      isVideo: false,
      externalTexture: null,
      textureView: this.gaussianTextureView,
      sourceWidth: width,
      sourceHeight: height,
    };

    // Remove gaussian layers (reverse order) and insert synthetic
    for (let i = indices.length - 1; i >= 0; i--) {
      layerData.splice(indices[i], 1);
    }
    layerData.splice(insertIdx, 0, syntheticData);
    */
  }

  /**
   * Process gaussian-splat layers (native WebGPU path).
   * Each layer is rendered individually into its own texture — NO merging.
   * The original layer object is preserved for compositor semantics.
   */
  private processGaussianSplatLayers(
    layerData: LayerRenderData[],
    device: GPUDevice,
    width: number,
    height: number,
  ): {
    gaussianCandidates: number;
    rendered: number;
    pendingLoad: number;
    missingUrl: number;
    noTextureView: number;
  } {
    let gaussianCandidates = 0;
    for (let i = 0; i < layerData.length; i++) {
      if (this.isNativeGaussianSplatSource(layerData[i].layer.source)) {
        gaussianCandidates++;
      }
    }
    const summary = {
      gaussianCandidates,
      rendered: 0,
      pendingLoad: 0,
      missingUrl: 0,
      noTextureView: 0,
    };
    if (gaussianCandidates === 0) return summary;

    // Get or lazy-init the native WebGPU renderer
    const renderer = getGaussianSplatGpuRenderer();
    if (!renderer.isInitialized) {
      renderer.initialize(device);
    }
    renderer.beginFrame();
    const isRealtimePlayback = (this.deps.renderLoop?.getIsPlaying() ?? false)
      && !this.deps.exportCanvasManager.getIsExporting();
    const preciseSplatSorting = this.deps.exportCanvasManager.getIsExporting();
    const activeSplatEffectors = this.collectActiveSplatEffectors(width, height);
    const sceneCamera = resolveRenderableSharedSceneCamera(
      { width, height },
      this.getEffectiveTimelineTime(),
    );
    const sceneSplatLayers = new Map(
      collectScene3DLayers(layerData, {
        width,
        height,
        preciseSplatSorting,
        includeLayer: (candidate) => this.isNativeGaussianSplatSource(candidate.layer.source),
      })
        .filter((layer) => layer.kind === 'splat')
        .map((layer) => [layer.layerId, layer] as const),
    );

    // Process each gaussian-splat layer individually (reverse iteration for safe splice)
    for (let i = layerData.length - 1; i >= 0; i--) {
      const data = layerData[i];
      const source = data.layer.source;
      if (source?.type !== 'gaussian-splat' || !this.isNativeGaussianSplatSource(source)) continue;

      const clipId = data.layer.sourceClipId || data.layer.id;
      const sceneKey = this.getNativeGaussianSplatSceneKey(clipId, source.gaussianSplatRuntimeKey);
      const splatUrl = source.gaussianSplatUrl;
      const settings = source.gaussianSplatSettings;
      const renderSettings = settings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
      const liveSortFrequency = isRealtimePlayback
        ? (renderSettings.sortFrequency === 0
          ? 0
          : Math.max(renderSettings.sortFrequency, GAUSSIAN_PLAYBACK_SORT_FREQUENCY))
        : renderSettings.sortFrequency;
      const sceneLayer = sceneSplatLayers.get(data.layer.id);

      // No URL — remove layer
      if (!splatUrl) {
        summary.missingUrl++;
        layerData.splice(i, 1);
        continue;
      }

      if (!sceneLayer) {
        summary.noTextureView++;
        layerData.splice(i, 1);
        continue;
      }

      // Upload scene if not cached — trigger async load, skip this frame
      if (!renderer.hasScene(sceneKey)) {
        this.loadAndUploadSplatScene({
          sceneKey,
          clipId,
          url: splatUrl,
          fileName: source.gaussianSplatFileName ?? data.layer.name,
          file: source.file,
        }, renderer);
        summary.pendingLoad++;
        layerData.splice(i, 1);
        continue;
      }

      // Render this splat layer as a shared-scene object with its own world transform.
      const gaussianCommandEncoder = device.createCommandEncoder();
      const textureView = renderer.renderToTexture(
        sceneKey, sceneCamera, { width, height }, gaussianCommandEncoder,
        {
          clipLocalTime: source.mediaTime,
          backgroundColor: renderSettings.backgroundColor,
          effectors: sceneLayer.threeDEffectorsEnabled === false ? [] : activeSplatEffectors,
          worldMatrix: sceneLayer.worldMatrix,
          maxSplats: renderSettings.maxSplats,
          particleSettings: settings?.particle,
          precise: preciseSplatSorting,
          sortFrequency: liveSortFrequency,
          temporalSettings: settings?.temporal,
        },
      );
      device.queue.submit([gaussianCommandEncoder.finish()]);

      if (textureView) {
        summary.rendered++;
        const compositeLayer = {
          ...data.layer,
          position: { x: 0, y: 0, z: 0 },
          scale: {
            x: 1,
            y: 1,
            ...(data.layer.scale.z !== undefined ? { z: 1 } : {}),
          },
          rotation: typeof data.layer.rotation === 'number'
            ? 0
            : { x: 0, y: 0, z: 0 },
        };
        // In-place replacement — keep the SAME layer (preserving opacity, blend, masks, effects)
        layerData[i] = {
          layer: compositeLayer,
          isVideo: false,
          externalTexture: null,
          textureView,
          sourceWidth: width,
          sourceHeight: height,
        };
      } else {
        summary.noTextureView++;
        layerData.splice(i, 1);
      }
    }

    return summary;
  }

  private setGaussianSplatLoadProgress(
    request: GaussianSplatSceneLoadRequest,
    progress: {
      phase: GaussianSplatLoadPhase;
      percent?: number;
      loadedBytes?: number;
      totalBytes?: number;
      message?: string;
    },
  ): void {
    if (request.showProgress === false) {
      return;
    }

    useEngineStore.getState().setGaussianSplatLoadProgress({
      sceneKey: request.sceneKey,
      clipId: request.clipId,
      fileName: request.file?.name || request.fileName || 'splat.ply',
      ...progress,
    });
  }

  private clearGaussianSplatLoadProgressSoon(sceneKey: string, delayMs: number): void {
    globalThis.setTimeout(() => {
      useEngineStore.getState().clearGaussianSplatLoadProgress(sceneKey);
    }, delayMs);
  }

  private mapGaussianAssetLoadProgress(
    progress: GaussianSplatLoadProgress,
    startPercent: number,
    endPercent: number,
  ): number {
    const bytePercent = progress.totalBytes && progress.totalBytes > 0
      ? (progress.loadedBytes ?? 0) / progress.totalBytes
      : 0;
    const rawPercent = clampUnitInterval(progress.percent ?? bytePercent);
    return startPercent + (endPercent - startPercent) * rawPercent;
  }

  private async fetchGaussianSplatFile(request: GaussianSplatSceneLoadRequest): Promise<File> {
    if (!request.url) {
      throw new Error('Cannot fetch gaussian splat without a URL.');
    }

    this.setGaussianSplatLoadProgress(request, {
      phase: 'fetching',
      percent: 0.02,
      loadedBytes: 0,
      message: 'Fetching splat file',
    });

    const response = await fetch(request.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch gaussian splat: ${response.status} ${response.statusText}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const parsedTotalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
    const totalBytes = Number.isFinite(parsedTotalBytes) && parsedTotalBytes > 0
      ? parsedTotalBytes
      : undefined;

    if (!response.body) {
      const arrayBuffer = await response.arrayBuffer();
      this.setGaussianSplatLoadProgress(request, {
        phase: 'fetching',
        percent: 0.35,
        loadedBytes: arrayBuffer.byteLength,
        totalBytes: totalBytes ?? arrayBuffer.byteLength,
        message: 'Fetched splat file',
      });
      return new File([arrayBuffer], request.fileName || 'splat.ply');
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      chunks.push(value.slice());
      loadedBytes += value.byteLength;
      const rawPercent = totalBytes
        ? loadedBytes / totalBytes
        : Math.min(0.95, loadedBytes / (64 * 1024 * 1024));

      this.setGaussianSplatLoadProgress(request, {
        phase: 'fetching',
        percent: 0.02 + clampUnitInterval(rawPercent) * 0.33,
        loadedBytes,
        totalBytes,
        message: 'Fetching splat file',
      });
    }

    this.setGaussianSplatLoadProgress(request, {
      phase: 'fetching',
      percent: 0.35,
      loadedBytes,
      totalBytes: totalBytes ?? loadedBytes,
      message: 'Fetched splat file',
    });

    return new File(chunks, request.fileName || 'splat.ply');
  }

  /** Async helper: fetch splat file, parse, and upload to GPU renderer */
  private async loadAndUploadSplatScene(
    request: GaussianSplatSceneLoadRequest,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
  ): Promise<void> {
    if (this.splatLoadingClips.has(request.sceneKey)) return;
    this.splatLoadingClips.add(request.sceneKey);

    try {
      let file = request.file;
      let loadStartPercent = 0.02;
      if (!file) {
        if (!request.url) {
          return;
        }
        file = await this.fetchGaussianSplatFile(request);
        loadStartPercent = 0.35;
      } else {
        this.setGaussianSplatLoadProgress(request, {
          phase: 'reading',
          percent: loadStartPercent,
          loadedBytes: 0,
          totalBytes: file.size,
          message: 'Reading splat file',
        });
      }

      const loadFile = file;
      const asset = await loadGaussianSplatAssetCached(request.sceneKey, loadFile, undefined, {
        maxSplats: request.maxSplats,
        onProgress: (progress) => {
          this.setGaussianSplatLoadProgress(request, {
            phase: progress.phase,
            percent: this.mapGaussianAssetLoadProgress(progress, loadStartPercent, 0.9),
            loadedBytes: progress.loadedBytes,
            totalBytes: progress.totalBytes ?? loadFile.size,
            message: progress.message,
          });
        },
      });

      if (asset?.frames[0]?.buffer) {
        if (asset.metadata?.boundingBox) {
          this.splatSceneBounds.set(request.sceneKey, asset.metadata.boundingBox);
          if (request.clipId && request.clipId !== request.sceneKey) {
            this.splatSceneBounds.set(request.clipId, asset.metadata.boundingBox);
          }
        }
        this.setGaussianSplatLoadProgress(request, {
          phase: 'uploading',
          percent: 0.94,
          loadedBytes: loadFile.size,
          totalBytes: loadFile.size,
          message: 'Uploading splat scene',
        });
        renderer.uploadScene(request.sceneKey, {
          splatCount: asset.frames[0].buffer.splatCount,
          data: asset.frames[0].buffer.data,
        });
        this.setGaussianSplatLoadProgress(request, {
          phase: 'complete',
          percent: 1,
          loadedBytes: loadFile.size,
          totalBytes: loadFile.size,
          message: 'Splat scene loaded',
        });
        this.clearGaussianSplatLoadProgressSoon(request.sceneKey, 350);
        log.info('Gaussian splat scene uploaded', {
          clipId: request.clipId ?? request.sceneKey,
          sceneKey: request.sceneKey,
          splatCount: asset.frames[0].buffer.splatCount,
        });
        this.deps.renderLoop?.requestRender();
      }
    } catch (err) {
      log.error('Failed to load gaussian splat scene', {
        clipId: request.clipId ?? request.sceneKey,
        sceneKey: request.sceneKey,
        err,
      });
      this.setGaussianSplatLoadProgress(request, {
        phase: 'error',
        percent: 1,
        message: err instanceof Error ? err.message : 'Failed to load gaussian splat scene',
      });
      this.clearGaussianSplatLoadProgressSoon(request.sceneKey, 1500);
    } finally {
      this.splatLoadingClips.delete(request.sceneKey);
    }
  }

  getGaussianSplatSceneBounds(clipId: string): { min: [number, number, number]; max: [number, number, number] } | undefined {
    return this.splatSceneBounds.get(clipId);
  }

  renderEmptyFrame(device: GPUDevice): void {
    const d = this.deps;
    const commandEncoder = device.createCommandEncoder();
    const pingView = d.renderTargetManager?.getPingView();

    // Use output pipeline to render empty frame (allows shader to generate checkerboard)
    if (pingView && d.outputPipeline && d.sampler) {
      // Clear ping texture to transparent
      const clearPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: pingView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      clearPass.end();

      const { width, height } = d.renderTargetManager!.getResolution();
      d.outputPipeline.updateResolution(width, height);

      // Render through output pipeline to main preview (no grid) + all activeComp targets
      if (d.previewContext) {
        const mainBindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, pingView, 'normal');
        d.outputPipeline.renderToCanvas(commandEncoder, d.previewContext, mainBindGroup);
        this.recordMainPreviewFrame('empty');
      }
      const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
      for (const target of activeTargets) {
        const ctx = d.targetCanvases.get(target.id)?.context;
        if (!ctx) continue;
        const targetBindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, pingView, target.showTransparencyGrid ? 'grid' : 'normal');
        d.outputPipeline.renderToCanvas(commandEncoder, ctx, targetBindGroup);
      }
    } else {
      // Fallback: direct clear
      if (d.previewContext) {
        try {
          const pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
              view: d.previewContext.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: 'clear',
              storeOp: 'store',
            }],
          });
          pass.end();
        } catch {
          // Canvas context lost - skip
        }
      }
    }
    // Also clear export canvas when exporting (needed for empty frames at export boundaries)
    const emptyExportCtx = d.exportCanvasManager.getExportCanvasContext();
    if (d.exportCanvasManager.getIsExporting() && emptyExportCtx) {
      try {
        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [{
            view: emptyExportCtx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.end();
      } catch {
        // Export canvas context lost - skip
      }
    }
    device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Render specific layers to a specific target canvas
   * Used for multi-composition preview where each preview shows different content
   */
  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void {
    const d = this.deps;
    if (d.isRecovering()) return;

    const device = d.getDevice();
    const canvasContext = d.targetCanvases.get(canvasId)?.context;
    if (!device || !canvasContext || !d.compositorPipeline || !d.outputPipeline || !d.sampler) return;

    const indPingView = d.renderTargetManager?.getIndependentPingView();
    const indPongView = d.renderTargetManager?.getIndependentPongView();
    if (!indPingView || !indPongView) return;

    // Prepare layer data
    const layerData: LayerRenderData[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer?.visible || !layer.source || layer.opacity === 0) continue;

      if (layer.source.videoElement) {
        const video = layer.source.videoElement;
        const htmlPreviewDebugDisabled =
          flags.useFullWebCodecsPlayback &&
          flags.disableHtmlPreviewFallback;
        if (htmlPreviewDebugDisabled) {
          continue;
        }
        const scrubbingCache = d.cacheManager.getScrubbingCache();
        const targetTime = this.getTargetVideoTime(layer, video);
        const isDragging = useTimelineStore.getState().isDraggingPlayhead;
        const isSettling = scrubSettleState.isPending(layer.sourceClipId);
        const isPausedSettle = !(d.renderLoop?.getIsPlaying() ?? false) && !isDragging && isSettling;
        const lastPresentedTime = scrubbingCache?.getLastPresentedTime(video);
        const lastPresentedOwner = scrubbingCache?.getLastPresentedOwner(video);
        const hasPresentedOwnerMismatch =
          !!layer.sourceClipId &&
          !!lastPresentedOwner &&
          lastPresentedOwner !== layer.sourceClipId;
        const hasConfirmedPresentedFrame =
          !hasPresentedOwnerMismatch &&
          typeof lastPresentedTime === 'number' &&
          Number.isFinite(lastPresentedTime);
        const displayedTime = hasConfirmedPresentedFrame ? lastPresentedTime : undefined;
        const isPlaybackActive = (d.renderLoop?.getIsPlaying() ?? false) && !video.paused;
        const reportedDisplayedTime =
          isPlaybackActive &&
          !video.seeking &&
          Number.isFinite(video.currentTime)
            ? video.currentTime
            : displayedTime;
        const hasFreshPresentedFrame =
          hasConfirmedPresentedFrame &&
          Math.abs(lastPresentedTime - targetTime) <= 0.12;
        const presentedDriftSeconds = hasConfirmedPresentedFrame
          ? Math.abs(lastPresentedTime - targetTime)
          : undefined;
        const awaitingPausedTargetFrame =
          hasPresentedOwnerMismatch ||
          !(d.renderLoop?.getIsPlaying() ?? false) &&
          !isDragging &&
          (!isSettling &&
            (!hasConfirmedPresentedFrame || Math.abs(lastPresentedTime - targetTime) > 0.05));
        const cacheSearchDistanceFrames = isDragging ? 12 : 6;
        const lastSameClipFrame = layer.sourceClipId
          ? scrubbingCache?.getLastFrame(video, layer.sourceClipId) ?? null
          : null;
        const dragHoldFrame = isDragging
          ? this.isFrameNearTarget(
            lastSameClipFrame,
            targetTime,
            RenderDispatcher.MAX_DRAG_FALLBACK_DRIFT_SECONDS
          )
            ? lastSameClipFrame
            : null
          : (isSettling || awaitingPausedTargetFrame) && this.isFrameNearTarget(lastSameClipFrame, targetTime)
            ? lastSameClipFrame
            : null;
        const emergencyHoldFrame = dragHoldFrame;
        const sameClipHoldFrame =
          !(d.renderLoop?.getIsPlaying() ?? false) &&
          (isDragging || isSettling || awaitingPausedTargetFrame || video.seeking)
            ? lastSameClipFrame
            : null;
        const safeFallback = this.getSafePreviewFallback(layer, video) ?? dragHoldFrame;
        const allowDragLiveVideoImport =
          !video.seeking &&
          (
            !hasConfirmedPresentedFrame ||
            (presentedDriftSeconds ?? 0) <= RenderDispatcher.MAX_DRAG_LIVE_IMPORT_DRIFT_SECONDS
          );
        const allowLiveVideoImport = !hasPresentedOwnerMismatch && (isPausedSettle
          ? hasFreshPresentedFrame
          : !awaitingPausedTargetFrame &&
            (((!isDragging && !isSettling) || hasFreshPresentedFrame || (isDragging ? allowDragLiveVideoImport : !safeFallback))));
        const allowConfirmedFrameCaching = !hasPresentedOwnerMismatch && (isPausedSettle
          ? hasFreshPresentedFrame
          : !awaitingPausedTargetFrame &&
            (((!isDragging && !isSettling) || hasFreshPresentedFrame)));
        const captureOwnerId = allowConfirmedFrameCaching ? layer.sourceClipId : undefined;
        if (video.readyState >= 2) {
          if ((video.seeking || awaitingPausedTargetFrame) && scrubbingCache) {
            const cachedView =
              scrubbingCache.getCachedFrame(video.src, targetTime) ??
              scrubbingCache.getNearestCachedFrame(video.src, targetTime, cacheSearchDistanceFrames);
            if (cachedView) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: cachedView,
                sourceWidth: video.videoWidth,
                sourceHeight: video.videoHeight,
              });
              continue;
            }
            if (!allowLiveVideoImport && safeFallback) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: safeFallback.view,
                sourceWidth: safeFallback.width,
                sourceHeight: safeFallback.height,
              });
              continue;
            }
            if (!allowLiveVideoImport && emergencyHoldFrame) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: emergencyHoldFrame.view,
                sourceWidth: emergencyHoldFrame.width,
                sourceHeight: emergencyHoldFrame.height,
              });
              continue;
            }
            if (!allowLiveVideoImport && sameClipHoldFrame) {
              layerData.push({
                layer,
                isVideo: false,
                externalTexture: null,
                textureView: sameClipHoldFrame.view,
                sourceWidth: sameClipHoldFrame.width,
                sourceHeight: sameClipHoldFrame.height,
                displayedMediaTime: sameClipHoldFrame.mediaTime,
                targetMediaTime: targetTime,
                previewPath: 'same-clip-hold',
              });
              continue;
            }
          }

          const copiedFrame = getCopiedHtmlVideoPreviewFrame(
            video,
            scrubbingCache,
            targetTime,
            layer.sourceClipId,
            captureOwnerId
          );
          if (allowLiveVideoImport && copiedFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: copiedFrame.view,
              sourceWidth: copiedFrame.width,
              sourceHeight: copiedFrame.height,
              displayedMediaTime: copiedFrame.mediaTime ?? reportedDisplayedTime,
              targetMediaTime: targetTime,
              previewPath: 'copied-preview',
            });
            continue;
          }

          const extTex = allowLiveVideoImport
            ? d.textureManager?.importVideoTexture(video)
            : null;
          if (extTex) {
            if (scrubbingCache && allowConfirmedFrameCaching && !(d.renderLoop?.getIsPlaying() ?? false)) {
              const now = performance.now();
              const lastCapture = scrubbingCache.getLastCaptureTime(video);
              if (now - lastCapture > 50) {
                scrubbingCache.captureVideoFrame(video, captureOwnerId);
                scrubbingCache.setLastCaptureTime(video, now);
              }
              scrubbingCache.cacheFrameAtTime(video, targetTime);
            } else if (scrubbingCache && !(d.renderLoop?.getIsPlaying() ?? false)) {
              if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                scrubbingCache.captureVideoFrameIfCloser(
                  video,
                  targetTime,
                  displayedTime,
                  layer.sourceClipId
                );
              }
              if (typeof displayedTime === 'number' && Number.isFinite(displayedTime)) {
                scrubbingCache.cacheFrameAtTime(video, displayedTime);
              }
            }
            layerData.push({
              layer,
              isVideo: true,
              externalTexture: extTex,
              textureView: null,
              sourceWidth: video.videoWidth,
              sourceHeight: video.videoHeight,
              displayedMediaTime: reportedDisplayedTime,
              targetMediaTime: targetTime,
              previewPath: 'live-import',
            });
            continue;
          }

          const notReadyCachedFrame =
            scrubbingCache?.getCachedFrameEntry(video.src, targetTime) ??
            scrubbingCache?.getNearestCachedFrameEntry(video.src, targetTime, cacheSearchDistanceFrames);
          if (notReadyCachedFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: notReadyCachedFrame.view,
              sourceWidth: video.videoWidth,
              sourceHeight: video.videoHeight,
              displayedMediaTime: notReadyCachedFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'not-ready-scrub-cache',
            });
            continue;
          }

          if (safeFallback) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: safeFallback.view,
              sourceWidth: safeFallback.width,
              sourceHeight: safeFallback.height,
              displayedMediaTime: safeFallback.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'final-cache',
            });
            continue;
          }
          if (emergencyHoldFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: emergencyHoldFrame.view,
              sourceWidth: emergencyHoldFrame.width,
              sourceHeight: emergencyHoldFrame.height,
              displayedMediaTime: emergencyHoldFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'emergency-hold',
            });
            continue;
          }
          if (sameClipHoldFrame) {
            layerData.push({
              layer,
              isVideo: false,
              externalTexture: null,
              textureView: sameClipHoldFrame.view,
              sourceWidth: sameClipHoldFrame.width,
              sourceHeight: sameClipHoldFrame.height,
              displayedMediaTime: sameClipHoldFrame.mediaTime,
              targetMediaTime: targetTime,
              previewPath: 'same-clip-hold',
            });
            continue;
          }
        }
      }
      if (layer.source.imageElement) {
        const img = layer.source.imageElement;
        let texture = d.textureManager?.getCachedImageTexture(img);
        if (!texture) texture = d.textureManager?.createImageTexture(img) ?? undefined;
        if (texture) {
          layerData.push({ layer, isVideo: false, externalTexture: null, textureView: d.textureManager!.getImageView(texture), sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight });
        }
      }
      if (layer.source.textCanvas) {
        const canvas = layer.source.textCanvas;
        const texture = d.textureManager?.createCanvasTexture(canvas);
        if (texture) {
          layerData.push({ layer, isVideo: false, externalTexture: null, textureView: d.textureManager!.getImageView(texture), sourceWidth: canvas.width, sourceHeight: canvas.height });
        }
      }
    }

    const { width, height } = d.renderTargetManager!.getResolution();

    // Read per-target transparency flag
    const target = useRenderTargetStore.getState().targets.get(canvasId);
    const showGrid = target?.showTransparencyGrid ?? false;

    // Ensure resolution is up to date for this render
    d.outputPipeline.updateResolution(width, height);

    if (layerData.length === 0) {
      const commandEncoder = device.createCommandEncoder();
      const blackTex = d.renderTargetManager!.getBlackTexture();
      if (blackTex) {
        const blackView = blackTex.createView();
        const blackBindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, blackView, showGrid ? 'grid' : 'normal');
        d.outputPipeline.renderToCanvas(commandEncoder, canvasContext, blackBindGroup);
        this.recordMainPreviewFrame('target-empty');
      }
      device.queue.submit([commandEncoder.finish()]);
      return;
    }

    const commandEncoder = device.createCommandEncoder();

    // Ping-pong compositing using independent buffers
    let readView = indPingView;
    let writeView = indPongView;
    let usePing = true;

    const clearPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: readView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    clearPass.end();

    for (const data of layerData) {
      const layer = data.layer;
      const uniformBuffer = d.compositorPipeline!.getOrCreateUniformBuffer(layer.id);
      const sourceAspect = data.sourceWidth / data.sourceHeight;
      const outputAspect = width / height;
      const maskLookupId = layer.maskClipId || layer.id;
      // Get mask info
      const maskManager = d.maskTextureManager!;
      const maskInfo = maskManager.getMaskInfo(maskLookupId) ?? { hasMask: false, view: maskManager.getWhiteMaskView() };
      const hasMask = maskInfo.hasMask;
      const maskTextureView = maskInfo.view;

      d.compositorPipeline!.updateLayerUniforms(layer, sourceAspect, outputAspect, hasMask, uniformBuffer);

      let pipeline: GPURenderPipeline;
      let bindGroup: GPUBindGroup;

      if (data.isVideo && data.externalTexture) {
        pipeline = d.compositorPipeline!.getExternalCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createExternalCompositeBindGroup(d.sampler!, readView, data.externalTexture, uniformBuffer, maskTextureView);
      } else if (data.textureView) {
        pipeline = d.compositorPipeline!.getCompositePipeline()!;
        bindGroup = d.compositorPipeline!.createCompositeBindGroup(d.sampler!, readView, data.textureView, uniformBuffer, maskTextureView);
      } else {
        continue;
      }

      const compositePass = commandEncoder.beginRenderPass({
        colorAttachments: [{ view: writeView, loadOp: 'clear', storeOp: 'store' }],
      });
      compositePass.setPipeline(pipeline);
      compositePass.setBindGroup(0, bindGroup);
      compositePass.draw(6);
      compositePass.end();

      [readView, writeView] = [writeView, readView];
      usePing = !usePing;
    }

    const outputBindGroup = d.outputPipeline!.createOutputBindGroup(d.sampler!, readView, showGrid ? 'grid' : 'normal');
    d.outputPipeline!.renderToCanvas(commandEncoder, canvasContext, outputBindGroup);
    this.recordMainPreviewFrame('target-canvas', layerData);

    device.queue.submit([commandEncoder.finish()]);
  }

  renderCachedFrame(time: number): boolean {
    const d = this.deps;
    const device = d.getDevice();
    const scrubbingCache = d.cacheManager.getScrubbingCache();
    if (!d.previewContext || !device || !scrubbingCache || !d.outputPipeline || !d.sampler) {
      return false;
    }

    const gpuCached = scrubbingCache.getGpuCachedFrame(time);
    if (gpuCached) {
      const commandEncoder = device.createCommandEncoder();
      d.outputPipeline.renderToCanvas(commandEncoder, d.previewContext, gpuCached.bindGroup);
      this.recordMainPreviewFrame('ram-gpu-cache', undefined, {
        targetTimeMs: Math.round(time * 1000),
        displayedTimeMs: Math.round(time * 1000),
      });
      // Output to all activeComp targets
      const activeTargets = useRenderTargetStore.getState().getActiveCompTargets();
      for (const target of activeTargets) {
        const ctx = d.targetCanvases.get(target.id)?.context;
        if (ctx) d.outputPipeline.renderToCanvas(commandEncoder, ctx, gpuCached.bindGroup);
      }
      device.queue.submit([commandEncoder.finish()]);
      return true;
    }

    const imageData = scrubbingCache.getCachedCompositeFrame(time);
    if (!imageData) {
      return false;
    }
    try {
      const { width, height } = { width: imageData.width, height: imageData.height };

      let canvas = d.cacheManager.getRamPlaybackCanvas();
      let ctx = d.cacheManager.getRamPlaybackCtx();

      if (!canvas || !ctx) {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) return false;
        d.cacheManager.setRamPlaybackCanvas(canvas, ctx);
      } else if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.putImageData(imageData, 0, 0);

      const texture = device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });

      device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [width, height]);

      const view = texture.createView();
      const bindGroup = d.outputPipeline.createOutputBindGroup(d.sampler, view);

      scrubbingCache.addToGpuCache(time, { texture, view, bindGroup });

      const commandEncoder = device.createCommandEncoder();
      d.outputPipeline.renderToCanvas(commandEncoder, d.previewContext, bindGroup);
      this.recordMainPreviewFrame('ram-cpu-cache', undefined, {
        targetTimeMs: Math.round(time * 1000),
        displayedTimeMs: Math.round(time * 1000),
      });
      // Output to all activeComp targets
      const cachedActiveTargets = useRenderTargetStore.getState().getActiveCompTargets();
      for (const target of cachedActiveTargets) {
        const ctx = d.targetCanvases.get(target.id)?.context;
        if (ctx) d.outputPipeline.renderToCanvas(commandEncoder, ctx, bindGroup);
      }
      device.queue.submit([commandEncoder.finish()]);
      return true;
    } catch (e) {
      log.warn('Failed to render cached frame', e);
      return false;
    }
  }
}
