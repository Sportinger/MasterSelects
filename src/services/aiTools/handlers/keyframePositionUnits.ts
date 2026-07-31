import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types';
import type { PropertyAuthoringContext } from '../../../types/propertyRegistry';
import { propertyRegistry } from '../../properties';
import {
  propertyValueFromStorage,
  propertyValueToStorage,
  resolveClipPropertyAuthoringContext,
  resolveTransformPositionUnitMode,
} from '../../properties/propertyAuthoring';

/**
 * 2D position keyframes are authored in pixels but stored normalized. Native
 * 3D and camera positions stay in scene units, matching TransformTab.
 *
 * The store keeps `transform.position` in normalized units; the properties
 * panel renders them as pixels via `value * (comp / 2)`
 * (`transformTab/transformValues.ts`). `addKeyframe` used to write its raw
 * argument straight into the store, so a keyframe meant as "113 px" landed as
 * normalized 113 and displayed as 61020 px — a factor of `compHeight / 2` off.
 *
 * These helpers use the shared property-authoring codec, so `setTransform`,
 * keyframes, guided validation, and the Properties panel share one boundary.
 */

export function resolveClipPositionAuthoringContext(
  clip: TimelineClip,
): PropertyAuthoringContext {
  const media = useMediaStore.getState();
  const timeline = useTimelineStore.getState();
  const resolution = resolveClipPropertyAuthoringContext({
    clipId: clip.id,
    compositions: media.compositions,
    activeCompositionId: media.activeCompositionId,
    liveClipIds: timeline.clips.map((candidate) => candidate.id),
    positionUnitMode: resolveTransformPositionUnitMode(clip),
  });
  if (!resolution.ok) {
    throw new Error(`Cannot resolve property authoring context: ${resolution.reason}`);
  }
  return resolution.context;
}

function resolveKeyframeAuthoringBoundary(clip: TimelineClip, property: string) {
  const descriptor = propertyRegistry.getDescriptor(property, clip);
  if (!descriptor) return null;
  return {
    descriptor,
    context: descriptor.authoring?.codec === 'transform-position'
      ? resolveClipPositionAuthoringContext(clip)
      : undefined,
  };
}

/** Pixels → normalized, for values on their way into the store. */
export function keyframeValueToStore(
  clip: TimelineClip,
  property: string,
  value: number,
): number {
  const boundary = resolveKeyframeAuthoringBoundary(clip, property);
  if (!boundary) return value;
  const storedValue = propertyValueToStorage(
    boundary.descriptor,
    value,
    boundary.context,
  );
  if (typeof storedValue !== 'number') {
    throw new Error(`${property} did not resolve to a numeric keyframe value`);
  }
  return storedValue;
}

/** Normalized → pixels, for values on their way back to a caller. */
export function keyframeValueFromStore(
  clip: TimelineClip,
  property: string,
  value: number,
): number {
  const boundary = resolveKeyframeAuthoringBoundary(clip, property);
  if (!boundary) return value;
  const authoringValue = propertyValueFromStorage(
    boundary.descriptor,
    value,
    boundary.context,
  );
  if (typeof authoringValue !== 'number') {
    throw new Error(`${property} did not resolve to a numeric keyframe value`);
  }
  return authoringValue;
}

/** True when the property is expressed in pixels at the tool boundary. */
export function isPixelKeyframeProperty(clip: TimelineClip, property: string): boolean {
  const boundary = resolveKeyframeAuthoringBoundary(clip, property);
  return boundary?.context?.positionUnitMode === 'composition-pixels';
}
