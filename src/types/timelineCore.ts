import type { BlendMode } from './blendMode';
import type { Keyframe } from './keyframes';
import type { TransitionParamValue } from '../transitions';

export interface TransitionCompositionLink {
  kind: 'transition-comp';
  /** Missing means the pre-v3 segmented source layout. */
  sourceLayout?: 'mapped-v3' | 'legacy-segmented';
  /** Hidden legacy composition retained after an explicit mapped-v3 upgrade. */
  legacyBackupCompositionId?: string;
  parentCompositionId: string;
  parentTransitionId: string;
  parentOutgoingClipId: string;
  parentIncomingClipId: string;
  linkedOutgoingClipId: string;
  linkedIncomingClipId: string;
  innerTransitionId: string;
  templateType?: string;
  templateVersion?: number;
  templateParamsKey?: string;
  paddingBefore: number;
  paddingAfter: number;
  bodyStart: number;
  bodyEnd: number;
  materialized?: boolean;
}

/**
 * Versioned, plain-data map from transition-composition seconds to source-media
 * seconds. Segments are ordered, contiguous half-open ranges; the final end is
 * included when resolving a clamped time.
 */
export interface TransitionSourceMapV1 {
  version: 1;
  segments: TransitionSourceMapSegment[];
}

export type TransitionSourceMapSegment =
  | {
      kind: 'linear';
      compStart: number;
      compEnd: number;
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      kind: 'hold';
      compStart: number;
      compEnd: number;
      sourceTime: number;
    };

export interface TransitionSourceMapV2AnimationSnapshot {
  baseTransform: ClipTransform;
  keyframes: Keyframe[];
  sourceEffectIds: string[];
  sourceMaskIds: string[];
}

export interface TransitionSourceMapV2ParentContract {
  duration: number;
  inPoint: number;
  outPoint: number;
  defaultSpeed: number;
  animation: TransitionSourceMapV2AnimationSnapshot;
}

export type TransitionSourceMapV2Segment =
  | {
      kind: 'parent-linear';
      compStart: number;
      compEnd: number;
      parentStart: number;
      parentEnd: number;
    }
  | {
      kind: 'parent-hold';
      compStart: number;
      compEnd: number;
      parentTime: number;
    };

export interface TransitionSourceMapV2 {
  version: 2;
  mediaDuration: number;
  parent: TransitionSourceMapV2ParentContract;
  segments: TransitionSourceMapV2Segment[];
}

/** The v2 parent contract resolves animation at runtime; v1 stores source time. */
export type TransitionSourceMap = TransitionSourceMapV1 | TransitionSourceMapV2;

/** A half-open composition-time window that temporarily overrides clip blending. */
export interface TransitionRecipeBlendWindow {
  compStart: number;
  compEnd: number;
  blendMode: BlendMode;
}

// Transition stored on a clip (referencing transition module types)
export interface TimelineTransition {
  id: string;
  type: string;  // TransitionType from transitions module
  duration: number;  // seconds
  offset?: number;  // seconds relative to the clip junction; positive moves the transition later
  linkedClipId: string;  // ID of the other clip in the transition
  compositionId?: string;  // Optional editable transition composition rendered instead of the recipe
  params?: Record<string, TransitionParamValue>;
}

export interface ClipTransform {
  opacity: number;          // 0-1
  blendMode: BlendMode;
  position: { x: number; y: number; z: number };
  scale: { all?: number; x: number; y: number; z?: number };
  rotation: { x: number; y: number; z: number };  // degrees
}
