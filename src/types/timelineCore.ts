import type { BlendMode } from './blendMode';
import type { TransitionParamValue } from '../transitions';

export interface TransitionCompositionLink {
  kind: 'transition-comp';
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
