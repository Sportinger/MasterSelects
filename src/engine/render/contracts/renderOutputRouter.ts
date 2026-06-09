/**
 * Freezes the runtime output-routing boundary.
 * First implementor: RenderDispatcher output block plus WebGPUEngine.targetCanvases.
 * Eliminates class-c getState reads from composite, empty-frame, cached-frame,
 * preview-target, and export-surface routing.
 */

import type { RenderTargetSnapshot } from './renderTargetSnapshot';

export type RenderOutputMode = 'normal' | 'grid' | 'stackedAlpha';

export interface RenderCanvasTargetRegistration {
  readonly id: string;
  readonly canvas: HTMLCanvasElement;
}

export interface RenderRouterTargetContext {
  readonly canvas: HTMLCanvasElement;
  readonly context: GPUCanvasContext;
}

export interface RenderCompositeFrameRouteInput {
  readonly commandEncoder: GPUCommandEncoder;
  readonly sourceView: GPUTextureView;
  readonly sampler: GPUSampler;
  readonly snapshot?: RenderTargetSnapshot;
  readonly targetIds?: readonly string[];
  readonly exportTarget?: {
    readonly context: GPUCanvasContext;
    readonly mode: Extract<RenderOutputMode, 'normal' | 'stackedAlpha'>;
  };
}

export interface RenderEmptyFrameRouteInput {
  readonly commandEncoder: GPUCommandEncoder;
  readonly sourceView?: GPUTextureView;
  readonly sampler?: GPUSampler;
  readonly clearColor?: GPUColorDict;
  readonly snapshot?: RenderTargetSnapshot;
  readonly targetIds?: readonly string[];
}

export interface RenderCachedFrameRouteInput {
  readonly commandEncoder: GPUCommandEncoder;
  readonly bindGroup: GPUBindGroup;
  readonly time: number;
  readonly snapshot?: RenderTargetSnapshot;
  readonly targetIds?: readonly string[];
}

export interface RenderOutputRouter {
  captureSnapshot(): RenderTargetSnapshot;
  registerCanvasTarget(target: RenderCanvasTargetRegistration): GPUCanvasContext | null;
  unregisterTarget(id: string): void;
  routeCompositeFrame(input: RenderCompositeFrameRouteInput): void;
  routeEmptyFrame(input: RenderEmptyFrameRouteInput): void;
  routeCachedFrame(input: RenderCachedFrameRouteInput): void;
  getTargetContext(id: string): GPUCanvasContext | null;
}
