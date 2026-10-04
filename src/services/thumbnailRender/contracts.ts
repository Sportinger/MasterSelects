import type { Effect } from '../../types/effects';
import type { Layer } from '../../types/layers';

// Minimal subset of WebGPU resources needed for thumbnail rendering.
export interface ThumbnailResources {
  device: GPUDevice;
  sampler: GPUSampler;
  compositorPipeline: import('../../engine/pipeline/CompositorPipeline').CompositorPipeline;
  effectsPipeline: import('../../effects/EffectsPipeline').EffectsPipeline;
  outputPipeline: import('../../engine/pipeline/OutputPipeline').OutputPipeline;
  textureManager: import('../../engine/texture/TextureManager').TextureManager;
  maskTextureManager: import('../../engine/texture/MaskTextureManager').MaskTextureManager;
}

export interface ThumbnailOptions {
  count?: number;
  width?: number;
  height?: number;
  /** Pre-calculated boundary positions (normalized 0-1) for segment-based thumbnails */
  boundaries?: number[];
}

export const DEFAULT_OPTIONS: Required<ThumbnailOptions> = {
  count: 10,
  width: 160,
  height: 90,
  boundaries: [],
};

export interface ThumbnailLayerData {
  layer: Layer;
  isVideo: boolean;
  externalTexture: GPUExternalTexture | null;
  textureView: GPUTextureView | null;
  sourceWidth: number;
  sourceHeight: number;
  textureRect?: { x: number; y: number; width: number; height: number };
  expandTextureToSource?: () => GPUTextureView | null;
}

export interface ThumbnailRenderTarget {
  pingView: GPUTextureView;
  pongView: GPUTextureView;
  effectTempView: GPUTextureView;
  effectTempView2: GPUTextureView;
  effectTempTexture: GPUTexture;
  effectTempTexture2: GPUTexture;
  canvasContext: GPUCanvasContext;
  canvas: OffscreenCanvas;
}

export interface ThumbnailClipSource {
  type: string;
  videoElement?: HTMLVideoElement;
  imageElement?: HTMLImageElement;
  naturalDuration?: number;
}

export interface ThumbnailClipTransform {
  position?: { x: number; y: number; z?: number };
  scale?: { x: number; y: number };
  rotation?: number | { x?: number; y?: number; z?: number };
  opacity?: number;
}

export interface ThumbnailClip {
  id: string;
  name: string;
  source: ThumbnailClipSource | null;
  transform?: ThumbnailClipTransform;
  effects?: Array<{ id: string; type: string; enabled: boolean; params: Record<string, unknown> }>;
  inPoint: number;
  outPoint: number;
}

export interface ThumbnailClipRenderInput {
  id: string;
  source: ThumbnailClipSource | null;
  transform?: ThumbnailClipTransform;
  effects?: Array<{ id: string; type: string; enabled: boolean; params: Record<string, unknown> }>;
}

export type ThumbnailEffectList = Effect[];
