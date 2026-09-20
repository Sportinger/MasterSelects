import type {
  AnimatableProperty,
  BezierHandle,
  EasingType,
  RotationInterpolationMode,
} from './animationProperties';
import type { MaskPathKeyframeValue } from './masks';

export interface Keyframe {
  /** Materialized linked output; its source curve remains authoritative. */
  animationSource?: { nodeId: string; channelId: string; keyframeId: string };
  hold?: boolean;
  id: string;
  clipId: string;
  time: number;           // Time relative to clip start (seconds)
  property: AnimatableProperty;
  value: number;
  pathValue?: MaskPathKeyframeValue; // Used by mask.{id}.path keyframes
  easing: EasingType;     // Easing for interpolation TO the next keyframe
  rotationInterpolation?: RotationInterpolationMode; // Rotation path for the segment TO the next keyframe
  handleIn?: BezierHandle;   // Bezier control point for curve entering this keyframe
  handleOut?: BezierHandle;  // Bezier control point for curve leaving this keyframe
}
