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

export interface PropertyDescriptor<T = PropertyValue> {
  path: string;
  label: string;
  group: string;
  valueType: PropertyValueType;
  animatable: boolean;
  defaultValue: T;
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
