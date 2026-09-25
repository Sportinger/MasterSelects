// Effect system types and interfaces

import type { ComponentType } from 'react';
import type { GlyphAtlasOptions } from './_shared/glyphAtlas';
import type { ByteTextureProvider } from './_shared/byteTexture';

/**
 * Parameter definition for an effect
 */
export interface EffectParam {
  type: 'number' | 'boolean' | 'select' | 'color' | 'point' | 'text';
  label: string;
  default: number | boolean | string;
  // For number type:
  min?: number;
  max?: number;
  step?: number;
  // For select type:
  options?: { value: string; label: string }[];
  // Keyframe support:
  animatable?: boolean;
  // Quality parameter (shown in collapsible Quality section):
  quality?: boolean;
  // Declarative UI section. Quality remains a dedicated special section.
  group?: string;
  // Internal state carried in params (e.g. a baked artifact reference). Kept in
  // project data and undo, but omitted from generic controls and property lists.
  hidden?: boolean;
}

/**
 * Props for custom effect control components
 */
export interface EffectControlProps {
  effectInstanceId?: string;
  effectId: string;
  params: Record<string, number | boolean | string>;
  onChange: (params: Record<string, number | boolean | string>) => void;
  clipId?: string;
}

export type EffectPipelineKind = 'fullscreen' | 'particle-render' | 'compute';

/**
 * Standard fullscreen fragment effect definition.
 */
export interface FullscreenEffectDefinition {
  /** Render-only primitive, omitted from the effect picker. */
  internal?: boolean;
  pipelineKind?: 'fullscreen';

  // Identification
  id: string;                          // e.g. 'gaussian-blur'
  name: string;                        // e.g. 'Gaussian Blur'
  category: EffectCategory;            // e.g. 'blur'

  // GPU Configuration
  shader: string;                      // WGSL code as string
  entryPoint: string;                  // e.g. 'gaussianBlurFragment'
  uniformSize: number;                 // Bytes, 16-byte aligned

  // Parameters
  params: Record<string, EffectParam>;

  // Uniform packing function (params → Float32Array for GPU)
  packUniforms: (
    params: Record<string, number | boolean | string>,
    width: number,
    height: number,
    timelineTimeSeconds?: number,
  ) => Float32Array | null;

  // Optional: Multi-pass for complex effects (blur, glow, etc.)
  passes?: number;

  // Optional: Effect samples its own previous output frame through binding 3.
  usesFeedback?: boolean;

  // Samples a bounded history of this pass's input (not recursive feedback).
  usesInputHistory?: boolean;

  /** Explicit ownership of deterministic original-source time sampling. */
  sourceTimeOwner?: 'slit-scan' | 'time-stack';

  // Optional font atlas sampled from binding 4.
  glyphAtlas?: (params: Record<string, number | boolean | string>) => GlyphAtlasOptions;

  // Optional tracked landmark point set sampled from storage binding 6.
  landmarkPoints?: boolean;

  // Optional CPU byte block uploaded as a `texture_2d<u32>` on binding 5.
  // Re-uploaded only when the provider's `version` changes.
  byteTexture?: ByteTextureProvider;

  // Optional: Effect changes over wall-clock time and should keep paused preview rendering.
  requiresContinuousRender?: boolean;

  // Optional: Custom UI component for special controls
  customControls?: ComponentType<EffectControlProps>;

  // Optional: Extra UI rendered below the generic parameter controls. Loaded
  // lazily so effect modules never import the store/React layer eagerly.
  extraControls?: () => Promise<{ default: ComponentType<EffectControlProps> }>;

  // Optional: The effect renders through a virtual camera that preview mouse
  // interaction may drive (drag = orbit, wheel = dolly). Maps camera roles to
  // the effect's own param names; the params stay the single source of truth.
  cameraInteraction?: EffectCameraInteraction;
}

/**
 * Declares which params act as an effect's virtual camera so the Preview can
 * orbit it. All referenced params must be 'number' params of the effect.
 */
export interface EffectCameraInteraction {
  yawParam: string;        // horizontal drag target, degrees
  tiltParam: string;       // vertical drag target, degrees
  distanceParam: string;   // wheel dolly target (multiplier, 1 = default framing)
  centerXParam?: string;   // Shift+drag pan target, 0..1
  centerYParam?: string;   // Shift+drag pan target, 0..1
  yawWrap?: boolean;       // wrap yaw into [-180, 180] instead of clamping
  tiltWrap?: boolean;      // wrap tilt into [-180, 180] for pole-crossing free orbit
}

/**
 * Specialized render effect definition. It is registered for UI and project
 * data, but rendered by a dedicated pass instead of EffectsPipeline.
 */
export interface ParticleRenderEffectDefinition {
  pipelineKind: 'particle-render';
  id: string;
  name: string;
  category: EffectCategory;
  params: Record<string, EffectParam>;
  requiresContinuousRender?: boolean;
  customControls?: ComponentType<EffectControlProps>;
}

export interface ComputeEffectDefinition {
  pipelineKind: 'compute';
  id: string;
  name: string;
  category: EffectCategory;
  shader: string;
  entryPoint: string;
  uniformSize: number;
  params: Record<string, EffectParam>;
  packUniforms: FullscreenEffectDefinition['packUniforms'];
  workgroupSize?: [number, number];
  computeMode?: 'single' | 'jump-flood' | 'analog-signal';
  requiresContinuousRender?: boolean;
  customControls?: ComponentType<EffectControlProps>;
}

/**
 * Complete effect definition - each effect module exports this.
 */
export type EffectDefinition = FullscreenEffectDefinition | ParticleRenderEffectDefinition | ComputeEffectDefinition;

export function isFullscreenEffectDefinition(
  effect: EffectDefinition | undefined,
): effect is FullscreenEffectDefinition {
  return !!effect && (effect.pipelineKind ?? 'fullscreen') === 'fullscreen';
}

export function isParticleRenderEffectDefinition(
  effect: EffectDefinition | undefined,
): effect is ParticleRenderEffectDefinition {
  return !!effect && effect.pipelineKind === 'particle-render';
}

export function isComputeEffectDefinition(
  effect: EffectDefinition | undefined,
): effect is ComputeEffectDefinition {
  return !!effect && effect.pipelineKind === 'compute';
}

/**
 * Effect categories for organization
 */
export type EffectCategory =
  | 'color'
  | 'blur'
  | 'distort'
  | 'stylize'
  | 'generate'
  | 'keying'
  | 'time'
  | 'transition'
  | 'halftone'
  | 'analog'
  | 'pixel'
  | 'glyph'
  | 'geometry'
  | 'tracking';

/**
 * Category metadata for UI display
 */
export interface CategoryInfo {
  id: EffectCategory;
  name: string;
  icon?: string;
}

export const CATEGORY_INFO: CategoryInfo[] = [
  { id: 'color', name: 'Color Correction' },
  { id: 'blur', name: 'Blur & Sharpen' },
  { id: 'distort', name: 'Distort' },
  { id: 'stylize', name: 'Stylize' },
  { id: 'generate', name: 'Generate' },
  { id: 'keying', name: 'Keying' },
  { id: 'time', name: 'Time' },
  { id: 'transition', name: 'Transition' },
  { id: 'halftone', name: 'Halftone & Dither' },
  { id: 'analog', name: 'Analog & Glitch' },
  { id: 'pixel', name: 'Pixel & Block' },
  { id: 'glyph', name: 'Glyph & Type' },
  { id: 'geometry', name: 'Geometry & Vector' },
  { id: 'tracking', name: 'Tracking' },
];

/**
 * Runtime effect instance (attached to a clip/layer)
 */
export interface EffectInstance {
  id: string;
  type: string;                        // References EffectDefinition.id
  name: string;
  enabled: boolean;
  params: Record<string, number | boolean | string>;
}
