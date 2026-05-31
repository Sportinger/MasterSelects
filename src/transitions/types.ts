// Transition Types
// Defines the structure for timeline transitions between clips.
// Mirrors the effect system (src/effects/types.ts): each transition is a small
// module that exports a TransitionDefinition with a WGSL shader + parameter schema.

export type TransitionType = 'crossfade' | 'dip-to-black' | 'dip-to-white' | 'wipe-left' | 'wipe-right';

export type TransitionCategory = 'dissolve' | 'wipe' | 'slide' | 'zoom';

/**
 * Parameter definition for a transition (mirrors EffectParam).
 */
export interface TransitionParam {
  type: 'number' | 'boolean' | 'select' | 'color';
  label: string;
  default: number | boolean | string;
  // For number type:
  min?: number;
  max?: number;
  step?: number;
  // For select type:
  options?: { value: string; label: string }[];
}

/**
 * Shared easing options + parameter. Easing is applied to `progress` centrally in
 * the compositor (before packUniforms), so every transition supports it uniformly
 * and the shaders stay simple.
 */
export const EASING_OPTIONS: { value: string; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In/Out' },
];

export const EASING_PARAM: TransitionParam = {
  type: 'select',
  label: 'Easing',
  default: 'linear',
  options: EASING_OPTIONS,
};

/**
 * Transition definition - each transition type implements this interface.
 */
export interface TransitionDefinition {
  /** Unique identifier for this transition type */
  id: TransitionType;

  /** Display name shown in UI */
  name: string;

  /** Category for grouping in panel */
  category: TransitionCategory;

  /** Default duration in seconds */
  defaultDuration: number;

  /** Minimum duration in seconds */
  minDuration: number;

  /** Maximum duration in seconds */
  maxDuration: number;

  /** Description shown in tooltip */
  description: string;

  // ===== GPU configuration =====

  /** WGSL fragment shader source (combined with the shared transition prelude). */
  shader: string;

  /** Fragment entry point name, e.g. 'crossfadeFragment'. */
  entryPoint: string;

  /** Uniform buffer size in bytes (16-byte aligned). All transitions use 32 (8 floats). */
  uniformSize: number;

  /** Parameter schema (includes the shared easing param). */
  params: Record<string, TransitionParam>;

  /**
   * Pack parameters + (already-eased) progress into the uniform buffer.
   * Layout convention: float[0] = progress, float[1..7] = transition-specific slots.
   */
  packUniforms: (
    params: Record<string, number | boolean | string>,
    progress: number,
  ) => Float32Array;
}

/**
 * Transition instance stored on a clip.
 */
export interface ClipTransition {
  /** Unique ID for this transition instance */
  id: string;
  /** Type of transition */
  type: TransitionType;
  /** Duration in seconds */
  duration: number;
  /** ID of the other clip in the transition */
  linkedClipId: string;
  /** Transition-specific parameter values */
  params?: Record<string, number | boolean | string>;
}
