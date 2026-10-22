import type { TimelineClip } from './index';

export type PropertyValueType =
  | 'number'
  | 'boolean'
  | 'color'
  | 'enum'
  | 'vector2'
  | 'gradient'
  | 'path';

export type PropertyValue = unknown;

/**
 * Serializable metadata describing the value contract at an authoring
 * boundary. Runtime state continues to use the descriptor's storage value.
 */
export interface PropertyAuthoringMetadata {
  /** Unit presented to humans and external tools. */
  unit?: string;
  /** Unit kept in TimelineClip/Keyframe state. */
  storageUnit?: string;
  /** Coordinate origin used by externally authored position values. */
  coordinateSpace?: 'composition-center';
  /** Axis used to choose the composition half-extent conversion. */
  axis?: 'x' | 'y' | 'z';
  /** Declarative, serializable codec identifier. */
  codec?: 'identity' | 'composition-half-extent' | 'transform-position';
}

export interface PropertyAuthoringContext {
  compositionId: string;
  compositionWidth: number;
  compositionHeight: number;
  positionUnitMode: 'composition-pixels' | 'scene-units';
}

export interface PropertyAuthoringDescriptorView {
  path: string;
  label: string;
  group: string;
  valueType: PropertyValueType;
  animatable: boolean;
  writable: boolean;
  defaultValue: PropertyValue;
  value?: PropertyValue;
  range?: {
    min?: number;
    max?: number;
    step?: number;
    minMagnitude?: number;
    /** Cyclic value (Hue Shift): min/max are one turn of the slider, any value is accepted. */
    wraps?: boolean;
  };
  unit?: string;
  storageUnit?: string;
  coordinateSpace?: PropertyAuthoringMetadata['coordinateSpace'];
  axis?: PropertyAuthoringMetadata['axis'];
  codec: 'identity' | 'composition-half-extent';
  aliases: string[];
  enumValues?: Array<{ value: string | number | boolean; label: string }>;
  /** Compatibility metadata for existing registry consumers. */
  ui?: PropertyDescriptor['ui'];
}

export interface PropertyDescriptor<T = PropertyValue> {
  path: string;
  label: string;
  group: string;
  valueType: PropertyValueType;
  animatable: boolean;
  defaultValue: T;
  /** An explicit runtime adapter exists; animatable alone does not imply node control. */
  controlSource?: { domain: 'clip-scalar'; unit: string; hardMin?: number; hardMax?: number };
  /** Catalog descriptors are discoverable without a clip, but not in clip search. */
  catalogOnly?: boolean;
  authoring?: PropertyAuthoringMetadata;
  ui?: {
    min?: number;
    max?: number;
    /** Smallest allowed absolute value; values closer to zero are rejected. */
    minMagnitude?: number;
    /** Cyclic value: min/max describe one turn for sliders and are not a limit. */
    wraps?: boolean;
    /**
     * Range the value renders in when it may go past the slider's min/max (EffectParam.renderMin and
     * renderMax): typed values, keyframes and tools may use it. Undefined: min/max are the limit.
     */
    renderMin?: number;
    renderMax?: number;
    step?: number;
    unit?: string;
    aliases?: string[];
    compact?: boolean;
    options?: Array<{ value: string | number | boolean; label: string }>;
  };
  read?: (clip: TimelineClip, path: string) => T | undefined;
  write?: (clip: TimelineClip, value: PropertyValue, path: string) => TimelineClip;
}

export interface PropertySearchOptions {
  clip?: TimelineClip;
  query?: string;
  group?: string;
  animatable?: boolean;
}

export type PropertyDescriptorResolver = (
  path: string,
  clip?: TimelineClip,
) => PropertyDescriptor | undefined;

export type PropertyDescriptorProvider = (clip: TimelineClip) => PropertyDescriptor[];
