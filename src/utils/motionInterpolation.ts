import type { Keyframe, TimelineClip } from '../types';
import type { MotionLayerDefinition } from '../types/motionDesign';
import { isMotionProperty } from '../types/motionDesign';
import { propertyRegistry } from '../services/properties';
import { interpolateKeyframes } from './keyframeInterpolation';

export function getInterpolatedMotionLayer(
  clip: TimelineClip,
  keyframes: Keyframe[],
  clipLocalTime: number,
): MotionLayerDefinition | undefined {
  if (!clip.motion) {
    return undefined;
  }

  const motionProperties = Array.from(new Set(
    keyframes
      .map((keyframe) => keyframe.property)
      .filter(isMotionProperty),
  ));

  if (motionProperties.length === 0) {
    return clip.motion;
  }

  let workingClip: TimelineClip = {
    ...clip,
    motion: structuredClone(clip.motion),
  };

  for (const property of motionProperties) {
    const descriptor = propertyRegistry.getDescriptor(property, workingClip);
    if (!descriptor?.animatable || descriptor.valueType !== 'number') {
      continue;
    }

    const defaultValue = propertyRegistry.readValue<number>(workingClip, property);
    if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
      continue;
    }

    const value = interpolateKeyframes(keyframes, property, clipLocalTime, defaultValue);
    workingClip = propertyRegistry.writeValue(workingClip, property, value);
  }

  return workingClip.motion;
}
