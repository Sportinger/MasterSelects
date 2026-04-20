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
import { useEngineStore } from '../../stores/engineStore';
import { useTimelineStore } from '../../stores/timeline';
import { reportRenderTime } from '../../services/performanceMonitor';
import { Logger } from '../../services/logger';
import { scrubSettleState } from '../../services/scrubSettleState';
import { vfPipelineMonitor } from '../../services/vfPipelineMonitor';
import { getCopiedHtmlVideoPreviewFrame } from './htmlVideoPreviewFallback';
import { flags } from '../featureFlags';
import type { ThreeSceneRenderer } from '../three/ThreeSceneRenderer';
import type { Layer3DData, CameraConfig, SplatEffectorRuntimeData } from '../three/types';
import { DEFAULT_CAMERA_CONFIG } from '../three/types';
import { useMediaStore, DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore';
import { getGaussianSplatGpuRenderer } from '../gaussian/core/GaussianSplatGpuRenderer';
import { buildSplatCamera, resolveOrbitCameraPose } from '../gaussian/core/SplatCameraUtils';
import { loadGaussianSplatAssetCached } from '../gaussian/loaders';
import { DEFAULT_GAUSSIAN_SPLAT_SETTINGS } from '../gaussian/types';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import {
  getPreparedSplatRuntimeSync,
  waitForBasePreparedSplatRuntime,
  waitForTargetPreparedSplatRuntime,
} from '../three/splatRuntimeCache';

const log = Logger.create('RenderDispatcher');
const GAUSSIAN_PLAYBACK_SORT_FREQUENCY = 6;
const MAX_EXPORT_LAYER_NESTING_DEPTH = 8;

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
  threeSceneRenderer?: ThreeSceneRenderer | null;
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
  // 3D scene rendering state
  private threeSceneTexture: GPUTexture | null = null;
  private threeSceneView: GPUTextureView | null = null;
  private threeSceneInitializing = false;
  private threeSceneImportCanvas: HTMLCanvasElement | null = null;
  // Native Gaussian Splat rendering state (new WebGPU path)
  private splatLoadingClips = new Set<string>();
  private splatSceneBounds = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();
  private exportReadyThreeSceneResolutions = new Set<string>();
  private exportReadyNativeSplatKeys = new Set<string>();
  private exportReadyThreeSplatKeys = new Set<string>();
  private exportReadyModelUrls = new Set<string>();
  private lastThreeSceneDebugKey = '';

  constructor(deps: RenderDeps) {
    this.deps = deps;
    // Legacy gaussian-avatar code stays on disk for migration/reference only.
    void this.processGaussianLayers;
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

  private resolveStable3DSourceDimensions(
    data: LayerRenderData,
    width: number,
    height: number,
  ): { sourceWidth: number; sourceHeight: number } {
    const fallbackWidth =
      typeof data.sourceWidth === 'number' && Number.isFinite(data.sourceWidth) && data.sourceWidth > 0
        ? data.sourceWidth
        : width;
    const fallbackHeight =
      typeof data.sourceHeight === 'number' && Number.isFinite(data.sourceHeight) && data.sourceHeight > 0
        ? data.sourceHeight
        : height;

    const intrinsicWidth = data.layer.source?.intrinsicWidth;
    const intrinsicHeight = data.layer.source?.intrinsicHeight;

    return {
      sourceWidth:
        typeof intrinsicWidth === 'number' && Number.isFinite(intrinsicWidth) && intrinsicWidth > 0
          ? intrinsicWidth
          : fallbackWidth,
      sourceHeight:
        typeof intrinsicHeight === 'number' && Number.isFinite(intrinsicHeight) && intrinsicHeight > 0
          ? intrinsicHeight
          : fallbackHeight,
    };
  }

  private isNativeGaussianSplatSource(source: Layer['source'] | undefined): boolean {
    if (source?.type !== 'gaussian-splat') return false;
    return (
      source.gaussianSplatSettings?.render.useNativeRenderer ??
      DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render.useNativeRenderer
    ) === true;
  }

  private getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
    const worldHeight = 2.0;
    const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
    return worldHeight / (2 * Math.tan(fovRadians * 0.5));
  }

  private resolveSharedSceneCameraConfig(
    _layers3D: Layer3DData[],
    width: number,
    height: number,
  ): CameraConfig {
    const timelineStore = useTimelineStore.getState();
    const timelineTime = this.getEffectiveTimelineTime();
    const buildCameraConfigFromClip = (
      cameraClip: (typeof timelineStore.clips)[number],
    ): CameraConfig | null => {
      if (cameraClip.source?.type !== 'camera') {
        return null;
      }

      const clipLocalTime = timelineTime - cameraClip.startTime;
      const transform = timelineStore.getInterpolatedTransform(cameraClip.id, clipLocalTime);
      const cameraSettings = cameraClip.source.cameraSettings ?? DEFAULT_SCENE_CAMERA_SETTINGS;
      const defaultDistance = this.getSharedSceneDefaultCameraDistance(cameraSettings.fov);
      const pose = resolveOrbitCameraPose(
        {
          position: transform.position,
          scale: transform.scale,
          rotation: transform.rotation,
        },
        {
          nearPlane: cameraSettings.near,
          farPlane: cameraSettings.far,
          fov: cameraSettings.fov,
          minimumDistance: defaultDistance,
        },
        { width, height },
      );

      return {
        position: pose.eye,
        target: pose.target,
        up: pose.up,
        fov: pose.fovDegrees,
        near: pose.near,
        far: pose.far,
        applyDefaultDistance: false,
      };
    };

    const navClipId = useEngineStore.getState().gaussianSplatNavClipId;
    const navCameraClip = navClipId
      ? timelineStore.clips.find((clip) => clip.id === navClipId && clip.source?.type === 'camera')
      : undefined;
    const navCameraConfig = navCameraClip ? buildCameraConfigFromClip(navCameraClip) : null;
    if (navCameraConfig) {
      return navCameraConfig;
    }

    const videoTracks = timelineStore.tracks.filter(
      (track) => track.type === 'video' && track.visible !== false,
    );
    const activeCameraTrack = [...videoTracks].reverse().find((track) =>
      timelineStore.clips.some((clip) =>
        clip.trackId === track.id &&
        clip.source?.type === 'camera' &&
        timelineTime >= clip.startTime &&
        timelineTime < clip.startTime + clip.duration,
      ),
    );

    if (activeCameraTrack) {
      const activeCameraClip = timelineStore.clips.find((clip) =>
        clip.trackId === activeCameraTrack.id &&
        clip.source?.type === 'camera' &&
        timelineTime >= clip.startTime &&
        timelineTime < clip.startTime + clip.duration,
      );

      if (activeCameraClip?.source?.type === 'camera') {
        const activeCameraConfig = buildCameraConfigFromClip(activeCameraClip);
        if (activeCameraConfig) {
          return activeCameraConfig;
        }
      }
    }

    const activeComp = useMediaStore.getState().getActiveComposition();
    if (activeComp?.camera?.enabled) {
      return {
        ...DEFAULT_CAMERA_CONFIG,
        ...activeComp.camera,
        applyDefaultDistance: true,
      };
    }

    return { ...DEFAULT_CAMERA_CONFIG };
  }

  private collectActiveSplatEffectors(width: number, height: number): SplatEffectorRuntimeData[] {
    const timelineStore = useTimelineStore.getState();
    const playhead = this.getEffectiveTimelineTime();
    const worldHeight = 2.0;
    const halfWorldW = (worldHeight * (width / Math.max(height, 1))) / 2;
    const halfWorldH = worldHeight / 2;
    const visibleTrackIds = new Set(
      timelineStore.tracks
        .filter((track) => track.type === 'video' && track.visible !== false)
        .map((track) => track.id),
    );

    return timelineStore.clips
      .filter((clip) => {
        if (clip.source?.type !== 'splat-effector') return false;
        if (!visibleTrackIds.has(clip.trackId)) return false;
        return playhead >= clip.startTime && playhead < clip.startTime + clip.duration;
      })
      .map((clip) => {
        const clipLocalTime = playhead - clip.startTime;
        const transform = timelineStore.getInterpolatedTransform(clip.id, clipLocalTime);
        const settings = clip.source?.splatEffectorSettings ?? DEFAULT_SPLAT_EFFECTOR_SETTINGS;
        const scaleZ = transform.scale.z ?? 1;
        const scaleX = Math.abs(transform.scale.x);
        const scaleY = Math.abs(transform.scale.y);
        const scaleZAbs = Math.abs(scaleZ);

        return {
          clipId: clip.id,
          position: {
            x: transform.position.x * halfWorldW,
            y: -transform.position.y * halfWorldH,
            z: transform.position.z,
          },
          rotation: {
            x: transform.rotation.x,
            y: transform.rotation.y,
            z: transform.rotation.z,
          },
          scale: {
            x: scaleX,
            y: scaleY,
            z: scaleZAbs,
          },
          radius: Math.max(scaleX, scaleY, scaleZAbs, 0.0001),
          mode: settings.mode,
          strength: settings.strength,
          falloff: settings.falloff,
          speed: settings.speed,
          seed: settings.seed,
          time: clipLocalTime,
        };
      });
  }

  async ensureGaussianSplatSceneLoaded(
    clipId: string,
    url: string | undefined,
    fileName: string,
  ): Promise<boolean> {
    if (!url) return false;

    const device = this.deps.getDevice();
    if (!device) return false;

    const renderer = getGaussianSplatGpuRenderer();
    if (!renderer.isInitialized) {
      renderer.initialize(device);
    }

    if (renderer.hasScene(clipId)) {
      return true;
    }

    if (this.splatLoadingClips.has(clipId)) {
      return this.waitForGaussianSplatScene(clipId, renderer);
    }

    await this.loadAndUploadSplatScene(clipId, url, fileName, renderer);
    return renderer.hasScene(clipId);
  }

  async ensureThreeSceneRendererInitialized(width: number, height: number): Promise<boolean> {
    const { getThreeSceneRenderer } = await import('../three/ThreeSceneRenderer');
    const renderer = this.deps.threeSceneRenderer ?? getThreeSceneRenderer();
    const initialized = await renderer.initialize(width, height);
    if (initialized) {
      this.deps.threeSceneRenderer = renderer;
    }
    return initialized;
  }

  async preloadThreeModelAsset(url: string, fileName: string): Promise<boolean> {
    if (!url) return false;

    const existingRenderer = this.deps.threeSceneRenderer;
    let renderer = existingRenderer;
    if (!renderer?.isInitialized) {
      const resolution = this.deps.renderTargetManager?.getResolution() ?? { width: 1, height: 1 };
      const initialized = await this.ensureThreeSceneRendererInitialized(resolution.width, resolution.height);
      if (!initialized) {
        return false;
      }
      renderer = this.deps.threeSceneRenderer ?? null;
    }

    if (!renderer) {
      return false;
    }

    return renderer.preloadModel(url, fileName);
  }

  clearExportReadinessCache(): void {
    this.exportReadyThreeSceneResolutions.clear();
    this.exportReadyNativeSplatKeys.clear();
    this.exportReadyThreeSplatKeys.clear();
    this.exportReadyModelUrls.clear();
  }

  private describeExportReadinessError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  private isRecoverableThreeSplatExportError(error: unknown): boolean {
    const message = this.describeExportReadinessError(error).toLowerCase();
    return message.includes('array buffer allocation failed') || message.includes('out of memory');
  }

  private async ensureThreeSplatRuntimeReadyForExport(options: {
    cacheKey: string;
    fileHash?: string;
    file?: File;
    url?: string;
    fileName: string;
    gaussianSplatSequence?: NonNullable<Layer['source']>['gaussianSplatSequence'];
    preferBaseRuntime: boolean;
    requestedMaxSplats: number;
  }): Promise<void> {
    const {
      cacheKey,
      fileHash,
      file,
      url,
      fileName,
      gaussianSplatSequence,
      preferBaseRuntime,
      requestedMaxSplats,
    } = options;
    const variant = preferBaseRuntime ? 'base' : 'target';
    const threeSplatKey = `${cacheKey}|${variant}|${requestedMaxSplats}`;
    if (this.exportReadyThreeSplatKeys.has(threeSplatKey)) {
      return;
    }

    const sourceOptions = {
      cacheKey,
      fileHash,
      file,
      url,
      fileName,
      gaussianSplatSequence,
      requestedMaxSplats,
    };

    if (preferBaseRuntime) {
      await waitForBasePreparedSplatRuntime(sourceOptions);
      this.exportReadyThreeSplatKeys.add(threeSplatKey);
      return;
    }

    try {
      await waitForTargetPreparedSplatRuntime(sourceOptions);
      this.exportReadyThreeSplatKeys.add(threeSplatKey);
      return;
    } catch (targetError) {
      const cachedBaseRuntime = getPreparedSplatRuntimeSync({
        ...sourceOptions,
        variant: 'base',
      });
      if (cachedBaseRuntime) {
        log.warn('Precise export falling back to cached base Three.js splat runtime', {
          cacheKey,
          fileName,
          requestedMaxSplats,
          error: targetError,
        });
        this.exportReadyThreeSplatKeys.add(threeSplatKey);
        return;
      }

      if (!this.isRecoverableThreeSplatExportError(targetError)) {
        throw targetError;
      }

      try {
        await waitForBasePreparedSplatRuntime(sourceOptions);
      } catch (fallbackError) {
        throw new Error(
          `Three.js gaussian splat export fallback failed after target runtime error ` +
          `(${this.describeExportReadinessError(targetError)}). ` +
          `Fallback error: ${this.describeExportReadinessError(fallbackError)}`,
        );
      }

      log.warn('Precise export falling back to rebuilt base Three.js splat runtime', {
        cacheKey,
        fileName,
        requestedMaxSplats,
        error: targetError,
      });
      this.exportReadyThreeSplatKeys.add(threeSplatKey);
    }
  }

  async ensureExportLayersReady(layers: Layer[]): Promise<void> {
    const visibleLayers = this.collectVisibleExportLayers(layers);
    if (visibleLayers.length === 0) {
      return;
    }

    const nativeSplats = new Map<string, { clipId: string; url: string; fileName: string }>();
    const threeSplats = new Map<string, {
      cacheKey: string;
      fileHash?: string;
      file?: File;
      url?: string;
      fileName: string;
      gaussianSplatSequence?: NonNullable<Layer['source']>['gaussianSplatSequence'];
      preferBaseRuntime: boolean;
      requestedMaxSplats: number;
    }>();
    const modelAssets = new Map<string, { url: string; fileName: string }>();
    let needsThreeSceneRenderer = false;

    for (const layer of visibleLayers) {
      const source = layer.source;
      if (!source) {
        continue;
      }

      if (
        layer.is3D === true &&
        source.type !== 'camera' &&
        !(source.type === 'gaussian-splat' && this.isNativeGaussianSplatSource(source))
      ) {
        needsThreeSceneRenderer = true;
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
      const runtimeCacheKey =
        source.gaussianSplatRuntimeKey ??
        `${fileName || source.gaussianSplatUrl || layer.id}|${source.gaussianSplatUrl || layer.id}`;
      const cacheKey =
        preferBaseRuntime
          ? runtimeCacheKey
          : (fileHash ?? mediaFileId ?? runtimeCacheKey);

      if (this.isNativeGaussianSplatSource(source)) {
        if (!source.gaussianSplatUrl) {
          throw new Error(`Precise export cannot load native gaussian splat "${layer.name}" without a URL`);
        }
        nativeSplats.set(layer.id, {
          clipId: layer.sourceClipId ?? layer.id,
          url: source.gaussianSplatUrl,
          fileName,
        });
        continue;
      }

      if (!source.gaussianSplatUrl && !file) {
        throw new Error(`Precise export cannot prepare gaussian splat "${layer.name}" without a URL or file`);
      }

      threeSplats.set(`${cacheKey}|${requestedMaxSplats}`, {
        cacheKey,
        fileHash,
        file,
        url: source.gaussianSplatUrl,
        fileName,
        gaussianSplatSequence,
        preferBaseRuntime,
        requestedMaxSplats,
      });
    }

    if (needsThreeSceneRenderer || modelAssets.size > 0 || threeSplats.size > 0) {
      const resolution = this.deps.renderTargetManager?.getResolution() ?? { width: 1, height: 1 };
      const resolutionKey = `${resolution.width}x${resolution.height}`;
      if (!this.exportReadyThreeSceneResolutions.has(resolutionKey)) {
        const initialized = await this.ensureThreeSceneRendererInitialized(resolution.width, resolution.height);
        if (!initialized) {
          throw new Error('Precise export could not initialize the Three.js renderer');
        }
        this.exportReadyThreeSceneResolutions.add(resolutionKey);
      }
    }

    const readinessChecks = [
      ...[...nativeSplats.values()].map(async ({ clipId, url, fileName }) => {
        const nativeKey = `${clipId}|${url}`;
        if (this.exportReadyNativeSplatKeys.has(nativeKey)) {
          return;
        }
        const ready = await this.ensureGaussianSplatSceneLoaded(clipId, url, fileName);
        if (!ready) {
          throw new Error(`Native gaussian splat "${fileName}" was not ready in time`);
        }
        this.exportReadyNativeSplatKeys.add(nativeKey);
      }),
      ...[...modelAssets.values()].map(async ({ url, fileName }) => {
        if (this.exportReadyModelUrls.has(url)) {
          return;
        }
        const ready = await this.preloadThreeModelAsset(url, fileName);
        if (!ready) {
          throw new Error(`3D model "${fileName}" was not ready in time`);
        }
        this.exportReadyModelUrls.add(url);
      }),
      ...[...threeSplats.values()].map(async ({
        cacheKey,
        fileHash,
        file,
        url,
        fileName,
        gaussianSplatSequence,
        preferBaseRuntime,
        requestedMaxSplats,
      }) => {
        await this.ensureThreeSplatRuntimeReadyForExport({
          cacheKey,
          fileHash,
          file,
          url,
          fileName,
          gaussianSplatSequence,
          preferBaseRuntime,
          requestedMaxSplats,
        });
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
    clipId: string,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
    timeoutMs = 15000,
  ): Promise<boolean> {
    const startedAt = performance.now();

    while (this.splatLoadingClips.has(clipId)) {
      if (renderer.hasScene(clipId)) {
        return true;
      }
      if (performance.now() - startedAt >= timeoutMs) {
        break;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }

    return renderer.hasScene(clipId);
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
    const threeSceneDebugPayload = {
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
    const threeSceneDebugKey = JSON.stringify(threeSceneDebugPayload);
    if (threeSceneDebugKey !== this.lastThreeSceneDebugKey) {
      this.lastThreeSceneDebugKey = threeSceneDebugKey;
      log.warn('Three.js render input changed', threeSceneDebugPayload);
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

    // === 3D Layer Pass (Three.js) ===
    // If any layers have is3D=true and the feature flag is on,
    // render them via Three.js to an OffscreenCanvas, import as texture,
    // and replace individual 3D layers with a single synthetic layer.
    if (flags.use3DLayers) {
      this.process3DLayers(layerData, device, width, height);
    }
    debugSnapshot.after3DLayerData = layerData.length;

    const commandBuffers: GPUCommandBuffer[] = [];

    // === Native Gaussian Splat Pass (WebGPU) ===
    const gaussianSummary = this.processGaussianSplatLayers(layerData, device, width, height);
    debugSnapshot.gaussianCandidates = gaussianSummary.gaussianCandidates;
    debugSnapshot.gaussianRendered = gaussianSummary.rendered;
    debugSnapshot.gaussianPendingLoad = gaussianSummary.pendingLoad;
    debugSnapshot.gaussianMissingUrl = gaussianSummary.missingUrl;
    debugSnapshot.gaussianNoTextureView = gaussianSummary.noTextureView;
    debugSnapshot.finalLayerData = layerData.length;

    // Pre-render nested compositions (batched with main composite)
    let hasNestedComps = false;

    const preRenderEncoder = device.createCommandEncoder();
    for (const data of layerData) {
      if (data.layer.source?.nestedComposition) {
        hasNestedComps = true;
        const nc = data.layer.source.nestedComposition;
        const view = d.nestedCompRenderer!.preRender(
          nc.compositionId, nc.layers, nc.width, nc.height, preRenderEncoder, d.sampler, nc.currentTime, 0, skipEffects
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
   * Process 3D layers: render them via Three.js to a texture,
   * then replace individual 3D LayerRenderData entries with a single synthetic entry.
   */
  private process3DLayers(layerData: LayerRenderData[], device: GPUDevice, width: number, height: number): void {
    // Find 3D layers
    const indices3D: number[] = [];
    for (let i = 0; i < layerData.length; i++) {
      const source = layerData[i].layer.source;
      if (
        layerData[i].layer.is3D &&
        source?.type !== 'gaussian-avatar' &&
        (
          source?.type !== 'gaussian-splat' ||
          !this.isNativeGaussianSplatSource(source)
        )
      ) {
        indices3D.push(i);
      }
    }
    if (indices3D.length === 0) return;

    const d = this.deps;
    const renderer = d.threeSceneRenderer;
    if (!renderer || !renderer.isInitialized) {
      // Lazy init happens async — on the first frame with 3D layers,
      // we trigger init and skip the 3D pass. Next frames will render.
      if (!this.threeSceneInitializing && !renderer?.isInitialized) {
        this.threeSceneInitializing = true;
        import('../three/ThreeSceneRenderer').then(({ getThreeSceneRenderer }) => {
          const r = getThreeSceneRenderer();
          r.initialize(width, height).then((ok) => {
            if (ok) {
              d.threeSceneRenderer = r;
              log.info('Three.js 3D renderer initialized lazily');
            }
            this.threeSceneInitializing = false;
          });
        });
      }
      // Remove 3D layers from layerData so the old 2D shader doesn't render them
      // with its fake perspective distortion while Three.js is loading
      for (let i = indices3D.length - 1; i >= 0; i--) {
        layerData.splice(indices3D[i], 1);
      }
      return;
    }

    const isRealtimePlayback = (this.deps.renderLoop?.getIsPlaying() ?? false)
      && !this.deps.exportCanvasManager.getIsExporting();
    const preciseSplatSorting = this.deps.exportCanvasManager.getIsExporting();

    // Build Layer3DData from the 3D layers
    const layers3D: Layer3DData[] = [];
    for (const idx of indices3D) {
      const data = layerData[idx];
      const layer = data.layer;
      const src = layer.source;
      const stableSourceSize = this.resolveStable3DSourceDimensions(data, width, height);
      const rot = typeof layer.rotation === 'number'
        ? { x: 0, y: 0, z: layer.rotation }
        : layer.rotation;
      const radToDeg = 180 / Math.PI;

      layers3D.push({
        layerId: layer.id,
        clipId: layer.sourceClipId || layer.id,
        position: layer.position,
        // Render-layer rotations are stored in radians for the 2D compositor pipeline.
        // ThreeSceneRenderer expects degrees and converts to radians internally.
        rotation: {
          x: rot.x * radToDeg,
          y: rot.y * radToDeg,
          z: rot.z * radToDeg,
        },
        scale: { x: layer.scale.x, y: layer.scale.y, z: layer.scale.z ?? 1 },
        threeDEffectorsEnabled: src?.threeDEffectorsEnabled,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        sourceWidth: stableSourceSize.sourceWidth,
        sourceHeight: stableSourceSize.sourceHeight,
        videoElement: src?.videoElement ?? undefined,
        preciseVideoSampling: !isRealtimePlayback,
        imageElement: src?.imageElement ?? undefined,
        canvas: src?.textCanvas ?? undefined,
        modelUrl: src?.modelUrl ?? undefined,
        modelFileName: layer.name,  // Original filename for format detection
        meshType: src?.meshType ?? undefined,
        text3DProperties: src?.text3DProperties ?? undefined,
        wireframe: layer.wireframe,
        gaussianSplatFile: src?.file ?? undefined,
        gaussianSplatUrl: src?.gaussianSplatUrl ?? undefined,
        gaussianSplatFileName: src?.gaussianSplatFileName ?? undefined,
        gaussianSplatFileHash: src?.gaussianSplatFileHash ?? undefined,
        gaussianSplatRuntimeKey: src?.gaussianSplatRuntimeKey ?? undefined,
        gaussianSplatIsSequence: !!src?.gaussianSplatSequence,
        gaussianSplatSequence: src?.gaussianSplatSequence ?? undefined,
        gaussianSplatMediaFileId: src?.mediaFileId ?? undefined,
        gaussianSplatSettings: src?.gaussianSplatSettings ?? undefined,
        preciseSplatSorting,
      });
    }

    const cameraConfig = this.resolveSharedSceneCameraConfig(layers3D, width, height);
    const activeSplatEffectors = this.collectActiveSplatEffectors(width, height);

    // Render the 3D scene
    const canvas = renderer.renderScene(
      layers3D,
      cameraConfig,
      width,
      height,
      activeSplatEffectors,
      isRealtimePlayback,
    );
    if (!canvas) return;

    // Import the OffscreenCanvas as a GPU texture
    // Ensure we have a texture of the right size
    if (!this.threeSceneTexture || this.threeSceneTexture.width !== width || this.threeSceneTexture.height !== height) {
      this.threeSceneTexture?.destroy();
      this.threeSceneTexture = device.createTexture({
        size: { width, height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.threeSceneView = this.threeSceneTexture.createView();
    }

    let importSource: HTMLCanvasElement | OffscreenCanvas = canvas;
    if (canvas instanceof HTMLCanvasElement) {
      if (!this.threeSceneImportCanvas) {
        this.threeSceneImportCanvas = document.createElement('canvas');
      }
      if (
        this.threeSceneImportCanvas.width !== width ||
        this.threeSceneImportCanvas.height !== height
      ) {
        this.threeSceneImportCanvas.width = width;
        this.threeSceneImportCanvas.height = height;
      }
      const importCtx = this.threeSceneImportCanvas.getContext('2d');
      if (importCtx) {
        importCtx.clearRect(0, 0, width, height);
        importCtx.drawImage(canvas, 0, 0, width, height);
        importSource = this.threeSceneImportCanvas;
      }
    }

    // Copy Three.js canvas content to GPU texture
    device.queue.copyExternalImageToTexture(
      { source: importSource },
      { texture: this.threeSceneTexture },
      { width, height },
    );

    // Create a synthetic layer for the 3D scene
    // For a single 3D layer, pass its opacity/blendMode to the compositor directly.
    // For multiple, Three.js handles per-layer opacity internally; composite at 100%.
    const insertIdx = indices3D[0];
    const firstLayer = layerData[indices3D[0]].layer;
    const isSingle3D = indices3D.length === 1;
    const syntheticLayer: Layer = {
      id: '__three_scene__',
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
      textureView: this.threeSceneView,
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
   * Unlike Three.js (frame-on-demand), the Gaussian renderer runs its own rAF loop —
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

    // Create synthetic layer (same pattern as __three_scene__)
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

    // Process each gaussian-splat layer individually (reverse iteration for safe splice)
    for (let i = layerData.length - 1; i >= 0; i--) {
      const data = layerData[i];
      const source = data.layer.source;
      if (source?.type !== 'gaussian-splat' || !this.isNativeGaussianSplatSource(source)) continue;

      const clipId = data.layer.sourceClipId || data.layer.id;
      const splatUrl = source.gaussianSplatUrl;
      const settings = source.gaussianSplatSettings;
      const renderSettings = settings?.render ?? DEFAULT_GAUSSIAN_SPLAT_SETTINGS.render;
      const liveSortFrequency = isRealtimePlayback
        ? (renderSettings.sortFrequency === 0
          ? 0
          : Math.max(renderSettings.sortFrequency, GAUSSIAN_PLAYBACK_SORT_FREQUENCY))
        : renderSettings.sortFrequency;

      // No URL — remove layer
      if (!splatUrl) {
        summary.missingUrl++;
        layerData.splice(i, 1);
        continue;
      }

      // Upload scene if not cached — trigger async load, skip this frame
      if (!renderer.hasScene(clipId)) {
        this.loadAndUploadSplatScene(
          clipId,
          splatUrl,
          source.gaussianSplatFileName ?? data.layer.name,
          renderer,
        );
        summary.pendingLoad++;
        layerData.splice(i, 1);
        continue;
      }

      // Build camera from layer transform + render settings
      const camera = buildSplatCamera(
        data.layer,
        renderSettings,
        { width, height },
        this.splatSceneBounds.get(clipId),
      );

      // Render this single splat into its own texture
      // Wave 5: pass clip-local time and particle/temporal settings from layer source
      const gaussianCommandEncoder = device.createCommandEncoder();
      const textureView = renderer.renderToTexture(
        clipId, camera, { width, height }, gaussianCommandEncoder,
        {
          clipLocalTime: source.mediaTime,
          backgroundColor: renderSettings.backgroundColor,
          maxSplats: renderSettings.maxSplats,
          particleSettings: settings?.particle,
          precise: this.deps.exportCanvasManager.getIsExporting(),
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

  /** Async helper: fetch splat file, parse, and upload to GPU renderer */
  private async loadAndUploadSplatScene(
    clipId: string,
    url: string,
    fileName: string,
    renderer: ReturnType<typeof getGaussianSplatGpuRenderer>,
  ): Promise<void> {
    if (this.splatLoadingClips.has(clipId)) return;
    this.splatLoadingClips.add(clipId);

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const file = new File([arrayBuffer], fileName || 'splat.ply');
      const asset = await loadGaussianSplatAssetCached(clipId, file);

      if (asset?.frames[0]?.buffer) {
        if (asset.metadata?.boundingBox) {
          this.splatSceneBounds.set(clipId, asset.metadata.boundingBox);
        }
        renderer.uploadScene(clipId, {
          splatCount: asset.frames[0].buffer.splatCount,
          data: asset.frames[0].buffer.data,
        });
        log.info('Gaussian splat scene uploaded', { clipId, splatCount: asset.frames[0].buffer.splatCount });
        this.deps.renderLoop?.requestRender();
      }
    } catch (err) {
      log.error('Failed to load gaussian splat scene', { clipId, err });
    } finally {
      this.splatLoadingClips.delete(clipId);
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
