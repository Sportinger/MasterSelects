import type { ClipMask } from '../../types/masks';
import type { Keyframe } from '../../types/keyframes';
import type { SerializableClip } from '../../types/timeline';
import { getInterpolatedMaskPathValue, getMaskPathValue } from '../../stores/timeline/keyframes/pathKeyframeValues';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { TRANSITION_RENDER_PROGRESS_PROPERTY } from '../../utils/transitionRenderInterpolation';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function makeKeyframe(
  clipId: string,
  property: Keyframe['property'],
  time: number,
  value: number,
  easing: Keyframe['easing'] = 'linear',
): Keyframe {
  return {
    id: `${clipId}:kf:${property}:${time}`,
    clipId,
    property,
    time,
    value,
    easing,
  };
}

export function makeMaskPathKeyframe(
  clipId: string,
  maskId: string,
  time: number,
  vertices: ClipMask['vertices'],
  easing: Keyframe['easing'] = 'linear',
): Keyframe {
  return {
    id: `${clipId}:kf:mask-path:${maskId}:${time}`,
    clipId,
    property: `mask.${maskId}.path` as Keyframe['property'],
    time,
    value: 0,
    easing,
    pathValue: {
      closed: true,
      vertices: vertices.map((vertex) => ({
        ...vertex,
        handleIn: { ...vertex.handleIn },
        handleOut: { ...vertex.handleOut },
      })),
    },
  };
}

export function mergeGeneratedKeyframes(
  base: SerializableClip['keyframes'],
  generated: readonly Keyframe[],
): Keyframe[] {
  const generatedProperties = new Set(generated.map((keyframe) => keyframe.property));
  return [
    ...(base ?? []).filter((keyframe) => !generatedProperties.has(keyframe.property)),
    ...generated,
  ];
}

export function getMaskIdFromPathProperty(property: Keyframe['property']): string | null {
  const match = String(property).match(/^mask\.(.+)\.path$/);
  return match?.[1] ?? null;
}

export function getDefaultNumericKeyframeValue(
  clip: SerializableClip,
  property: Keyframe['property'],
  fallback: number,
): number {
  if (property === 'opacity') return clip.transform.opacity;
  if (property === 'position.x') return clip.transform.position.x;
  if (property === 'position.y') return clip.transform.position.y;
  if (property === 'position.z') return clip.transform.position.z ?? 0;
  if (property === 'scale.x') return clip.transform.scale.x;
  if (property === 'scale.y') return clip.transform.scale.y;
  if (property === 'scale.z') return clip.transform.scale.z ?? 1;
  if (property === 'rotation.x') return clip.transform.rotation.x;
  if (property === 'rotation.y') return clip.transform.rotation.y;
  if (property === 'rotation.z') return clip.transform.rotation.z;
  if (property === TRANSITION_RENDER_PROGRESS_PROPERTY) return clip.transitionRender?.progress ?? fallback;

  const maskPositionMatch = String(property).match(/^mask\.(.+)\.position\.(x|y)$/);
  if (maskPositionMatch) {
    const mask = clip.masks?.find((candidate) => candidate.id === maskPositionMatch[1]);
    return mask?.position?.[maskPositionMatch[2] as 'x' | 'y'] ?? fallback;
  }
  const maskFeatherMatch = String(property).match(/^mask\.(.+)\.(feather|featherQuality)$/);
  if (maskFeatherMatch) {
    const mask = clip.masks?.find((candidate) => candidate.id === maskFeatherMatch[1]);
    return maskFeatherMatch[2] === 'featherQuality'
      ? mask?.featherQuality ?? fallback
      : mask?.feather ?? fallback;
  }
  const effectMatch = String(property).match(/^effect\.(.+)\.([^.]+)$/);
  if (effectMatch) {
    const effect = clip.effects?.find((candidate) => candidate.id === effectMatch[1]);
    const value = effect?.params?.[effectMatch[2]];
    return typeof value === 'number' ? value : fallback;
  }

  return fallback;
}

export function freezeClipKeyframes(
  clip: SerializableClip,
  targetClipId: string,
  sourceLocalTime: number,
  duration: number,
): Keyframe[] | undefined {
  if (!clip.keyframes?.length) return undefined;
  const properties = [...new Set(clip.keyframes.map((keyframe) => keyframe.property))];
  const frozen: Keyframe[] = [];

  for (const property of properties) {
    const propertyKeyframes = clip.keyframes.filter((keyframe) => keyframe.property === property);
    if (propertyKeyframes.length === 0) continue;

    const pathMaskId = getMaskIdFromPathProperty(property);
    const isPathProperty = pathMaskId !== null && propertyKeyframes.some((keyframe) => keyframe.pathValue);
    if (isPathProperty) {
      const mask = clip.masks?.find((candidate) => candidate.id === pathMaskId);
      const defaultPath = mask ? getMaskPathValue(mask) : propertyKeyframes.find((keyframe) => keyframe.pathValue)?.pathValue;
      if (!defaultPath) continue;
      const pathValue = getInterpolatedMaskPathValue([...propertyKeyframes], property, sourceLocalTime, defaultPath);
      frozen.push(
        {
          ...propertyKeyframes[0],
          id: `${targetClipId}:freeze:${property}:start`,
          clipId: targetClipId,
          time: 0,
          easing: 'linear',
          pathValue,
        },
        {
          ...propertyKeyframes[0],
          id: `${targetClipId}:freeze:${property}:end`,
          clipId: targetClipId,
          time: duration,
          easing: 'linear',
          pathValue: clone(pathValue),
        },
      );
      continue;
    }

    const defaultValue = getDefaultNumericKeyframeValue(clip, property, propertyKeyframes[0].value);
    const value = interpolateKeyframes([...propertyKeyframes], property, sourceLocalTime, defaultValue);
    frozen.push(
      {
        ...propertyKeyframes[0],
        id: `${targetClipId}:freeze:${property}:start`,
        clipId: targetClipId,
        time: 0,
        value,
        easing: 'linear',
        pathValue: undefined,
      },
      {
        ...propertyKeyframes[0],
        id: `${targetClipId}:freeze:${property}:end`,
        clipId: targetClipId,
        time: duration,
        value,
        easing: 'linear',
        pathValue: undefined,
      },
    );
  }

  return frozen.toSorted((a, b) => a.time - b.time || String(a.property).localeCompare(String(b.property)));
}

export function sliceGeneratedKeyframesForSegment(
  clip: SerializableClip,
  generated: readonly Keyframe[],
  segmentStart: number,
  segmentDuration: number,
): Keyframe[] {
  if (generated.length === 0) return [];
  const segmentEnd = segmentStart + segmentDuration;
  const properties = [...new Set(generated.map((keyframe) => keyframe.property))];
  const result: Keyframe[] = [];

  for (const property of properties) {
    const propertyKeyframes = generated
      .filter((keyframe) => keyframe.property === property)
      .toSorted((a, b) => a.time - b.time);
    if (propertyKeyframes.length === 0) continue;

    const pathMaskId = getMaskIdFromPathProperty(property);
    const isPathProperty = pathMaskId !== null && propertyKeyframes.some((keyframe) => keyframe.pathValue);
    if (isPathProperty) {
      const mask = clip.masks?.find((candidate) => candidate.id === pathMaskId);
      const defaultPath = mask ? getMaskPathValue(mask) : propertyKeyframes.find((keyframe) => keyframe.pathValue)?.pathValue;
      if (!defaultPath) continue;

      for (const [time, idSuffix] of [[segmentStart, 'start'], [segmentEnd, 'end']] as const) {
        result.push({
          ...propertyKeyframes[0],
          id: `${clip.id}:kf:${property}:${idSuffix}`,
          clipId: clip.id,
          time: idSuffix === 'start' ? 0 : segmentDuration,
          easing: 'linear',
          pathValue: getInterpolatedMaskPathValue([...propertyKeyframes], property, time, defaultPath),
        });
      }
    } else {
      const defaultValue = getDefaultNumericKeyframeValue(clip, property, propertyKeyframes[0].value);
      for (const [time, idSuffix] of [[segmentStart, 'start'], [segmentEnd, 'end']] as const) {
        result.push({
          ...propertyKeyframes[0],
          id: `${clip.id}:kf:${property}:${idSuffix}`,
          clipId: clip.id,
          time: idSuffix === 'start' ? 0 : segmentDuration,
          value: interpolateKeyframes([...propertyKeyframes], property, time, defaultValue),
          easing: 'linear',
          pathValue: undefined,
        });
      }
    }

    for (const keyframe of propertyKeyframes) {
      if (keyframe.time <= segmentStart + 0.000001 || keyframe.time >= segmentEnd - 0.000001) continue;
      result.push({
        ...clone(keyframe),
        id: `${clip.id}:${keyframe.id}`,
        clipId: clip.id,
        time: keyframe.time - segmentStart,
      });
    }
  }

  return result.toSorted((a, b) => a.time - b.time || String(a.property).localeCompare(String(b.property)));
}
