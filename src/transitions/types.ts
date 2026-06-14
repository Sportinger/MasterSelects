// Transition Types
// Defines the structure for timeline transitions between clips

export type TransitionType = 'crossfade' | 'dip-to-black' | 'dip-to-white' | 'wipe-left' | 'wipe-right';

export type TransitionCategory = 'dissolve' | 'wipe' | 'slide' | 'zoom';

export type TransitionLayerTarget = 'outgoing' | 'incoming' | 'solid';

export type TransitionCurve = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

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
      color: '#000000' | '#ffffff';
    }
  | {
      kind: 'mask';
      target: 'outgoing' | 'incoming';
      mask: 'wipe';
      direction: 'left' | 'right';
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

export function getDefaultTransitionParams(
  definition: TransitionDefinition | undefined,
): Record<string, TransitionParamValue> | undefined {
  const entries = Object.entries(definition?.params ?? {});
  if (entries.length === 0) return undefined;

  return Object.fromEntries(
    entries.map(([paramId, param]) => [paramId, param.defaultValue])
  );
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
