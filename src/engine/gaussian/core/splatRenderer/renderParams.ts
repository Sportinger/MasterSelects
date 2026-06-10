import type { SceneSplatEffectorRuntimeData } from '../../../scene/types';
import type { GaussianSplatParticleSettings, GaussianSplatTemporalSettings } from '../../types';

/** Optional parameters for temporal + particle pipeline steps */
export interface SplatRenderOptions {
  /** Clip-local time in seconds (for particle effects) */
  clipLocalTime?: number;
  /** Clear color for the render target. Use "transparent" to preserve alpha. */
  backgroundColor?: string;
  /** Render into an existing color attachment instead of an internal pooled target. */
  outputView?: GPUTextureView;
  /** Color load operation for the target render pass. */
  colorLoadOp?: GPULoadOp;
  /** Optional shared scene depth attachment. */
  depthView?: GPUTextureView;
  /** Whether splat fragments should update the shared depth attachment. */
  depthWrite?: boolean;
  /** Whether the splat pass writes color; false is used for depth-mask-only passes. */
  colorWrite?: boolean;
  /** Depth load operation for the render pass. */
  depthLoadOp?: GPULoadOp;
  /** Depth store operation for the render pass. */
  depthStoreOp?: GPUStoreOp;
  /** Depth clear value used when depthLoadOp is 'clear'. */
  depthClearValue?: number;
  /** Optional per-layer world transform for shared-scene rendering. */
  worldMatrix?: Float32Array;
  /** Layer opacity multiplier applied before premultiplied-alpha output. */
  layerOpacity?: number;
  /** Fragment alpha cutoff for depth-mask passes. Color passes should leave this at the default. */
  depthAlphaCutoff?: number;
  /** Object-level 3D effectors in shared scene space. */
  effectors?: SceneSplatEffectorRuntimeData[];
  /** Max splat budget (0 = unlimited) */
  maxSplats?: number;
  /** Particle effect settings */
  particleSettings?: GaussianSplatParticleSettings;
  /** Sort every N frames (1 = every frame, 0 = never) */
  sortFrequency?: number;
  /** Temporal playback settings (informational — frame switching handled externally via uploadScene) */
  temporalSettings?: GaussianSplatTemporalSettings;
  /** Prefer correctness over throughput (used for offline export). */
  precise?: boolean;
}

export const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

export const CULL_THRESHOLD = 50000;
export const SORT_THRESHOLD = 50000;

export interface PreparedSplatRenderParams {
  worldMatrix: Float32Array;
  layerOpacity: number;
  depthAlphaCutoff: number;
  maxSplats: number;
  sortFrequency: number;
  clearColor: GPUColor;
  precise: boolean;
}

export function prepareSplatRenderParams(options?: SplatRenderOptions): PreparedSplatRenderParams {
  return {
    worldMatrix: options?.worldMatrix ?? IDENTITY_MATRIX,
    layerOpacity: clamp01(options?.layerOpacity ?? 1),
    depthAlphaCutoff: clamp01(options?.depthAlphaCutoff ?? 0),
    maxSplats: options?.maxSplats ?? 0,
    sortFrequency: options?.sortFrequency ?? 1,
    clearColor: parseClearColor(options?.backgroundColor),
    precise: options?.precise === true,
  };
}

export function buildSplatRenderPassDescriptor(
  clipId: string,
  targetView: GPUTextureView,
  clearColor: GPUColor,
  options?: SplatRenderOptions,
): GPURenderPassDescriptor {
  const descriptor: GPURenderPassDescriptor = {
    colorAttachments: [
      {
        view: targetView,
        clearValue: clearColor,
        loadOp: options?.colorLoadOp ?? 'clear',
        storeOp: 'store',
      },
    ],
    label: `splat-render-pass-${clipId}`,
  };

  if (options?.depthView) {
    descriptor.depthStencilAttachment = {
      view: options.depthView,
      depthClearValue: options.depthClearValue ?? 1,
      depthLoadOp: options.depthLoadOp ?? 'load',
      depthStoreOp: options.depthStoreOp ?? 'store',
    };
  }

  return descriptor;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function parseClearColor(backgroundColor?: string): GPUColor {
  if (!backgroundColor || backgroundColor === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const normalized = backgroundColor.trim().toLowerCase();
  if (!normalized.startsWith('#')) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex = normalized.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const values = hex.split('').map((char) => parseInt(char + char, 16) / 255);
    return {
      r: values[0] ?? 0,
      g: values[1] ?? 0,
      b: values[2] ?? 0,
      a: values[3] ?? 1,
    };
  }

  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  return { r: 0, g: 0, b: 0, a: 0 };
}
