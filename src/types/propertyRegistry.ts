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
  /** Catalog descriptors are discoverable without a clip, but not in clip search. */
  catalogOnly?: boolean;
  authoring?: PropertyAuthoringMetadata;
  ui?: {
    min?: number;
    max?: number;
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
