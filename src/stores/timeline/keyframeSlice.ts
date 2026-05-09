// Keyframe-related actions slice

import type { KeyframeActions, SliceCreator, Keyframe, AnimatableProperty, ClipTransform } from './types';
import type { TimelineClip, ClipMask, MaskPathKeyframeValue } from '../../types';
import { parseCameraProperty } from '../../types';
import { useMediaStore } from '../mediaStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS, type SceneCameraSettings } from '../mediaStore/types';
import { DEFAULT_TRANSFORM, PROPERTY_ROW_HEIGHT, MIN_CURVE_EDITOR_HEIGHT, MAX_CURVE_EDITOR_HEIGHT } from './constants';
import {
  compileRuntimeColorGrade,
  createMaskPathProperty,
  ensureColorCorrectionState,
  parseColorProperty,
  parseMaskProperty,
  setColorNodeParamValue,
} from '../../types';
import {
  getInterpolatedClipTransform,
  getInterpolatedClipCameraSettings,
  getKeyframeAtTime,
  hasKeyframesForProperty,
  interpolateKeyframeProgress,
  interpolateKeyframes
} from '../../utils/keyframeInterpolation';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  getVectorAnimationInputDefaultValue,
  getVectorAnimationStateIndex,
  getVectorAnimationStateNameAtIndex,
  mergeVectorAnimationSettings,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
  vectorAnimationInputValueToNumber,
  type VectorAnimationClipSettings,
} from '../../types/vectorAnimation';
import { isMotionProperty } from '../../types/motionDesign';
import { propertyRegistry } from '../../services/properties';
import { normalizeEasingType } from '../../utils/easing';
import { composeTransforms } from '../../utils/transformComposition';
import { calculateSourceTime, getSpeedAtTime, calculateTimelineDuration } from '../../utils/speedIntegration';
import { dispatchKeyframeRecordingFeedback } from '../../utils/keyframeRecordingFeedback';

type MaskPathVertex = MaskPathKeyframeValue['vertices'][number];

function findClipById(clips: TimelineClip[], clipId: string): TimelineClip | undefined {
  for (const clip of clips) {
    if (clip.id === clipId) {
      return clip;
    }
    if (clip.nestedClips?.length) {
      const nestedClip = findClipById(clip.nestedClips, clipId);
      if (nestedClip) {
        return nestedClip;
      }
    }
  }
  return undefined;
}

function normalizeCameraSettingValue(
  key: keyof SceneCameraSettings,
  value: number,
  currentSettings: SceneCameraSettings,
): number {
  if (key === 'fov') {
    return Math.max(10, Math.min(140, value));
  }
  if (key === 'near') {
    return Math.max(0.001, value);
  }
  if (key === 'far') {
    return Math.max(currentSettings.near + 0.1, value);
  }
  return Math.max(1, Math.round(value));
}

function buildCameraSettingsPatch(
  currentSettings: SceneCameraSettings | undefined,
  key: keyof SceneCameraSettings,
  value: number,
): SceneCameraSettings {
  const base = {
    ...DEFAULT_SCENE_CAMERA_SETTINGS,
    ...currentSettings,
  };
  const next = {
    ...base,
    [key]: normalizeCameraSettingValue(key, value, base),
  };

  if (key === 'near' && next.far <= next.near) {
    next.far = next.near + 0.1;
  }

  return next;
}

function getVectorAnimationInputBaseValue(
  clip: TimelineClip,
  settings: VectorAnimationClipSettings,
  stateMachineName: string,
  inputName: string,
): number {
  const explicitValue = settings.stateMachineInputValues?.[inputName];
  if (explicitValue !== undefined) {
    return vectorAnimationInputValueToNumber(explicitValue);
  }

  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  const input = mediaFileId
    ? useMediaStore
        .getState()
        .files
        .find((file) => file.id === mediaFileId)
        ?.vectorAnimation
        ?.stateMachineInputs
        ?.[stateMachineName]
        ?.find((candidate) => candidate.name === inputName)
    : undefined;

  return input
    ? vectorAnimationInputValueToNumber(getVectorAnimationInputDefaultValue(input))
    : 0;
}

function getVectorAnimationStateNames(
  clip: TimelineClip,
  stateMachineName: string,
): string[] {
  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) {
    return [];
  }

  return useMediaStore
    .getState()
    .files
    .find((file) => file.id === mediaFileId)
    ?.vectorAnimation
    ?.stateMachineStates
    ?.[stateMachineName] ?? [];
}

function getVectorAnimationStateBaseValue(
  clip: TimelineClip,
  settings: VectorAnimationClipSettings,
  stateMachineName: string,
): number {
  return getVectorAnimationStateIndex(
    getVectorAnimationStateNames(clip, stateMachineName),
    settings.stateMachineState,
  );
}

function normalizeVectorAnimationStateKeyframeValue(
  clip: TimelineClip,
  stateMachineName: string,
  value: number,
): number {
  const stateNames = getVectorAnimationStateNames(clip, stateMachineName);
  if (stateNames.length === 0) {
    return Math.max(0, Math.round(value));
  }
  return Math.max(0, Math.min(stateNames.length - 1, Math.round(value)));
}

function getSteppedKeyframeValue(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  clipLocalTime: number,
  baseValue: number,
): number {
  const sorted = keyframes
    .filter((keyframe) => keyframe.property === property)
    .sort((a, b) => a.time - b.time);
  let currentValue = baseValue;

  for (const keyframe of sorted) {
    if (keyframe.time > clipLocalTime + 1e-6) {
      break;
    }
    currentValue = keyframe.value;
  }

  return currentValue;
}

function cloneMaskPathValue(value: MaskPathKeyframeValue): MaskPathKeyframeValue {
  return {
    closed: value.closed,
    vertices: value.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

function applyMaskPathValue(mask: ClipMask, value: MaskPathKeyframeValue): ClipMask {
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

function cloneMaskVertex(vertex: MaskPathVertex): MaskPathVertex {
  return {
    ...vertex,
    handleIn: { ...vertex.handleIn },
    handleOut: { ...vertex.handleOut },
  };
}

function maskPathsHaveMatchingTopology(
  from: MaskPathKeyframeValue,
  to: MaskPathKeyframeValue,
): boolean {
  if (from.vertices.length !== to.vertices.length) return false;
  return from.vertices.every((vertex, index) => vertex.id === to.vertices[index]?.id);
}

function collapseMaskVertexToAnchor(vertex: MaskPathVertex, anchor: MaskPathVertex): MaskPathVertex {
  return {
    ...vertex,
    x: anchor.x,
    y: anchor.y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

function getWrappedTopologyIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

function getTopologyRunIndices(startIndex: number, endIndex: number, count: number): number[] {
  const indices: number[] = [];
  let index = getWrappedTopologyIndex(startIndex + 1, count);
  while (index !== endIndex) {
    indices.push(index);
    index = getWrappedTopologyIndex(index + 1, count);
  }
  return indices;
}

function getPointDistance(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function getTopologyRatios(topologyVertices: MaskPathVertex[], segmentIndices: number[]): number[] {
  if (segmentIndices.length < 3) return [];

  const distances: number[] = [];
  let total = 0;
  for (let index = 1; index < segmentIndices.length; index += 1) {
    const prev = topologyVertices[segmentIndices[index - 1]];
    const next = topologyVertices[segmentIndices[index]];
    const distance = getPointDistance(prev, next);
    distances.push(distance);
    total += distance;
  }

  if (total <= 1e-9) {
    return segmentIndices.slice(1, -1).map((_, index) => (index + 1) / (segmentIndices.length - 1));
  }

  let cumulative = 0;
  return distances.slice(0, -1).map(distance => {
    cumulative += distance;
    return cumulative / total;
  });
}

function cubicPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

function cubicDerivative(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
    y: 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y),
  };
}

function getSourceSegmentControls(fromVertex: MaskPathVertex, toVertex: MaskPathVertex) {
  return {
    p0: { x: fromVertex.x, y: fromVertex.y },
    p1: { x: fromVertex.x + fromVertex.handleOut.x, y: fromVertex.y + fromVertex.handleOut.y },
    p2: { x: toVertex.x + toVertex.handleIn.x, y: toVertex.y + toVertex.handleIn.y },
    p3: { x: toVertex.x, y: toVertex.y },
  };
}

function applySplitSourceSegment(
  outputVertices: MaskPathVertex[],
  topologyVertices: MaskPathVertex[],
  sourceVerticesById: Map<string, MaskPathVertex>,
  segmentIndices: number[],
): void {
  if (segmentIndices.length < 3) return;

  const startVertex = sourceVerticesById.get(topologyVertices[segmentIndices[0]].id);
  const endVertex = sourceVerticesById.get(topologyVertices[segmentIndices[segmentIndices.length - 1]].id);
  if (!startVertex || !endVertex) return;

  const controls = getSourceSegmentControls(startVertex, endVertex);
  const ratios = getTopologyRatios(topologyVertices, segmentIndices);
  const breakpoints = [0, ...ratios, 1];

  for (let index = 1; index < segmentIndices.length - 1; index += 1) {
    const point = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, breakpoints[index]);
    const vertexIndex = segmentIndices[index];
    outputVertices[vertexIndex] = {
      ...outputVertices[vertexIndex],
      x: point.x,
      y: point.y,
      handleIn: { x: 0, y: 0 },
      handleOut: { x: 0, y: 0 },
      handleMode: 'split',
    };
  }

  for (let index = 0; index < segmentIndices.length - 1; index += 1) {
    const fromIndex = segmentIndices[index];
    const toIndex = segmentIndices[index + 1];
    const t0 = breakpoints[index];
    const t1 = breakpoints[index + 1];
    const dt = t1 - t0;
    const fromPoint = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, t0);
    const toPoint = cubicPoint(controls.p0, controls.p1, controls.p2, controls.p3, t1);
    const fromDerivative = cubicDerivative(controls.p0, controls.p1, controls.p2, controls.p3, t0);
    const toDerivative = cubicDerivative(controls.p0, controls.p1, controls.p2, controls.p3, t1);

    outputVertices[fromIndex] = {
      ...outputVertices[fromIndex],
      handleOut: {
        x: (fromDerivative.x * dt) / 3,
        y: (fromDerivative.y * dt) / 3,
      },
    };
    outputVertices[toIndex] = {
      ...outputVertices[toIndex],
      handleIn: {
        x: -(toDerivative.x * dt) / 3,
        y: -(toDerivative.y * dt) / 3,
      },
      x: toPoint.x,
      y: toPoint.y,
    };

    if (index === 0) {
      outputVertices[fromIndex] = {
        ...outputVertices[fromIndex],
        x: fromPoint.x,
        y: fromPoint.y,
      };
    }
  }
}

function applyCollapsedTopologyRuns(
  outputVertices: MaskPathVertex[],
  topologyVertices: MaskPathVertex[],
  sourceVerticesById: Map<string, MaskPathVertex>,
  closed: boolean,
): void {
  const existingIndices = topologyVertices
    .map((vertex, index) => sourceVerticesById.has(vertex.id) ? index : -1)
    .filter(index => index >= 0);

  if (existingIndices.length === 0) return;
  if (existingIndices.length === 1) {
    const anchor = sourceVerticesById.get(topologyVertices[existingIndices[0]].id);
    if (!anchor) return;
    outputVertices.forEach((vertex, index) => {
      if (!sourceVerticesById.has(vertex.id)) {
        outputVertices[index] = collapseMaskVertexToAnchor(vertex, anchor);
      }
    });
    return;
  }

  for (let index = 0; index < existingIndices.length - 1; index += 1) {
    const segmentIndices = [existingIndices[index], ...getTopologyRunIndices(existingIndices[index], existingIndices[index + 1], topologyVertices.length), existingIndices[index + 1]];
    applySplitSourceSegment(outputVertices, topologyVertices, sourceVerticesById, segmentIndices);
  }

  if (closed) {
    const firstIndex = existingIndices[0];
    const lastIndex = existingIndices[existingIndices.length - 1];
    const segmentIndices = [lastIndex, ...getTopologyRunIndices(lastIndex, firstIndex, topologyVertices.length), firstIndex];
    applySplitSourceSegment(outputVertices, topologyVertices, sourceVerticesById, segmentIndices);
  }
}

function buildMaskPathForTopology(
  source: MaskPathKeyframeValue,
  topology: MaskPathKeyframeValue,
): MaskPathKeyframeValue {
  const sourceVerticesById = new Map(source.vertices.map(vertex => [vertex.id, vertex]));
  const fallbackAnchor = source.vertices[0] ?? topology.vertices[0];
  const vertices = topology.vertices.map((topologyVertex) => {
    const sourceVertex = sourceVerticesById.get(topologyVertex.id);
    return sourceVertex
      ? cloneMaskVertex(sourceVertex)
      : collapseMaskVertexToAnchor(topologyVertex, fallbackAnchor ?? topologyVertex);
  });

  applyCollapsedTopologyRuns(vertices, topology.vertices, sourceVerticesById, source.closed);

  return {
    closed: source.closed,
    vertices,
  };
}

function buildMorphableMaskPaths(
  from: MaskPathKeyframeValue,
  to: MaskPathKeyframeValue,
): { from: MaskPathKeyframeValue; to: MaskPathKeyframeValue } {
  const topology = to.vertices.length >= from.vertices.length ? to : from;
  return {
    from: buildMaskPathForTopology(from, topology),
    to: buildMaskPathForTopology(to, topology),
  };
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

function getInterpolatedMaskPathValue(
  keyframes: Keyframe[],
  property: AnimatableProperty,
  time: number,
  defaultValue: MaskPathKeyframeValue,
): MaskPathKeyframeValue {
  const pathKeyframes = keyframes
    .filter(keyframe => keyframe.property === property && keyframe.pathValue)
    .sort((a, b) => a.time - b.time);

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

  const range = nextKey.time - prevKey.time;
  const localTime = time - prevKey.time;
  const t = range > 0 ? localTime / range : 0;
  const easedT = Math.max(0, Math.min(1, interpolateKeyframeProgress(prevKey, nextKey, t)));
  const morphPaths = maskPathsHaveMatchingTopology(prevPath, nextPath)
    ? { from: prevPath, to: nextPath }
    : buildMorphableMaskPaths(prevPath, nextPath);
  return interpolateMaskPathValue(morphPaths.from, morphPaths.to, easedT);
}

export const createKeyframeSlice: SliceCreator<KeyframeActions> = (set, get) => ({
  addKeyframe: (clipId, property, value, time, easing = 'linear') => {
    const { clips, playheadPosition, clipKeyframes, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const normalizedEasing = normalizeEasingType(easing, 'linear');
    const vectorAnimationState = parseVectorAnimationStateProperty(property);
    const keyframeValue = vectorAnimationState && clip.source?.type === 'lottie'
      ? normalizeVectorAnimationStateKeyframeValue(clip, vectorAnimationState.stateMachineName, value)
      : value;

    // Calculate time relative to clip start
    const clipLocalTime = time ?? (playheadPosition - clip.startTime);

    // Clamp to clip duration
    const clampedTime = Math.max(0, Math.min(clipLocalTime, clip.duration));

    // Get existing keyframes for this clip
    const existingKeyframes = clipKeyframes.get(clipId) || [];

    // Check if keyframe already exists at this time for this property
    const existingAtTime = getKeyframeAtTime(existingKeyframes, property, clampedTime);

    let newKeyframes: Keyframe[];

    if (existingAtTime) {
      // Update existing keyframe
      newKeyframes = existingKeyframes.map(k =>
        k.id === existingAtTime.id ? { ...k, value: keyframeValue, easing: normalizedEasing } : k
      );
    } else {
      // Create new keyframe
      const newKeyframe: Keyframe = {
        id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        clipId,
        time: clampedTime,
        property,
        value: keyframeValue,
        easing: normalizedEasing,
      };
      newKeyframes = [...existingKeyframes, newKeyframe].sort((a, b) => a.time - b.time);
    }

    // Update state
    const newMap = new Map(clipKeyframes);
    newMap.set(clipId, newKeyframes);
    set({ clipKeyframes: newMap });

    // Invalidate cache since animation changed
    invalidateCache();
  },

  addMaskPathKeyframe: (clipId, maskId, providedPathValue, time, easing = 'linear') => {
    const { clips, playheadPosition, clipKeyframes, invalidateCache } = get();
    const clip = findClipById(clips, clipId);
    const mask = clip?.masks?.find(candidate => candidate.id === maskId);
    if (!clip || !mask) return;

    const property = createMaskPathProperty(maskId);
    const normalizedEasing = normalizeEasingType(easing, 'linear');
    const clipLocalTime = time ?? (playheadPosition - clip.startTime);
    const clampedTime = Math.max(0, Math.min(clipLocalTime, clip.duration));
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const existingAtTime = getKeyframeAtTime(existingKeyframes, property, clampedTime);
    const pathValue = providedPathValue ? cloneMaskPathValue(providedPathValue) : getMaskPathValue(mask);

    const newKeyframes = existingAtTime
      ? existingKeyframes.map(keyframe =>
          keyframe.id === existingAtTime.id
            ? { ...keyframe, value: 0, pathValue, easing: normalizedEasing }
            : keyframe
        )
      : [
          ...existingKeyframes,
          {
            id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            clipId,
            time: clampedTime,
            property,
            value: 0,
            pathValue,
            easing: normalizedEasing,
          },
        ].sort((a, b) => a.time - b.time);

    const newMap = new Map(clipKeyframes);
    newMap.set(clipId, newKeyframes);
    set({ clipKeyframes: newMap });
    invalidateCache();
  },

  recordMaskPathKeyframe: (clipId, maskId) => {
    const property = createMaskPathProperty(maskId);
    const { isRecording, hasKeyframes, addMaskPathKeyframe } = get();
    if (!isRecording(clipId, property) && !hasKeyframes(clipId, property)) return;
    addMaskPathKeyframe(clipId, maskId);
  },

  disableMaskPathKeyframes: (clipId, maskId, pathValue) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, invalidateCache } = get();
    const property = createMaskPathProperty(maskId);
    if (pathValue) {
      set({
        clips: clips.map(clip => {
          if (clip.id !== clipId) return clip;
          return {
            ...clip,
            masks: (clip.masks || []).map(mask =>
              mask.id === maskId ? applyMaskPathValue(mask, pathValue) : mask
            ),
          };
        }),
      });
    }

    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const filtered = existingKeyframes.filter(keyframe => keyframe.property !== property);
    const newMap = new Map(clipKeyframes);
    if (filtered.length > 0) {
      newMap.set(clipId, filtered);
    } else {
      newMap.delete(clipId);
    }

    const newRecording = new Set(keyframeRecordingEnabled);
    newRecording.delete(`${clipId}:${property}`);
    set({ clipKeyframes: newMap, keyframeRecordingEnabled: newRecording });
    invalidateCache();
  },

  removeKeyframe: (keyframeId) => {
    const { clipKeyframes, invalidateCache, selectedKeyframeIds } = get();
    const newMap = new Map<string, Keyframe[]>();

    clipKeyframes.forEach((keyframes, clipId) => {
      const filtered = keyframes.filter(k => k.id !== keyframeId);
      if (filtered.length > 0) {
        newMap.set(clipId, filtered);
      }
    });

    // Remove from selection
    const newSelection = new Set(selectedKeyframeIds);
    newSelection.delete(keyframeId);

    set({ clipKeyframes: newMap, selectedKeyframeIds: newSelection });
    invalidateCache();
  },

  updateKeyframe: (keyframeId, updates) => {
    const { clipKeyframes, clips, invalidateCache } = get();
    const newMap = new Map<string, Keyframe[]>();
    const { easing, ...restUpdates } = updates;
    const baseNormalizedUpdates = easing !== undefined
      ? { ...restUpdates, easing: normalizeEasingType(easing, 'linear') }
      : restUpdates;

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = findClipById(clips, clipId);
      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) {
          return k;
        }

        const vectorAnimationState = parseVectorAnimationStateProperty(k.property);
        const normalizedUpdates = vectorAnimationState && clip?.source?.type === 'lottie' && baseNormalizedUpdates.value !== undefined
          ? {
              ...baseNormalizedUpdates,
              value: normalizeVectorAnimationStateKeyframeValue(
                clip,
                vectorAnimationState.stateMachineName,
                baseNormalizedUpdates.value,
              ),
            }
          : baseNormalizedUpdates;
        return { ...k, ...normalizedUpdates };
      }));
    });

    set({ clipKeyframes: newMap });
    invalidateCache();
  },

  moveKeyframe: (keyframeId, newTime) => {
    const { clipKeyframes, clips, invalidateCache } = get();
    const newMap = new Map<string, Keyframe[]>();

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = clips.find(c => c.id === clipId);
      const maxTime = clip?.duration ?? 999;

      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return { ...k, time: Math.max(0, Math.min(newTime, maxTime)) };
      }).sort((a, b) => a.time - b.time));
    });

    set({ clipKeyframes: newMap });
    invalidateCache();
  },

  moveKeyframes: (keyframeIds, newTime) => {
    if (keyframeIds.length === 0) return;

    const { clipKeyframes, clips, invalidateCache } = get();
    const targetIds = new Set(keyframeIds);
    const newMap = new Map<string, Keyframe[]>();
    let changed = false;

    clipKeyframes.forEach((keyframes, clipId) => {
      const clip = clips.find(c => c.id === clipId);
      const maxTime = clip?.duration ?? 999;
      const clampedTime = Math.max(0, Math.min(newTime, maxTime));
      let clipChanged = false;

      const nextKeyframes = keyframes.map(k => {
        if (!targetIds.has(k.id)) return k;
        if (k.time === clampedTime) return k;
        clipChanged = true;
        changed = true;
        return { ...k, time: clampedTime };
      });

      newMap.set(
        clipId,
        clipChanged
          ? nextKeyframes.sort((a, b) => a.time - b.time)
          : keyframes
      );
    });

    if (!changed) return;

    set({ clipKeyframes: newMap });
    invalidateCache();
  },

  getClipKeyframes: (clipId) => {
    const { clipKeyframes } = get();
    return clipKeyframes.get(clipId) || [];
  },

  getInterpolatedTransform: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes, playheadPosition } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) {
      return { ...DEFAULT_TRANSFORM };
    }

    // Ensure clip.transform exists and has all properties (handles loaded compositions with incomplete data)
    const baseTransform: ClipTransform = {
      opacity: clip.transform?.opacity ?? DEFAULT_TRANSFORM.opacity,
      blendMode: clip.transform?.blendMode ?? DEFAULT_TRANSFORM.blendMode,
      position: {
        x: clip.transform?.position?.x ?? DEFAULT_TRANSFORM.position.x,
        y: clip.transform?.position?.y ?? DEFAULT_TRANSFORM.position.y,
        z: clip.transform?.position?.z ?? DEFAULT_TRANSFORM.position.z,
      },
      scale: {
        ...(clip.transform?.scale?.all !== undefined ? { all: clip.transform.scale.all } : {}),
        x: clip.transform?.scale?.x ?? DEFAULT_TRANSFORM.scale.x,
        y: clip.transform?.scale?.y ?? DEFAULT_TRANSFORM.scale.y,
        ...(clip.transform?.scale?.z !== undefined ? { z: clip.transform.scale.z } : {}),
      },
      rotation: {
        x: clip.transform?.rotation?.x ?? DEFAULT_TRANSFORM.rotation.x,
        y: clip.transform?.rotation?.y ?? DEFAULT_TRANSFORM.rotation.y,
        z: clip.transform?.rotation?.z ?? DEFAULT_TRANSFORM.rotation.z,
      },
    };

    // Get this clip's own transform (with keyframe interpolation)
    const keyframes = clipKeyframes.get(clipId) || [];
    const ownTransform = keyframes.length === 0
      ? baseTransform
      : getInterpolatedClipTransform(keyframes, clipLocalTime, baseTransform, {
          rotationMode: clip.source?.type === 'camera' ? 'shortest' : 'linear',
        });

    // If clip has a parent, compose with parent's transform
    if (clip.parentClipId) {
      const parentClip = clips.find(c => c.id === clip.parentClipId);
      if (parentClip) {
        // Calculate parent's local time based on current playhead position
        const parentLocalTime = playheadPosition - parentClip.startTime;
        // Recursively get parent's composed transform (handles nested parenting)
        const parentTransform = get().getInterpolatedTransform(clip.parentClipId, parentLocalTime);
        return composeTransforms(parentTransform, ownTransform);
      }
    }

    return ownTransform;
  },

  getInterpolatedCameraSettings: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (clip?.source?.type !== 'camera') {
      return { ...DEFAULT_SCENE_CAMERA_SETTINGS };
    }

    const baseSettings: SceneCameraSettings = {
      ...DEFAULT_SCENE_CAMERA_SETTINGS,
      ...clip.source.cameraSettings,
    };
    const keyframes = clipKeyframes.get(clipId) || [];
    return getInterpolatedClipCameraSettings(keyframes, clipLocalTime, baseSettings);
  },

  getInterpolatedEffects: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !clip.effects) {
      return [];
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) {
      return clip.effects;
    }

    // Filter keyframes that are effect keyframes
    const effectKeyframes = keyframes.filter(k => k.property.startsWith('effect.'));

    if (effectKeyframes.length === 0) {
      return clip.effects;
    }

    // Clone effects and apply interpolated values
    return clip.effects.map(effect => {
      const newParams = { ...effect.params };

      // Check each numeric parameter for keyframes
      Object.keys(effect.params).forEach(paramName => {
        if (typeof effect.params[paramName] !== 'number') return;

        const propertyKey = `effect.${effect.id}.${paramName}`;
        const paramKeyframes = effectKeyframes.filter(k => k.property === propertyKey);

        if (paramKeyframes.length > 0) {
          // Interpolate the value
          newParams[paramName] = interpolateKeyframes(
            keyframes,
            propertyKey as AnimatableProperty,
            clipLocalTime,
            effect.params[paramName] as number
          );
        }
      });

      return { ...effect, params: newParams };
    });
  },

  getInterpolatedColorCorrection: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.colorCorrection) {
      return undefined;
    }

    let colorState = ensureColorCorrectionState(clip.colorCorrection);
    const keyframes = clipKeyframes.get(clipId) || [];
    const colorKeyframes = keyframes.filter(k => k.property.startsWith('color.'));

    if (colorKeyframes.length > 0) {
      for (const version of colorState.versions) {
        for (const node of version.nodes) {
          for (const [paramName, baseValue] of Object.entries(node.params)) {
            if (typeof baseValue !== 'number') continue;
            const propertyKey = `color.${version.id}.${node.id}.${paramName}` as AnimatableProperty;
            if (!colorKeyframes.some(k => k.property === propertyKey)) continue;
            const value = interpolateKeyframes(keyframes, propertyKey, clipLocalTime, baseValue);
            colorState = setColorNodeParamValue(colorState, version.id, node.id, paramName, value);
          }
        }
      }
    }

    return compileRuntimeColorGrade(colorState);
  },

  getInterpolatedVectorAnimationSettings: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    const baseSettings = mergeVectorAnimationSettings(clip?.source?.vectorAnimationSettings);
    if (!clip || clip.source?.type !== 'lottie') {
      return baseSettings;
    }

    const activeStateMachineName = baseSettings.stateMachineName;
    if (!activeStateMachineName) {
      return baseSettings;
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    const statePropertyKey = keyframes
      .map((keyframe) => keyframe.property)
      .find((property) => parseVectorAnimationStateProperty(property)?.stateMachineName === activeStateMachineName);
    let stateMachineState = baseSettings.stateMachineState;
    let stateMachineStateCues = baseSettings.stateMachineStateCues;

    if (statePropertyKey) {
      const stateNames = getVectorAnimationStateNames(clip, activeStateMachineName);
      const stateValue = getSteppedKeyframeValue(
        keyframes,
        statePropertyKey,
        clipLocalTime,
        getVectorAnimationStateBaseValue(clip, baseSettings, activeStateMachineName),
      );
      stateMachineState = getVectorAnimationStateNameAtIndex(stateNames, stateValue) ?? stateMachineState;
      stateMachineStateCues = undefined;
    }

    const inputKeyframes = keyframes.filter((keyframe) => {
      const parsed = parseVectorAnimationInputProperty(keyframe.property);
      return parsed?.stateMachineName === activeStateMachineName;
    });

    if (inputKeyframes.length === 0) {
      return {
        ...baseSettings,
        stateMachineState,
        stateMachineStateCues,
      };
    }

    const inputValues = { ...(baseSettings.stateMachineInputValues ?? {}) };
    const inputNames = new Set<string>();
    inputKeyframes.forEach((keyframe) => {
      const parsed = parseVectorAnimationInputProperty(keyframe.property);
      if (parsed) {
        inputNames.add(parsed.inputName);
      }
    });

    inputNames.forEach((inputName) => {
      const property = [...inputKeyframes]
        .map((keyframe) => keyframe.property)
        .find((candidate) => parseVectorAnimationInputProperty(candidate)?.inputName === inputName);
      if (!property) {
        return;
      }

      const baseValue = getVectorAnimationInputBaseValue(
        clip,
        baseSettings,
        activeStateMachineName,
        inputName,
      );
      inputValues[inputName] = interpolateKeyframes(
        keyframes,
        property,
        clipLocalTime,
        baseValue,
      );
    });

    return {
      ...baseSettings,
      stateMachineState,
      stateMachineStateCues,
      stateMachineInputValues: inputValues,
    };
  },

  getInterpolatedMasks: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = findClipById(clips, clipId);
    if (!clip?.masks || clip.masks.length === 0) {
      return clip?.masks;
    }

    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) {
      return clip.masks;
    }

    const maskKeyframes = keyframes.filter(keyframe => keyframe.property.startsWith('mask.'));
    if (maskKeyframes.length === 0) {
      return clip.masks;
    }

    return clip.masks.map(mask => {
      let nextMask: ClipMask = {
        ...mask,
        position: { ...mask.position },
        vertices: mask.vertices.map(vertex => ({
          ...vertex,
          handleIn: { ...vertex.handleIn },
          handleOut: { ...vertex.handleOut },
        })),
      };

      const pathProperty = createMaskPathProperty(mask.id);
      if (maskKeyframes.some(keyframe => keyframe.property === pathProperty && keyframe.pathValue)) {
        nextMask = applyMaskPathValue(
          nextMask,
          getInterpolatedMaskPathValue(maskKeyframes, pathProperty, clipLocalTime, getMaskPathValue(mask)),
        );
      }

      const positionXProperty = `mask.${mask.id}.position.x` as AnimatableProperty;
      const positionYProperty = `mask.${mask.id}.position.y` as AnimatableProperty;
      const featherProperty = `mask.${mask.id}.feather` as AnimatableProperty;
      const featherQualityProperty = `mask.${mask.id}.featherQuality` as AnimatableProperty;

      if (maskKeyframes.some(keyframe => keyframe.property === positionXProperty)) {
        nextMask.position.x = interpolateKeyframes(maskKeyframes, positionXProperty, clipLocalTime, mask.position.x);
      }
      if (maskKeyframes.some(keyframe => keyframe.property === positionYProperty)) {
        nextMask.position.y = interpolateKeyframes(maskKeyframes, positionYProperty, clipLocalTime, mask.position.y);
      }
      if (maskKeyframes.some(keyframe => keyframe.property === featherProperty)) {
        nextMask.feather = Math.max(0, interpolateKeyframes(maskKeyframes, featherProperty, clipLocalTime, mask.feather));
      }
      if (maskKeyframes.some(keyframe => keyframe.property === featherQualityProperty)) {
        nextMask.featherQuality = Math.min(100, Math.max(1, Math.round(
          interpolateKeyframes(maskKeyframes, featherQualityProperty, clipLocalTime, mask.featherQuality ?? 50),
        )));
      }

      return nextMask;
    });
  },

  getInterpolatedSpeed: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return 1;

    const keyframes = clipKeyframes.get(clipId) || [];
    const defaultSpeed = clip.speed ?? 1;

    return getSpeedAtTime(keyframes, clipLocalTime, defaultSpeed);
  },

  getSourceTimeForClip: (clipId, clipLocalTime) => {
    const { clips, clipKeyframes } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return clipLocalTime;

    const keyframes = clipKeyframes.get(clipId) || [];
    const defaultSpeed = clip.speed ?? 1;

    // If no speed keyframes, use simple multiplication
    const speedKeyframes = keyframes.filter(k => k.property === 'speed');
    if (speedKeyframes.length === 0 && defaultSpeed === 1) {
      return clipLocalTime;
    }

    // Calculate integrated source time
    const sourceTime = calculateSourceTime(keyframes, clipLocalTime, defaultSpeed);

    // Handle negative source time (reverse playback)
    return sourceTime;
  },

  hasKeyframes: (clipId, property) => {
    const { clipKeyframes } = get();
    const keyframes = clipKeyframes.get(clipId) || [];
    if (keyframes.length === 0) return false;
    if (!property) return true;
    return hasKeyframesForProperty(keyframes, property);
  },

  // Keyframe recording mode
  toggleKeyframeRecording: (clipId, property) => {
    const { keyframeRecordingEnabled } = get();
    const key = `${clipId}:${property}`;
    const newSet = new Set(keyframeRecordingEnabled);

    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }

    set({ keyframeRecordingEnabled: newSet });
  },

  isRecording: (clipId, property) => {
    const { keyframeRecordingEnabled } = get();
    return keyframeRecordingEnabled.has(`${clipId}:${property}`);
  },

  setPropertyValue: (clipId, property, value) => {
    const { isRecording, addKeyframe, updateClipTransform, updateClipEffect, updateColorNodeParam, updateMask, clips, hasKeyframes, isPlaying } = get();
    const currentClip = clips.find(c => c.id === clipId);
    const cameraPropertyForValue = parseCameraProperty(property);
    const valueForStorage = cameraPropertyForValue && currentClip?.source?.type === 'camera'
      ? normalizeCameraSettingValue(
          cameraPropertyForValue,
          value,
          { ...DEFAULT_SCENE_CAMERA_SETTINGS, ...currentClip.source.cameraSettings },
        )
      : value;

    // Check if this property has keyframes (whether recording or not)
    const propertyHasKeyframes = hasKeyframes(clipId, property);

    if (isRecording(clipId, property) || propertyHasKeyframes) {
      // Recording mode OR property already has keyframes - create/update keyframe
      addKeyframe(clipId, property, valueForStorage);
      if (isPlaying && clips.some(c => c.id === clipId)) {
        dispatchKeyframeRecordingFeedback(clipId, property);
      }
      // Also update clip.speed and recalculate duration
      if (property === 'speed') {
        const { invalidateCache, clipKeyframes, updateDuration } = get();
        const clip = clips.find(c => c.id === clipId);
        if (clip) {
          const keyframes = clipKeyframes.get(clipId) || [];
          const sourceDuration = clip.outPoint - clip.inPoint;
          const newDuration = calculateTimelineDuration(keyframes, sourceDuration, value);
          set({
            clips: clips.map(c => c.id === clipId ? { ...c, speed: value, duration: newDuration } : c)
          });
          updateDuration(); // Update timeline duration
        }
        invalidateCache();
      }
    } else {
      // Not recording and no keyframes - update static value
      const clip = clips.find(c => c.id === clipId);
      if (!clip) return;

      const vectorAnimationState = parseVectorAnimationStateProperty(property);
      if (vectorAnimationState && clip.source?.type === 'lottie') {
        const currentSettings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
        const normalizedValue = normalizeVectorAnimationStateKeyframeValue(
          clip,
          vectorAnimationState.stateMachineName,
          value,
        );
        const stateName = getVectorAnimationStateNameAtIndex(
          getVectorAnimationStateNames(clip, vectorAnimationState.stateMachineName),
          normalizedValue,
        );
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...c.source.vectorAnimationSettings,
                stateMachineName: currentSettings.stateMachineName ?? vectorAnimationState.stateMachineName,
                stateMachineState: stateName ?? currentSettings.stateMachineState,
                stateMachineStateCues: undefined,
              },
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const vectorAnimationInput = parseVectorAnimationInputProperty(property);
      if (vectorAnimationInput && clip.source?.type === 'lottie') {
        const currentSettings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
        const inputValues = {
          ...(currentSettings.stateMachineInputValues ?? {}),
          [vectorAnimationInput.inputName]: value,
        };
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              vectorAnimationSettings: {
                ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                ...c.source.vectorAnimationSettings,
                stateMachineName: currentSettings.stateMachineName ?? vectorAnimationInput.stateMachineName,
                stateMachineInputValues: inputValues,
              },
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      const maskProperty = parseMaskProperty(property);
      if (maskProperty && maskProperty.property !== 'path') {
        const mask = clip.masks?.find(candidate => candidate.id === maskProperty.maskId);
        if (!mask) return;

        if (maskProperty.property === 'position.x') {
          updateMask(clipId, mask.id, { position: { ...mask.position, x: value } });
        } else if (maskProperty.property === 'position.y') {
          updateMask(clipId, mask.id, { position: { ...mask.position, y: value } });
        } else if (maskProperty.property === 'feather') {
          updateMask(clipId, mask.id, { feather: Math.max(0, value) });
        } else if (maskProperty.property === 'featherQuality') {
          updateMask(clipId, mask.id, { featherQuality: Math.min(100, Math.max(1, Math.round(value))) });
        }
        return;
      }

      const cameraProperty = parseCameraProperty(property);
      if (cameraProperty && clip.source?.type === 'camera') {
        set({
          clips: clips.map(c => c.id === clipId ? {
            ...c,
            source: c.source ? {
              ...c.source,
              cameraSettings: buildCameraSettingsPatch(c.source.cameraSettings, cameraProperty, valueForStorage),
            } : c.source,
          } : c),
        });
        get().invalidateCache();
        return;
      }

      // Handle effect properties (format: effect.{effectId}.{paramName})
      if (property.startsWith('effect.')) {
        const parts = property.split('.');
        if (parts.length === 3) {
          const effectId = parts[1];
          const paramName = parts[2];
          updateClipEffect(clipId, effectId, { [paramName]: value });
        }
        return;
      }

      const colorProperty = parseColorProperty(property);
      if (colorProperty) {
        updateColorNodeParam(
          clipId,
          colorProperty.versionId,
          colorProperty.nodeId,
          colorProperty.paramName,
          value
        );
        return;
      }

      if (isMotionProperty(property)) {
        const descriptor = propertyRegistry.getDescriptor(property, clip);
        if (descriptor?.write) {
          const nextClip = propertyRegistry.writeValue(clip, property, value);
          set({
            clips: clips.map(c => c.id === clipId ? nextClip : c),
          });
          get().invalidateCache();
        }
        return;
      }

      // Handle speed property (directly on clip, not transform)
      if (property === 'speed') {
        const { invalidateCache, updateDuration } = get();
        const sourceDuration = clip.outPoint - clip.inPoint;
        // For constant speed (no keyframes): duration = sourceDuration / |speed|
        const absSpeed = Math.abs(value) || 0.01; // Avoid division by zero
        const newDuration = sourceDuration / absSpeed;
        set({
          clips: clips.map(c => c.id === clipId ? { ...c, speed: value, duration: newDuration } : c)
        });
        updateDuration(); // Update timeline duration
        invalidateCache();
        return;
      }

      // Build partial transform update from property path
      const transformUpdate: Partial<ClipTransform> = {};

      if (property === 'opacity') {
        transformUpdate.opacity = value;
      } else if (property.startsWith('position.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        transformUpdate.position = { ...clip.transform.position, [axis]: value };
      } else if (property.startsWith('scale.')) {
        const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
        transformUpdate.scale = { ...clip.transform.scale, [axis]: value };
      } else if (property.startsWith('rotation.')) {
        const axis = property.split('.')[1] as 'x' | 'y' | 'z';
        transformUpdate.rotation = { ...clip.transform.rotation, [axis]: value };
      }

      updateClipTransform(clipId, transformUpdate);
    }
  },

  // Keyframe UI state - Track-based expansion
  toggleTrackExpanded: (trackId) => {
    const { expandedTracks } = get();
    const newSet = new Set(expandedTracks);

    if (newSet.has(trackId)) {
      newSet.delete(trackId);
    } else {
      newSet.add(trackId);
    }

    set({ expandedTracks: newSet });
  },

  isTrackExpanded: (trackId) => {
    const { expandedTracks } = get();
    return expandedTracks.has(trackId);
  },

  toggleTrackPropertyGroupExpanded: (trackId, groupName) => {
    const { expandedTrackPropertyGroups } = get();
    const newMap = new Map(expandedTrackPropertyGroups);
    const trackGroups = newMap.get(trackId) || new Set<string>();
    const newTrackGroups = new Set(trackGroups);

    if (newTrackGroups.has(groupName)) {
      newTrackGroups.delete(groupName);
    } else {
      newTrackGroups.add(groupName);
    }

    newMap.set(trackId, newTrackGroups);
    set({ expandedTrackPropertyGroups: newMap });
  },

  isTrackPropertyGroupExpanded: (trackId, groupName) => {
    const { expandedTrackPropertyGroups } = get();
    const trackGroups = expandedTrackPropertyGroups.get(trackId);
    return trackGroups?.has(groupName) ?? false;
  },

  // Calculate expanded track height based on visible property rows
  getExpandedTrackHeight: (trackId, baseHeight) => {
    const { expandedTracks, expandedCurveProperties, clips, selectedClipIds, clipKeyframes } = get();

    if (!expandedTracks.has(trackId)) {
      return baseHeight;
    }

    // Get the selected clip in this track
    const trackClips = clips.filter(c => c.trackId === trackId);
    const selectedTrackClip = trackClips.find(c => selectedClipIds.has(c.id));

    // If no clip is selected in this track, no property rows
    if (!selectedTrackClip) {
      return baseHeight;
    }

    const clipId = selectedTrackClip.id;
    const keyframes = clipKeyframes.get(clipId) || [];

    // If no keyframes at all, no property rows
    if (keyframes.length === 0) {
      return baseHeight;
    }

    // Flattened display: count unique properties with keyframes
    const uniqueProperties = new Set(keyframes.map(k => k.property));
    const showsCamera3DProps =
      selectedTrackClip.source?.type === 'camera';
    // Hide 3D-only properties when clip is not 3D
    if (!selectedTrackClip.is3D && !showsCamera3DProps) {
      uniqueProperties.delete('rotation.x');
      uniqueProperties.delete('rotation.y');
      uniqueProperties.delete('position.z');
      uniqueProperties.delete('scale.z');
    }
    let extraHeight = uniqueProperties.size * PROPERTY_ROW_HEIGHT;

    // Add curve editor height for expanded properties
    const trackCurveProps = expandedCurveProperties.get(trackId);
    if (trackCurveProps) {
      trackCurveProps.forEach(prop => {
        if (uniqueProperties.has(prop)) {
          extraHeight += get().curveEditorHeight;
        }
      });
    }

    return baseHeight + extraHeight;
  },

  // Check if any clip on a track has keyframes
  trackHasKeyframes: (trackId) => {
    const { clips, clipKeyframes } = get();
    const trackClips = clips.filter(c => c.trackId === trackId);
    return trackClips.some(clip => {
      const kfs = clipKeyframes.get(clip.id);
      return kfs && kfs.length > 0;
    });
  },

  // Curve editor expansion
  toggleCurveExpanded: (trackId, property) => {
    const { expandedCurveProperties } = get();
    const isCurrentlyExpanded = expandedCurveProperties.get(trackId)?.has(property) ?? false;

    // Only one curve editor open at a time: close all, then open the new one
    const newMap = new Map<string, Set<AnimatableProperty>>();

    if (!isCurrentlyExpanded) {
      newMap.set(trackId, new Set([property]));
    }
    // If toggling off the currently open one, newMap stays empty (all closed)

    set({ expandedCurveProperties: newMap });
  },

  isCurveExpanded: (trackId, property) => {
    const { expandedCurveProperties } = get();
    const trackProps = expandedCurveProperties.get(trackId);
    return trackProps?.has(property) ?? false;
  },

  setCurveEditorHeight: (height) => {
    set({ curveEditorHeight: Math.round(Math.max(MIN_CURVE_EDITOR_HEIGHT, Math.min(MAX_CURVE_EDITOR_HEIGHT, height))) });
  },

  // Disable keyframes for a property: save current value as static, remove all keyframes, disable recording
  disablePropertyKeyframes: (clipId, property, currentValue) => {
    const { clips, clipKeyframes, keyframeRecordingEnabled, invalidateCache, updateClipTransform, updateClipEffect, updateColorNodeParam, updateMask } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    // 1. Write current value to base clip value (same logic as setPropertyValue static path)
    const vectorAnimationState = parseVectorAnimationStateProperty(property);
    if (vectorAnimationState && clip.source?.type === 'lottie') {
      const stateName = getVectorAnimationStateNameAtIndex(
        getVectorAnimationStateNames(clip, vectorAnimationState.stateMachineName),
        currentValue,
      );
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            vectorAnimationSettings: {
              ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
              ...c.source.vectorAnimationSettings,
              stateMachineName: c.source.vectorAnimationSettings?.stateMachineName ?? vectorAnimationState.stateMachineName,
              stateMachineState: stateName ?? c.source.vectorAnimationSettings?.stateMachineState,
              stateMachineStateCues: undefined,
            },
          } : c.source,
        } : c),
      });
    } else {
      const vectorAnimationInput = parseVectorAnimationInputProperty(property);
      if (vectorAnimationInput && clip.source?.type === 'lottie') {
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            vectorAnimationSettings: {
              ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
              ...c.source.vectorAnimationSettings,
              stateMachineInputValues: {
                ...(c.source.vectorAnimationSettings?.stateMachineInputValues ?? {}),
                [vectorAnimationInput.inputName]: currentValue,
              },
            },
          } : c.source,
        } : c),
      });
      } else if (parseCameraProperty(property) && clip.source?.type === 'camera') {
      const cameraProperty = parseCameraProperty(property)!;
      set({
        clips: get().clips.map(c => c.id === clipId ? {
          ...c,
          source: c.source ? {
            ...c.source,
            cameraSettings: buildCameraSettingsPatch(c.source.cameraSettings, cameraProperty, currentValue),
          } : c.source,
        } : c),
      });
      } else if (property.startsWith('effect.')) {
      const parts = property.split('.');
      if (parts.length === 3) {
        const effectId = parts[1];
        const paramName = parts[2];
        updateClipEffect(clipId, effectId, { [paramName]: currentValue });
      }
    } else if (parseMaskProperty(property)) {
      const maskProperty = parseMaskProperty(property)!;
      const mask = clip.masks?.find(candidate => candidate.id === maskProperty.maskId);
      if (mask && maskProperty.property !== 'path') {
        if (maskProperty.property === 'position.x') {
          updateMask(clipId, mask.id, { position: { ...mask.position, x: currentValue } });
        } else if (maskProperty.property === 'position.y') {
          updateMask(clipId, mask.id, { position: { ...mask.position, y: currentValue } });
        } else if (maskProperty.property === 'feather') {
          updateMask(clipId, mask.id, { feather: Math.max(0, currentValue) });
        } else if (maskProperty.property === 'featherQuality') {
          updateMask(clipId, mask.id, { featherQuality: Math.min(100, Math.max(1, Math.round(currentValue))) });
        }
      }
    } else if (parseColorProperty(property)) {
      const colorProperty = parseColorProperty(property)!;
      updateColorNodeParam(
        clipId,
        colorProperty.versionId,
        colorProperty.nodeId,
        colorProperty.paramName,
        currentValue
      );
    } else if (isMotionProperty(property)) {
      const descriptor = propertyRegistry.getDescriptor(property, clip);
      if (descriptor?.write) {
        const nextClip = propertyRegistry.writeValue(clip, property, currentValue);
        set({
          clips: get().clips.map(c => c.id === clipId ? nextClip : c),
        });
      }
    } else if (property === 'speed') {
      const { updateDuration } = get();
      const sourceDuration = clip.outPoint - clip.inPoint;
      const absSpeed = Math.abs(currentValue) || 0.01;
      const newDuration = sourceDuration / absSpeed;
      set({
        clips: get().clips.map(c => c.id === clipId ? { ...c, speed: currentValue, duration: newDuration } : c)
      });
      updateDuration();
    } else if (property === 'opacity') {
      updateClipTransform(clipId, { opacity: currentValue });
    } else if (property.startsWith('position.')) {
      const axis = property.split('.')[1] as 'x' | 'y' | 'z';
      updateClipTransform(clipId, { position: { ...clip.transform.position, [axis]: currentValue } });
    } else if (property.startsWith('scale.')) {
      const axis = property.split('.')[1] as 'all' | 'x' | 'y' | 'z';
      updateClipTransform(clipId, { scale: { ...clip.transform.scale, [axis]: currentValue } });
    } else if (property.startsWith('rotation.')) {
      const axis = property.split('.')[1] as 'x' | 'y' | 'z';
      updateClipTransform(clipId, { rotation: { ...clip.transform.rotation, [axis]: currentValue } });
      }
    }

    // 2. Remove all keyframes for this property
    const existingKeyframes = clipKeyframes.get(clipId) || [];
    const filtered = existingKeyframes.filter(k => k.property !== property);
    const newMap = new Map(clipKeyframes);
    if (filtered.length > 0) {
      newMap.set(clipId, filtered);
    } else {
      newMap.delete(clipId);
    }

    // 3. Disable recording
    const newRecording = new Set(keyframeRecordingEnabled);
    newRecording.delete(`${clipId}:${property}`);

    set({ clipKeyframes: newMap, keyframeRecordingEnabled: newRecording });
    invalidateCache();
  },

  // Bezier handle manipulation
  updateBezierHandle: (keyframeId, handle, position) => {
    const { clipKeyframes, invalidateCache } = get();
    const newMap = new Map<string, Keyframe[]>();

    clipKeyframes.forEach((keyframes, clipId) => {
      newMap.set(clipId, keyframes.map(k => {
        if (k.id !== keyframeId) return k;
        return {
          ...k,
          easing: 'bezier' as const,
          [handle === 'in' ? 'handleIn' : 'handleOut']: position,
        };
      }));
    });

    set({ clipKeyframes: newMap });
    invalidateCache();
  },
});
