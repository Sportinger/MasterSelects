import type { ClipMask, MaskPathKeyframeValue, TextBoundsPath, TimelineClip } from '../../../types';
import type { AnimatableProperty, Keyframe } from '../types';
import {
  cloneTextBoundsPath,
  resolveTextBoundsPath,
} from '../../../services/textLayout';
import { getTimelineGeneratedCanvasRuntimeDimensions } from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import { interpolateKeyframeProgress } from '../../../utils/keyframeInterpolation';
import {
  buildMorphableMaskPaths,
  maskPathsHaveMatchingTopology,
} from './maskPathTopology';

export function cloneMaskPathValue(value: MaskPathKeyframeValue): MaskPathKeyframeValue {
  return {
    closed: value.closed,
    vertices: value.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function applyMaskPathValue(mask: ClipMask, value: MaskPathKeyframeValue): ClipMask {
  return {
    ...mask,
    closed: value.closed,
    vertices: value.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

export function createPathKeyframeTransactionId(prefix: string, clipId: string, property: AnimatableProperty): string {
  return `${prefix}-${clipId}-${property}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function getClipTextBounds(clip: TimelineClip): TextBoundsPath | undefined {
  if (!clip.textProperties) return undefined;
  const { width, height } = getTimelineGeneratedCanvasRuntimeDimensions(clip);
  return clip.textProperties.textBounds
    ? cloneTextBoundsPath(clip.textProperties.textBounds)
    : resolveTextBoundsPath(clip.textProperties, width, height);
}

function lerpValue(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function interpolateMaskPathValue(
  from: MaskPathKeyframeValue,
  to: MaskPathKeyframeValue,
  t: number,
): MaskPathKeyframeValue {
  return {
    closed: t < 1 ? from.closed : to.closed,
    vertices: from.vertices.map((vertex, index) => {
      const nextVertex = to.vertices[index] ?? vertex;
      return {
        ...vertex,
        x: lerpValue(vertex.x, nextVertex.x, t),
        y: lerpValue(vertex.y, nextVertex.y, t),
        handleIn: {
          x: lerpValue(vertex.handleIn.x, nextVertex.handleIn.x, t),
          y: lerpValue(vertex.handleIn.y, nextVertex.handleIn.y, t),
        },
        handleOut: {
          x: lerpValue(vertex.handleOut.x, nextVertex.handleOut.x, t),
          y: lerpValue(vertex.handleOut.y, nextVertex.handleOut.y, t),
        },
        handleMode: t < 1 ? vertex.handleMode : nextVertex.handleMode,
      };
    }),
  };
}

export function getInterpolatedMaskPathValue(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  time: number,
  defaultValue: MaskPathKeyframeValue,
): MaskPathKeyframeValue {
  const pathKeyframes = keyframes
    .filter(keyframe => keyframe.property === property && keyframe.pathValue)
    .toSorted((a, b) => a.time - b.time);

  if (pathKeyframes.length === 0) return defaultValue;
  if (pathKeyframes.length === 1) return cloneMaskPathValue(pathKeyframes[0].pathValue!);
  if (time <= pathKeyframes[0].time) return cloneMaskPathValue(pathKeyframes[0].pathValue!);

  const lastKeyframe = pathKeyframes[pathKeyframes.length - 1];
  if (time >= lastKeyframe.time) return cloneMaskPathValue(lastKeyframe.pathValue!);

  let prevKey = pathKeyframes[0];
  let nextKey = pathKeyframes[1];
  for (let i = 1; i < pathKeyframes.length; i += 1) {
    if (pathKeyframes[i].time >= time) {
      prevKey = pathKeyframes[i - 1];
      nextKey = pathKeyframes[i];
      break;
    }
  }

  const prevPath = prevKey.pathValue;
  const nextPath = nextKey.pathValue;
  if (!prevPath || !nextPath) return defaultValue;
  if (prevKey.hold) return cloneMaskPathValue(time < nextKey.time ? prevPath : nextPath);

  const range = nextKey.time - prevKey.time;
  const localTime = time - prevKey.time;
  const t = range > 0 ? localTime / range : 0;
  const easedT = Math.max(0, Math.min(1, interpolateKeyframeProgress(prevKey, nextKey, t)));
  const morphPaths = maskPathsHaveMatchingTopology(prevPath, nextPath)
    ? { from: prevPath, to: nextPath }
    : buildMorphableMaskPaths(prevPath, nextPath);
  return interpolateMaskPathValue(morphPaths.from, morphPaths.to, easedT);
}
