import type { DebugInfrastructureState } from '../../engine/engineCore/debugInfrastructureState';
import type { RenderDispatcherDebugSnapshot } from '../../engine/render/RenderDispatcher';
import type {
  ScrubbingCacheStats,
  WorkerFirstCacheRuntimeSnapshot,
} from '../../engine/texture/ScrubbingCache';
import type { EngineStats, Layer } from '../../types';
import type { RamPreviewRenderEngine } from '../ramPreviewEngine';
import type { RenderCapabilityProbeResult, RenderPresentationStrategy } from './renderCapabilityProbe';
import type { RenderHostSelectionTelemetry } from './renderHostSelection';

export type RendererMode = 'main' | 'worker-shadow' | 'worker-presenting' | 'worker-only' | 'worker-gpu-only';
export type RenderFrameCallback = () => void;

export interface RenderCaptureCanvas {
  canvas: HTMLCanvasElement;
  source: string;
}

export interface RenderHostLayerCollector {
  isVideoGpuReady(video: HTMLVideoElement): boolean;
  markVideoGpuReady(video: HTMLVideoElement): void;
  resetVideoGpuReady(video: HTMLVideoElement): void;
}

export interface RenderHostRenderLoop {
  getIsRunning?: () => boolean;
  getLastSuccessfulRenderTime: () => number;
  start?: () => void;
}

export interface RenderHostTelemetry {
  readonly mode: RendererMode;
  readonly presentationStrategy: RenderPresentationStrategy;
  readonly lifecycleOwner: 'renderHostPort';
  readonly statsOwner: 'renderHostPort';
  readonly watchdogOwner: 'renderHostPort';
  readonly selection: RenderHostSelectionTelemetry;
  readonly diagnostics?: Record<string, unknown>;
}

export interface RenderHostPort {
  getTelemetry(): RenderHostTelemetry;
  initialize(): Promise<boolean>;
  startRenderLoop(renderFrame: RenderFrameCallback): void;
  startStatsAndWatchdog(renderFrame: RenderFrameCallback): () => void;
  stopRenderLoopForDiagnostics(): void;
  startExistingRenderLoopForDiagnostics(): void;
  setTimelineVisualDemand(hasDemand: boolean): void;
  setVisualTargetFps(targetFps: number): void;
  setIsPlaying(isPlaying: boolean): void;
  setPlaybackSpeed(playbackSpeed: number): void;
  setIsScrubbing(isScrubbing: boolean): void;
  setContinuousRender(enabled: boolean): void;
  getRamPreviewRenderEngine(): RamPreviewRenderEngine;
  render(layers: Layer[]): void;
  renderCachedFrame(time: number): boolean;
  cacheCompositeFrame(time: number): Promise<void>;
  cacheActiveCompOutput(compositionId: string): void;
  getIsExporting(): boolean;
  renderToPreviewCanvas(canvasId: string, layers: Layer[]): void;
  copyNestedCompTextureToPreview(canvasId: string, compositionId: string): boolean;
  setResolution(width: number, height: number): void;
  getOutputDimensions(): { width: number; height: number };
  readPixels(): Promise<Uint8ClampedArray | null>;
  getCaptureCanvas(): RenderCaptureCanvas | null;
  getDevice(): GPUDevice | null;
  getLastRenderedTexture(): GPUTexture | null;
  updateMaskTexture(layerId: string, imageData: ImageData | null): void;
  removeMaskTexture(layerId: string): void;
  updateCanvasTexture(canvas: HTMLCanvasElement): boolean;
  invalidateCompositorBindings(layerId?: string): void;
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null;
  unregisterTargetCanvas(targetId: string): void;
  setPreviewCanvas(canvas: HTMLCanvasElement): void;
  requestRender(): void;
  requestNewFrameRender(): void;
  clearVideoCache(): void;
  clearScrubbingCache(videoSrc?: string): void;
  clearCompositeCache(): void;
  clearCaches(): void;
  clearFrame(): void;
  setGeneratingRamPreview(generating: boolean): void;
  getScrubbingCachedRanges(videoSrc: string): Array<{ start: number; end: number }>;
  getStats(): EngineStats;
  getLayerCollector(): RenderHostLayerCollector | null;
  getScrubbingCacheStats(): ScrubbingCacheStats;
  getCompositeCacheStats(): { count: number; maxFrames: number; memoryMB: number };
  getWorkerFirstCacheRuntimeSnapshot(): WorkerFirstCacheRuntimeSnapshot;
  getRenderLoop(): RenderHostRenderLoop | null;
  getDebugInfrastructureState(): DebugInfrastructureState;
  getRenderDispatcherDebugSnapshot(): RenderDispatcherDebugSnapshot | null;
  cleanupVideo(video: HTMLVideoElement): void;
  preCacheVideoFrame(video: HTMLVideoElement, ownerId?: string): Promise<boolean>;
  ensureVideoFrameCached(video: HTMLVideoElement, ownerId?: string): void;
  cacheFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): void;
  captureVideoFrameAtTime(video: HTMLVideoElement, time: number, ownerId?: string): boolean;
  markVideoFramePresented(video: HTMLVideoElement, time?: number, ownerId?: string): void;
  getLastPresentedVideoTime(video: HTMLVideoElement): number | undefined;
  markVideoGpuReady(video: HTMLVideoElement): void;
  createOutputWindow(id: string, name: string): { id: string; name: string } | null;
  closeOutputWindow(id: string): void;
  restoreOutputWindow(id: string): boolean;
  removeOutputTarget(id: string): void;
}

export interface ConfigureRenderHostSelectionOptions {
  readonly workerPrimary?: RenderHostPort | null;
  readonly preferWorkerPrimary?: boolean;
  readonly workerPrimaryAvailable?: boolean;
  readonly workerPrimaryBlockers?: readonly string[];
}

export type RenderHostCapabilityProbe = RenderCapabilityProbeResult;
