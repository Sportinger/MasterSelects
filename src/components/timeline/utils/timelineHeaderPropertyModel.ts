import type { AnimatableProperty, ClipMask, ClipTransform, Keyframe } from '../../../types';
import { parseCameraProperty, parseMaskProperty } from '../../../types';
import { getMaskEdgeFeather } from '../../../utils/maskEdgeFeathers';
import {
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../../stores/mediaStore/types';
import {
  formatEqFrequencyLabel,
  getAudioEqPropertyMeta,
  getDefaultAudioEqTimelineValue,
  getValueFromEffects,
} from './timelineHeaderAudioEqPropertyModel';
import {
  getTimelineHeaderColorPropertyMeta,
  getTimelineHeaderColorPropertyValue,
} from './timelineHeaderColorPropertyModel';
import {
  formatTimelineHeaderVectorAnimationPropertyValue,
  getTimelineHeaderVectorAnimationPropertyValue,
} from './timelineHeaderVectorPropertyModel';
import { type HeaderKeyframe, type KeyframeTrackClip, usesCameraPropertyModel } from './timelineHeaderPropertyTypes';

export { getHeaderPropertyLabel, sortTimelineHeaderProperties } from './timelineHeaderPropertyLabels';
export { type HeaderKeyframe, type KeyframeTrackClip, shouldHide3DOnlyProperties, usesCameraPropertyModel } from './timelineHeaderPropertyTypes';

export function getMaskPathValue(mask: ClipMask): NonNullable<Keyframe['pathValue']> {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

function getValueFromTransform(transform: ClipTransform, prop: string): number {
  switch (prop) {
    case 'opacity': return transform.opacity;
    case 'position.x': return transform.position.x;
    case 'position.y': return transform.position.y;
    case 'position.z': return transform.position.z;
    case 'scale.all': return transform.scale.all ?? 1;
    case 'scale.x': return transform.scale.x;
    case 'scale.y': return transform.scale.y;
    case 'scale.z': return transform.scale.z ?? 0;
    case 'rotation.x': return transform.rotation.x;
    case 'rotation.y': return transform.rotation.y;
    case 'rotation.z': return transform.rotation.z;
    default: return 0;
  }
}

function getValueFromMaskProperty(
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: HeaderKeyframe[],
  clipLocalTime: number,
): number | null {
  const maskProperty = parseMaskProperty(prop);
  if (!maskProperty) return null;
  if (maskProperty.property === 'path') return 0;

  const mask = clip.masks?.find(candidate => candidate.id === maskProperty.maskId);
  if (!mask) return 0;

  const baseValue = maskProperty.property === 'position.x'
    ? mask.position.x
    : maskProperty.property === 'position.y'
      ? mask.position.y
      : maskProperty.property === 'feather'
        ? mask.feather
        : maskProperty.property === 'edgeFeather'
          ? getMaskEdgeFeather(mask, maskProperty.edgeId)
          : mask.featherQuality ?? 50;

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
}

function getValueFromCameraProperty(
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: HeaderKeyframe[],
  clipLocalTime: number,
): number | null {
  const cameraProperty = parseCameraProperty(prop);
  if (!cameraProperty || clip.source?.type !== 'camera') return null;

  const baseSettings = {
    ...DEFAULT_SCENE_CAMERA_SETTINGS,
    ...clip.source.cameraSettings,
  };
  const baseValue = baseSettings[cameraProperty] ??
    (cameraProperty === 'resolutionWidth' ? 1920 : cameraProperty === 'resolutionHeight' ? 1080 : 0);

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
}

export function getHeaderPropertyCurrentValue({
  clip,
  clipId,
  clipLocalTime,
  getInterpolatedEffects,
  getInterpolatedTransform,
  isWithinClip,
  keyframes,
  prop,
}: {
  clip: KeyframeTrackClip;
  clipId: string;
  clipLocalTime: number;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  isWithinClip: boolean;
  keyframes: HeaderKeyframe[];
  prop: string;
}): number {
  if (!isWithinClip) return 0;
  if (prop.startsWith('effect.')) {
    return getValueFromEffects(getInterpolatedEffects(clipId, clipLocalTime), prop);
  }

  const colorValue = getTimelineHeaderColorPropertyValue(clip, prop, keyframes, clipLocalTime);
  if (colorValue !== null) return colorValue;
  const vectorValue = getTimelineHeaderVectorAnimationPropertyValue(clip, prop, keyframes, clipLocalTime);
  if (vectorValue !== null) return vectorValue;
  const maskValue = getValueFromMaskProperty(clip, prop, keyframes, clipLocalTime);
  if (maskValue !== null) return maskValue;
  const cameraValue = getValueFromCameraProperty(clip, prop, keyframes, clipLocalTime);
  if (cameraValue !== null) return cameraValue;
  return getValueFromTransform(getInterpolatedTransform(clipId, clipLocalTime), prop);
}

export function getHeaderPropertySensitivity(prop: string, clip: KeyframeTrackClip): number {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty?.property === 'path') return 0;
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return 0.001;
  if (maskProperty?.property === 'feather' || maskProperty?.property === 'edgeFeather') return 0.5;
  if (maskProperty?.property === 'featherQuality') return 1;
  const cameraProperty = parseCameraProperty(prop);
  if (cameraProperty === 'fov') return 0.5;
  if (cameraProperty === 'near') return 0.01;
  if (cameraProperty === 'far') return 10;
  if (cameraProperty === 'resolutionWidth' || cameraProperty === 'resolutionHeight') return 16;
  if (prop === 'opacity') return 0.005;
  if (usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y')) return 0.01;
  if (usesCameraPropertyModel(clip) && prop === 'position.z') return 0.05;
  if (prop.startsWith('scale')) return 0.005;
  if (prop.startsWith('rotation')) return 0.5;
  if (prop.startsWith('position')) return 1;
  const colorMeta = getTimelineHeaderColorPropertyMeta(prop, clip);
  if (colorMeta) return colorMeta.step * 8;
  const eqMeta = getAudioEqPropertyMeta(prop, clip);
  if (eqMeta?.paramName.endsWith('frequencyHz')) return Math.max(1, eqMeta.frequencyHz * 0.01);
  if (eqMeta?.paramName.endsWith('gainDb')) return 0.1;
  if (eqMeta?.paramName.endsWith('q')) return 0.04;
  if (eqMeta?.paramName.endsWith('thresholdDb') || eqMeta?.paramName.endsWith('rangeDb')) return 0.1;
  if (eqMeta?.paramName.endsWith('ratio')) return 0.08;
  if (eqMeta?.paramName.endsWith('attackMs')) return 0.2;
  if (eqMeta?.paramName.endsWith('releaseMs')) return 2;
  if (prop.includes('.volume')) return 0.005;
  if (prop.includes('.band')) return 0.1;
  if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) return 0.02;
  if (parseVectorAnimationStateProperty(prop)) return 0.2;
  return 0.1;
}

export function getHeaderPropertyDefaultValue(prop: string, clip: KeyframeTrackClip): number {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty?.property === 'path') return 0;
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return 0;
  if (maskProperty?.property === 'feather' || maskProperty?.property === 'edgeFeather') return 0;
  if (maskProperty?.property === 'featherQuality') return 50;
  const cameraProperty = parseCameraProperty(prop);
  if (cameraProperty) {
    return DEFAULT_SCENE_CAMERA_SETTINGS[cameraProperty] ??
      (cameraProperty === 'resolutionWidth' ? 1920 : cameraProperty === 'resolutionHeight' ? 1080 : 0);
  }
  if (prop === 'opacity') return 1;
  if (usesCameraPropertyModel(clip) && prop === 'scale.z') return 0;
  if (prop.startsWith('scale')) return 1;
  if (prop.startsWith('rotation')) return 0;
  if (prop.startsWith('position')) return 0;
  const colorMeta = getTimelineHeaderColorPropertyMeta(prop, clip);
  if (colorMeta) return colorMeta.defaultValue;
  const eqMeta = getAudioEqPropertyMeta(prop, clip);
  if (eqMeta) return getDefaultAudioEqTimelineValue(eqMeta.paramName, eqMeta.frequencyHz);
  if (prop.includes('.volume')) return 1;
  if (prop.includes('.band')) return 0;
  if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) return 0;
  if (parseVectorAnimationStateProperty(prop)) return 0;
  return 0;
}

export function formatHeaderPropertyValue(value: number, prop: string, clip?: KeyframeTrackClip | null): string {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty?.property === 'path') return 'Path';
  if (maskProperty?.property === 'feather' || maskProperty?.property === 'edgeFeather') return `${value.toFixed(1)}px`;
  if (maskProperty?.property === 'featherQuality') return value.toFixed(0);
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return value.toFixed(3);

  const colorMeta = getTimelineHeaderColorPropertyMeta(prop, clip);
  if (colorMeta) return value.toFixed(colorMeta.decimals);
  const cameraProperty = parseCameraProperty(prop);
  if (cameraProperty === 'fov') return `${value.toFixed(1)}\u00B0`;
  if (cameraProperty === 'near') return value.toFixed(3);
  if (cameraProperty === 'far') return value.toFixed(1);
  if (cameraProperty === 'resolutionWidth' || cameraProperty === 'resolutionHeight') return Math.round(value).toString();
  if (prop === 'opacity') return (value * 100).toFixed(0) + '%';
  if (prop.startsWith('rotation')) return value.toFixed(1) + '\u00B0';
  if (prop.startsWith('scale')) return (value * 100).toFixed(0) + '%';
  const eqMeta = getAudioEqPropertyMeta(prop, clip);
  if (eqMeta) {
    if (eqMeta.paramName.endsWith('frequencyHz')) return formatEqFrequencyLabel(value, `${value.toFixed(0)}Hz`);
    if (eqMeta.paramName.endsWith('gainDb') || eqMeta.paramName.endsWith('thresholdDb') || eqMeta.paramName.endsWith('rangeDb')) {
      return (value > 0 ? '+' : '') + value.toFixed(1) + 'dB';
    }
    if (eqMeta.paramName.endsWith('q')) return value.toFixed(2);
    if (eqMeta.paramName.endsWith('attackMs') || eqMeta.paramName.endsWith('releaseMs')) return `${value.toFixed(0)}ms`;
  }
  if (prop.includes('.volume')) return (value * 100).toFixed(0) + '%';
  if (prop.includes('.band')) return (value > 0 ? '+' : '') + value.toFixed(1) + 'dB';
  const vectorValue = formatTimelineHeaderVectorAnimationPropertyValue(value, prop, clip);
  if (vectorValue !== null) return vectorValue;
  return value.toFixed(1);
}
