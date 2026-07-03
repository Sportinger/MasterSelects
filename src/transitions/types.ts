// Transition Types
// Defines the structure for timeline transitions between clips

export type TransitionType =
  | 'additive-dissolve'
  | 'barn-door-horizontal'
  | 'barn-door-vertical'
  | 'blur-dissolve'
  | 'cube-3d'
  | 'crossfade'
  | 'data-corrupt'
  | 'datamosh'
  | 'dip-to-color'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'directional-blur'
  | 'door-3d'
  | 'block-glitch'
  | 'card-spin'
  | 'checker-wipe'
  | 'chroma-leak'
  | 'circle-iris'
  | 'clock-wipe'
  | 'center-wipe'
  | 'cross-iris'
  | 'crt-collapse'
  | 'diamond-iris'
  | 'doom-bars'
  | 'flash'
  | 'film-roll'
  | 'film-burn'
  | 'flow'
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'fly-eye'
  | 'fold-3d'
  | 'hex-pixelize'
  | 'ink-bleed'
  | 'kaleidoscope'
  | 'light-leak'
  | 'light-sweep'
  | 'lens-flare'
  | 'liquid-melt'
  | 'luma-fade'
  | 'magnetic-tiles'
  | 'mosaic-glitch'
  | 'neural-dream'
  | 'noise-dissolve'
  | 'non-additive-dissolve'
  | 'origami-fold'
  | 'oval-iris'
  | 'page-peel'
  | 'paint-splatter'
  | 'polka-dot-curtain'
  | 'portal-ring'
  | 'projector-flicker'
  | 'push-left'
  | 'push-right'
  | 'push-up'
  | 'push-down'
  | 'puzzle-push'
  | 'random-blocks'
  | 'rotate-90'
  | 'rotate-left'
  | 'rotate-right'
  | 'rgb-split-glitch'
  | 'roll-3d'
  | 'scanline-glitch'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'shatter-glass'
  | 'signal-tear'
  | 'smoke-reveal'
  | 'smooth-cut'
  | 'square-iris'
  | 'star-iris'
  | 'thermal-bloom'
  | 'triangle-iris'
  | 'tumble-away'
  | 'venetian-blinds-horizontal'
  | 'venetian-blinds-vertical'
  | 'vignette-bloom'
  | 'vhs-head-switch'
  | 'water-drop'
  | 'wipe-left'
  | 'wipe-right'
  | 'wipe-up'
  | 'wipe-down'
  | 'whip-pan'
  | 'zig-zag-blocks'
  | 'swirl'
  | 'spin-zoom'
  | 'spinback-3d'
  | 'zoom-blur'
  | 'zoom-in'
  | 'zoom-out';

export type TransitionCategory =
  | 'dissolve'
  | 'wipe'
  | 'slide'
  | 'light'
  | 'glitch'
  | 'pattern'
  | 'stylize'
  | 'rotate'
  | '3d'
  | 'zoom';

export type TransitionCapability = 'stable' | 'experimental' | 'planned';

export type TransitionRenderMode = 'compositor' | 'scene-3d-panel';

export interface TransitionCapabilityOptions {
  includeExperimental?: boolean;
  includePlanned?: boolean;
}

export type TransitionLayerTarget = 'outgoing' | 'incoming' | 'solid';

export type TransitionCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export type TransitionCenterAxis = 'x' | 'y';

export type TransitionShapeMask = 'circle' | 'cross' | 'diamond' | 'oval' | 'rect' | 'star' | 'triangle';

export type TransitionProceduralMask = 'noise' | 'blocks';

export type TransitionPatternMask =
  | 'checker'
  | 'doom-bars'
  | 'paint-splatter'
  | 'polka-dot'
  | 'random-blocks'
  | 'venetian-horizontal'
  | 'venetian-vertical'
  | 'zig-zag';

export type TransitionOverlayPattern = 'chroma-leak' | 'film-burn' | 'lens-flare' | 'light-leak' | 'light-sweep';

export type TransitionDistortion = 'water-drop' | 'swirl';

export type TransitionMultiPanelOrder = 'center-out' | 'column-major' | 'edge-in' | 'magnetic' | 'random' | 'row-major';

export type TransitionMultiPanelMotion = 'fold' | 'magnetic' | 'puzzle' | 'shatter' | 'slide';

export type TransitionWipeDirection = 'left' | 'right' | 'up' | 'down';

export interface TransitionNumberRange {
  from: number;
  to: number;
}

export type TransitionEffectParamValue = TransitionParamValue | TransitionNumberRange;

export type TransitionPrimitive =
  | {
      kind: 'opacity';
      target: TransitionLayerTarget;
      from: number;
      to: number;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'solid';
      color: string;
      colorParam?: string;
    }
  | {
      kind: 'overlay';
      overlay: TransitionOverlayPattern;
      color: string;
      colorParam?: string;
      blendMode?: string;
      opacity?: TransitionNumberRange;
      centerX?: TransitionNumberRange;
      width?: number;
      softness?: number;
      angle?: number;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | TransitionMaskPrimitive
  | {
      kind: 'transform';
      target: 'outgoing' | 'incoming';
      translateX?: TransitionNumberRange;
      translateY?: TransitionNumberRange;
      translateZ?: TransitionNumberRange;
      rotateX?: TransitionNumberRange;
      rotateY?: TransitionNumberRange;
      scaleX?: TransitionNumberRange;
      scaleY?: TransitionNumberRange;
      rotateZ?: TransitionNumberRange;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'effect';
      target: 'outgoing' | 'incoming';
      effectType: string;
      effectName?: string;
      params: Record<string, TransitionEffectParamValue>;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'distortion';
      target: 'outgoing' | 'incoming';
      distortion: TransitionDistortion;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'multi-panel';
      target: 'outgoing' | 'incoming';
      rows: number;
      columns: number;
      order: TransitionMultiPanelOrder;
      motion: TransitionMultiPanelMotion;
      seed?: number;
      stagger?: number;
      startProgress?: number;
      endProgress?: number;
      curve?: TransitionCurve;
    }
  | {
      kind: 'blend';
      target: 'outgoing' | 'incoming';
      mode: string;
      startProgress?: number;
      endProgress?: number;
    };

export type TransitionMaskPrimitive =
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'wipe';
      direction: TransitionWipeDirection;
      angle?: number;
      feather?: number;
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'shape';
      shape: TransitionShapeMask;
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'clock';
      clockwise?: boolean;
      angleOffset?: number;
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'center';
      axis: TransitionCenterAxis;
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'procedural';
      procedural: TransitionProceduralMask;
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'pattern';
      pattern: TransitionPatternMask;
    };

export type TransitionParamType = 'number' | 'boolean' | 'select' | 'color';
export type TransitionParamValue = string | number | boolean;

export interface TransitionParamDefinition {
  type: TransitionParamType;
  label: string;
  defaultValue: TransitionParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { label: string; value: string | number | boolean }[];
}

export interface TransitionParamInstance {
  type: string;
  params?: Record<string, TransitionParamValue>;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeTransitionParamValue(
  value: TransitionParamValue | undefined,
  definition: TransitionParamDefinition,
): TransitionParamValue {
  if (definition.type === 'boolean') {
    return value === undefined ? definition.defaultValue === true : value === true;
  }

  if (definition.type === 'number') {
    const numericValue = typeof value === 'number' && Number.isFinite(value)
      ? value
      : Number(definition.defaultValue);
    const fallbackValue = Number.isFinite(numericValue) ? numericValue : 0;
    const min = typeof definition.min === 'number' ? definition.min : -Infinity;
    const max = typeof definition.max === 'number' ? definition.max : Infinity;
    return Math.max(min, Math.min(max, fallbackValue));
  }

  if (definition.type === 'select') {
    const option = definition.options?.find(candidate => String(candidate.value) === String(value));
    return option?.value ?? definition.defaultValue;
  }

  if (definition.type === 'color') {
    return typeof value === 'string' && isHexColor(value)
      ? value
      : definition.defaultValue;
  }

  return value ?? definition.defaultValue;
}

export function getDefaultTransitionParams(
  definition: TransitionDefinition | undefined,
): Record<string, TransitionParamValue> | undefined {
  const entries = Object.entries(definition?.params ?? {});
  if (entries.length === 0) return undefined;

  return Object.fromEntries(
    entries.map(([paramId, param]) => [paramId, normalizeTransitionParamValue(param.defaultValue, param)])
  );
}

export function normalizeTransitionParamsForDefinition(
  definition: TransitionDefinition | undefined,
  patch: Record<string, TransitionParamValue> | undefined,
  base?: Record<string, TransitionParamValue>,
): Record<string, TransitionParamValue> | undefined {
  const schema = definition?.params;
  if (!schema) return undefined;

  const nextParams = getDefaultTransitionParams(definition) ?? {};
  for (const [paramId, paramDefinition] of Object.entries(schema)) {
    nextParams[paramId] = normalizeTransitionParamValue(base?.[paramId], paramDefinition);
  }
  for (const [paramId, value] of Object.entries(patch ?? {})) {
    const paramDefinition = schema[paramId];
    if (!paramDefinition) continue;
    nextParams[paramId] = normalizeTransitionParamValue(value, paramDefinition);
  }

  return Object.keys(nextParams).length > 0 ? nextParams : undefined;
}

export function getTransitionParamValue(
  transition: TransitionParamInstance,
  definition: TransitionDefinition | undefined,
  paramId: string,
): TransitionParamValue | undefined {
  const currentValue = transition.params?.[paramId];
  if (currentValue !== undefined) return currentValue;
  return definition?.params?.[paramId]?.defaultValue;
}

export function getBooleanTransitionParam(
  transition: TransitionParamInstance,
  definition: TransitionDefinition | undefined,
  paramId: string,
): boolean {
  return getTransitionParamValue(transition, definition, paramId) === true;
}

export function transitionIncludesAudio(
  transition: TransitionParamInstance,
  definition: TransitionDefinition | undefined,
): boolean {
  return transition.type === 'crossfade' &&
    getBooleanTransitionParam(transition, definition, 'includeAudio');
}

export function getTransitionCapability(
  definition: TransitionDefinition,
): TransitionCapability {
  return definition.capability ?? 'stable';
}

export function isTransitionRuntimeEnabled(
  definition: TransitionDefinition,
  options: TransitionCapabilityOptions = {},
): boolean {
  const capability = getTransitionCapability(definition);
  if (capability === 'stable') return true;
  if (capability === 'experimental') return options.includeExperimental === true;
  return false;
}

export function isTransitionVisibleInRegistry(
  definition: TransitionDefinition,
  options: TransitionCapabilityOptions = {},
): boolean {
  const capability = getTransitionCapability(definition);
  if (isTransitionRuntimeEnabled(definition, options)) return true;
  return capability === 'planned' && options.includePlanned === true;
}

/**
 * Transition definition - each transition type implements this interface
 */
export interface TransitionDefinition {
  /** Unique identifier for this transition type */
  id: TransitionType;

  /** Display name shown in UI */
  name: string;

  /** Category for grouping in panel */
  category: TransitionCategory;

  /** Capability level for production gating */
  capability?: TransitionCapability;

  /** Optional renderer preference for transitions that need native scene geometry */
  renderMode?: TransitionRenderMode;

  /** Default duration in seconds */
  defaultDuration: number;

  /** Minimum duration in seconds */
  minDuration: number;

  /** Advisory duration hint in seconds; timeline edits are not hard-capped by this */
  maxDuration?: number;

  /** Description shown in tooltip */
  description: string;

  /** Optional editable parameter schema for this transition type */
  params?: Record<string, TransitionParamDefinition>;

  /** Serializable primitive recipe compiled by preview/export renderers */
  recipe: TransitionPrimitive[];
}

/**
 * Transition instance stored on a clip
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
  /** Editable transition parameter values */
  params?: Record<string, TransitionParamValue>;
}
