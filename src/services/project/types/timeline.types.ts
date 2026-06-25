// Timeline-related types (keyframes, markers, effects, masks, transforms)

import type { AudioEffectParamValue } from '../../../types/audio';
import type { RulerLaneFormat } from '../../../types/timeline';

export interface ProjectTransform {
  x: number;
  y: number;
  z: number;
  scaleAll?: number;
  scaleX: number;
  scaleY: number;
  scaleZ?: number;
  rotation: number;
  rotationX: number;
  rotationY: number;
  anchorX: number;
  anchorY: number;
  opacity: number;
  blendMode: string;
}

export interface ProjectEffect {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  params: Record<string, AudioEffectParamValue>;
}

export interface ProjectMaskVertex {
  x: number;
  y: number;
  inTangent: { x: number; y: number };
  outTangent: { x: number; y: number };
  handleMode?: 'none' | 'mirrored' | 'split';
}

export interface ProjectMaskPathVertex {
  id: string;
  x: number;
  y: number;
  handleIn: { x: number; y: number };
  handleOut: { x: number; y: number };
  handleMode?: 'none' | 'mirrored' | 'split';
}

export interface ProjectMask {
  id: string;
  name: string;
  mode: 'add' | 'subtract' | 'intersect';
  inverted: boolean;
  opacity: number;
  feather: number;
  edgeFeathers?: Record<string, number>;
  featherQuality: number;
  enabled: boolean;
  visible: boolean;
  outlineColor?: string;
  closed: boolean;
  vertices: ProjectMaskVertex[];
  position: { x: number; y: number };
}

export interface ProjectMaskPathKeyframeValue {
  vertices: ProjectMaskPathVertex[];
  closed: boolean;
}

export type ProjectRotationInterpolationMode = 'shortest' | 'continuous';

export interface ProjectKeyframe {
  id: string;
  property: string;
  time: number;
  value: number;
  pathValue?: ProjectMaskPathKeyframeValue;
  easing: string;
  rotationInterpolation?: ProjectRotationInterpolationMode;
  bezierHandles?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface ProjectMarker {
  id: string;
  time: number;
  name: string;
  color: string;
  duration: number;
  stopPlayback?: boolean;
  midiBindings?: import('../../../types/midi').MarkerMIDIBinding[];
}

// ---- Multi-ruler infrastructure (issue #257) ----
// Durable project-tier mirror of the runtime ruler types. Structurally identical
// to the runtime `TempoEvent` / `TempoMap` / `RulerLane`; kept as distinct names
// so the schema tier owns its own shape (matching ProjectMarker vs TimelineMarker).
export interface ProjectTempoEvent {
  time: number; // seconds, sorted ascending; first event is at 0
  bpm: number;
  numerator: number;
  denominator: number;
}

export interface ProjectTempoMap {
  events: ProjectTempoEvent[];
}

export interface ProjectRulerLane {
  id: string;
  format: RulerLaneFormat;
}
