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
  // Retired parameter: kept (hidden) so saved projects and old tool calls still load, but
  // the renderer no longer reads it. Tools return this reason when a caller sets it. An
  // edited saved graph that still binds it shows it again (effectParamVisibility.ts).
  deprecated?: string;
  // Read only through the effect's operator graph: hidden (and reported by tools) when an
  // edited graph no longer binds it.
  graphOnly?: boolean;
  // Stored in radians (project data, keyframes, tools); the effect inspector shows and edits whole
  // degrees (the preset of displayScale 180/π with unit "°" and one-degree steps).
  displayUnit?: 'degrees';
  // Acts only while another parameter has one of these values (RGB Split's Angle in Offset mode):
  // otherwise the inspector dims the row and shows `note`.
  activeWhen?: { param: string; values: readonly (string | number | boolean)[]; note: string };
  // Rendered range for numbers that may arrive outside min/max (keyframe overshoot, tools,
  // node drivers). The effect graph clamps to it; the inspector and tool results say so.
  renderMin?: number;
  renderMax?: number;
  // How the lower render limit looks (e.g. "almost black" for a gamma floor), added to that notice.
  renderMinLook?: string;
  // Display only (effectParamDisplay in paramDisplay.ts): inspectors show value × displayScale
  // with this unit after the value (Hue Shift stores turns and shows degrees; Exposure " EV",
  // Acuarela Wash "px", Sheen Angle "°"). Stored values, keyframes and tool calls keep the
  // parameter's own unit.
  displayScale?: number;
  unit?: string;
  // Value an instance saved before this parameter existed renders with (its params lack the key).
  // New effects store `default` explicitly (getDefaultParams), so only old saves and presets get this.
  legacyDefault?: number | boolean | string;
  // A rate per second (Speed, Spin) that may be keyframed: while it has keyframes, every render path
  // (evaluateEffectKeyframes) writes the area under its curve since the start of the clock the effect
  // renders with (value × seconds; before the first key its value holds) into the runtime-only param
  // named here, and packers use that travel instead of value × time, so a ramp moves smoothly. Never
  // stored: loading strips it (withoutRuntimeTravelParams).
  integratedAs?: string;
}

/**
 * A named starting point of an effect, picked in its card ("Preset"). Applying it sets every visible
 * control to the preset's value, or to its default when the preset leaves it out (text controls stay
 * unless named), in one undo step. Controls with keyframes or a node driving them keep their animation
 * and are named in the card instead (src/services/effects/effectPresets.ts). The docs page lists each
 * preset under "## Presets" (tests/unit/effectDocsCatalog.test.ts checks the names).
 */
export interface EffectPreset {
  /** Stable id (kebab-case); never shown. */
  id: string;
  /** Name in the card and the docs, a short noun phrase ("Venetian Blinds"). */
  name: string;
  /** Values that differ from the defaults, in stored units. */
  params: Readonly<Record<string, number | boolean | string>>;
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

  /**
   * Optional: notes for values the renderer clamps, ignores or cannot show (e.g. an
   * out-of-range number or a setting with no visible result). Tool results return them as
   * warnings; effect inspectors may show them. Never silent about a degraded value.
   * width/height: the active composition size (callers pass it; 1920x1080 when unknown).
   */
  paramWarnings?: (params: Record<string, number | boolean | string>, width?: number, height?: number) => string[];

  /** Optional: why the effect is still experimental (its known artefacts). Pickers mark it; the inspector and tools show the note. */
  experimental?: string;

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

  /** The picture changes with timeline time (Speed × time) but holds still while paused, so it needs
   * no continuous rendering; the docs show it as a loop. */
  timelineAnimated?: boolean;

  /** Named starting points picked in the effect card (EffectPreset). */
  presets?: readonly EffectPreset[];

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
  presets?: readonly EffectPreset[];
  customControls?: ComponentType<EffectControlProps>;
  // Notes on values the renderer clamps or changes at this output size (see FullscreenEffectDefinition).
  paramWarnings?: (params: Record<string, number | boolean | string>, width?: number, height?: number) => string[];
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
  /** Notes for values the renderer clamps, ignores or cannot show (see FullscreenEffectDefinition.paramWarnings). */
  paramWarnings?: FullscreenEffectDefinition['paramWarnings'];
  /** Why the effect is still experimental (see FullscreenEffectDefinition.experimental). */
  experimental?: string;
  requiresContinuousRender?: boolean;
  presets?: readonly EffectPreset[];
  customControls?: ComponentType<EffectControlProps>;
}

/**
 * Complete effect definition - each effect module exports this.
 */
export type EffectDefinition = FullscreenEffectDefinition | ParticleRenderEffectDefinition | ComputeEffectDefinition;

/** Why an effect is still experimental, or undefined for a finished effect. */
export function effectExperimentalNote(definition: EffectDefinition | undefined): string | undefined {
  return definition && 'experimental' in definition ? definition.experimental : undefined;
}

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
