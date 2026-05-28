// TimelineHeader component - Track headers (left side)

import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconLockOpen,
  IconVolume2,
} from '@tabler/icons-react';
import type { TimelineHeaderProps } from './types';
import type { AnimatableProperty, AudioEffectParamValue, AudioSendState, ClipMask, ClipTransform, ColorCorrectionState, Keyframe, TimelineClip } from '../../types';
import {
  PRIMARY_COLOR_PARAM_DEFS,
  ensureColorCorrectionState,
  getActiveColorVersion,
  getColorNodeParamValue,
  parseCameraProperty,
  parseColorProperty,
  parseMaskProperty,
} from '../../types';
import {
  isVectorAnimationSourceType,
  mergeVectorAnimationSettings,
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
  getVectorAnimationStateIndex,
  getVectorAnimationStateLabelAtIndex,
  vectorAnimationDataBindingValueToNumber,
  vectorAnimationInputValueToNumber,
} from '../../types/vectorAnimation';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';
import { CurveEditorHeader } from './CurveEditorHeader';
import { useMediaStore } from '../../stores/mediaStore';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import { AudioLevelMeter } from './components/AudioLevelMeter';
import { AudioEffectStackControl } from '../panels/properties/AudioEffectStackControl';
import {
  formatAudioTrackPan,
  formatAudioTrackVolumeDb,
  getAudioTrackHeaderDensity,
} from './utils/audioTrackHeaderDensity';
import { getAudioPanSliderStyle } from './utils/audioPanSliderStyle';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import {
  getCameraLookRotationAxis,
  resolveCameraLookAtFixedEyeUpdates,
} from '../../engine/scene/CameraClipControlUtils';
import {
  AUDIO_EQ_DEFAULT_BAND_DYNAMICS,
  AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS,
  AUDIO_EQ_LEGACY_BANDS,
} from '../../engine/audio/eq/AudioEqDefaults';
import { normalizeAudioEqParams } from '../../engine/audio/eq/AudioEqLegacy';
import { getAudioEffectParamPathValue } from '../../utils/audioEffectParamPath';

type KeyframeTrackClip = {
  id: string;
  startTime: number;
  duration: number;
  is3D?: boolean;
  mediaFileId?: string;
  effects?: Array<{ id: string; type?: string; name: string; params: Record<string, unknown> }>;
  colorCorrection?: ColorCorrectionState;
  masks?: ClipMask[];
  source?: {
    type?: string;
    mediaFileId?: string;
    cameraSettings?: import('../../stores/mediaStore/types').SceneCameraSettings;
    vectorAnimationSettings?: import('../../types/vectorAnimation').VectorAnimationClipSettings;
    gaussianSplatSettings?: {
      render?: {
        useNativeRenderer?: boolean;
      };
    };
  } | null;
};

type TrackHeaderIconName = 'speaker' | 'lock' | 'unlock' | 'eye' | 'eyeOff';

function TrackHeaderIcon({ name }: { name: TrackHeaderIconName }) {
  if (name === 'speaker') {
    return <IconVolume2 className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  if (name === 'lock') {
    return <IconLock className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  if (name === 'unlock') {
    return <IconLockOpen className="track-header-icon" aria-hidden="true" focusable="false" />;
  }

  return name === 'eyeOff'
    ? <IconEyeOff className="track-header-icon" aria-hidden="true" focusable="false" />
    : <IconEye className="track-header-icon" aria-hidden="true" focusable="false" />;
}

const usesCameraPropertyModel = (clip: KeyframeTrackClip | null | undefined): boolean => {
  if (!clip?.source) return false;
  return clip.source.type === 'camera';
};

const shouldHide3DOnlyProperties = (clip: KeyframeTrackClip | null | undefined): boolean => {
  return !clip?.is3D && !usesCameraPropertyModel(clip);
};

const getTransformPropertyOrder = (clip: KeyframeTrackClip | null | undefined): string[] => (
  usesCameraPropertyModel(clip)
    ? ['camera.fov', 'camera.near', 'camera.far', 'camera.resolutionWidth', 'camera.resolutionHeight', 'opacity', 'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z']
    : ['opacity', 'position.x', 'position.y', 'position.z', 'scale.all', 'scale.x', 'scale.y', 'scale.z', 'rotation.x', 'rotation.y', 'rotation.z']
);

const colorParamDefsByKey = new Map(PRIMARY_COLOR_PARAM_DEFS.map((def) => [def.key, def]));

function prettifyParamName(paramName: string): string {
  return paramName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());
}

type ParsedTimelineEffectProperty = {
  effectId: string;
  paramName: string;
  paramPath: string[];
};

type AudioEqPropertyMeta = {
  effectId: string;
  bandId: string;
  paramName: string;
  frequencyHz: number;
  label: string;
  paramOrder: number;
};

const LEGACY_EQ_FREQUENCY_BY_ID = new Map(AUDIO_EQ_LEGACY_BANDS.map(band => [band.id, band.frequencyHz]));
const AUDIO_EQ_PARAM_ORDER: Record<string, number> = {
  frequencyHz: 0,
  gainDb: 1,
  q: 2,
  slopeDbPerOct: 3,
  thresholdDb: 4,
  rangeDb: 5,
  ratio: 6,
  attackMs: 7,
  releaseMs: 8,
};

function parseTimelineEffectProperty(prop: string): ParsedTimelineEffectProperty | null {
  const parts = prop.split('.');
  if (parts.length < 3 || parts[0] !== 'effect') return null;
  return {
    effectId: parts[1],
    paramName: parts.slice(2).join('.'),
    paramPath: parts.slice(2),
  };
}

function formatEqFrequencyLabel(frequencyHz: number, fallback: string): string {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    return fallback;
  }
  if (frequencyHz >= 1000) {
    const khz = frequencyHz / 1000;
    return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)}kHz`;
  }
  return `${Math.round(frequencyHz)}Hz`;
}

function getEqParamLabel(paramName: string): string {
  const lastSegment = paramName.split('.').pop() ?? paramName;
  if (lastSegment === 'frequencyHz') return 'Freq';
  if (lastSegment === 'gainDb') return 'Gain';
  if (lastSegment === 'q') return 'Q';
  if (lastSegment === 'thresholdDb') return 'Threshold';
  if (lastSegment === 'rangeDb') return 'Range';
  if (lastSegment === 'ratio') return 'Ratio';
  if (lastSegment === 'attackMs') return 'Attack';
  if (lastSegment === 'releaseMs') return 'Release';
  if (lastSegment === 'slopeDbPerOct') return 'Slope';
  return prettifyParamName(lastSegment);
}

function getDefaultAudioEqTimelineValue(paramName: string, fallbackFrequencyHz: number): number {
  if (paramName.endsWith('frequencyHz')) return fallbackFrequencyHz || 1000;
  if (paramName.endsWith('gainDb')) return 0;
  if (paramName.endsWith('q')) return 1;
  if (paramName.endsWith('dynamic.thresholdDb')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.thresholdDb;
  if (paramName.endsWith('dynamic.rangeDb')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.rangeDb;
  if (paramName.endsWith('dynamic.ratio')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.ratio;
  if (paramName.endsWith('dynamic.attackMs')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.attackMs;
  if (paramName.endsWith('dynamic.releaseMs')) return AUDIO_EQ_DEFAULT_BAND_DYNAMICS.releaseMs;
  if (paramName.endsWith('spectralDynamics.thresholdDb')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.thresholdDb;
  if (paramName.endsWith('spectralDynamics.rangeDb')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.rangeDb;
  if (paramName.endsWith('spectralDynamics.ratio')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.ratio;
  if (paramName.endsWith('spectralDynamics.attackMs')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.attackMs;
  if (paramName.endsWith('spectralDynamics.releaseMs')) return AUDIO_EQ_DEFAULT_BAND_SPECTRAL_DYNAMICS.releaseMs;
  return 0;
}

function getAudioEqPropertyMeta(prop: string, clip?: KeyframeTrackClip | null): AudioEqPropertyMeta | null {
  const effectProperty = parseTimelineEffectProperty(prop);
  if (!effectProperty) return null;
  const [root, audible, bands, bandId, ...paramPath] = effectProperty.paramPath;
  if (root !== 'eq' || audible !== 'audible' || bands !== 'bands' || !bandId || paramPath.length === 0) {
    return null;
  }

  const effect = clip?.effects?.find(candidate => candidate.id === effectProperty.effectId);
  const normalized = effect ? normalizeAudioEqParams(effect.params) : null;
  const band = normalized?.audible.bands.find(candidate => candidate.id === bandId);
  const frequencyHz = band?.frequencyHz ?? LEGACY_EQ_FREQUENCY_BY_ID.get(bandId) ?? 0;
  const paramName = paramPath.join('.');
  const label = `${formatEqFrequencyLabel(frequencyHz, bandId)} ${getEqParamLabel(paramName)}`;

  return {
    effectId: effectProperty.effectId,
    bandId,
    paramName,
    frequencyHz,
    label,
    paramOrder: AUDIO_EQ_PARAM_ORDER[paramPath[paramPath.length - 1] ?? paramName] ?? 100,
  };
}

function getColorPropertyMeta(prop: string, clip?: KeyframeTrackClip | null) {
  const parsed = parseColorProperty(prop);
  if (!parsed) return null;

  const colorState = clip?.colorCorrection ? ensureColorCorrectionState(clip.colorCorrection) : null;
  const version = colorState?.versions.find((entry) => entry.id === parsed.versionId)
    ?? (colorState ? getActiveColorVersion(colorState) : undefined);
  const node = version?.nodes.find((entry) => entry.id === parsed.nodeId);
  const def = colorParamDefsByKey.get(parsed.paramName as (typeof PRIMARY_COLOR_PARAM_DEFS)[number]['key']);

  return {
    ...parsed,
    nodeName: node?.name,
    label: def?.label ?? prettifyParamName(parsed.paramName),
    defaultValue: def?.defaultValue ?? 0,
    decimals: def?.decimals ?? 2,
    step: def?.step ?? 0.01,
  };
}

// Get friendly names for properties
const getPropertyLabel = (prop: string, clip?: KeyframeTrackClip | null): string => {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty) {
    const maskName = clip?.masks?.find(mask => mask.id === maskProperty.maskId)?.name ?? 'Mask';
    const labels: Record<string, string> = {
      path: 'Path',
      'position.x': 'X',
      'position.y': 'Y',
      feather: 'Feather',
      featherQuality: 'Quality',
    };
    return `${maskName} ${labels[maskProperty.property] ?? maskProperty.property}`;
  }

  const colorMeta = getColorPropertyMeta(prop, clip);
  if (colorMeta) {
    const nodeName = colorMeta.nodeName?.trim();
    return nodeName && nodeName !== 'Primary' ? `${nodeName} ${colorMeta.label}` : colorMeta.label;
  }

  const lottieInput = parseVectorAnimationInputProperty(prop);
  if (lottieInput) {
    return lottieInput.inputName;
  }
  const riveData = parseVectorAnimationDataBindingProperty(prop);
  if (riveData) {
    return riveData.propertyName;
  }
  if (parseVectorAnimationStateProperty(prop)) {
    return 'State';
  }

  if (usesCameraPropertyModel(clip)) {
    const cameraProperty = parseCameraProperty(prop);
    if (cameraProperty === 'fov') return 'FOV';
    if (cameraProperty === 'near') return 'Near';
    if (cameraProperty === 'far') return 'Far';
    if (cameraProperty === 'resolutionWidth') return 'Res X';
    if (cameraProperty === 'resolutionHeight') return 'Res Y';
    if (prop === 'position.x') return 'Pos X';
    if (prop === 'position.y') return 'Pos Y';
    if (prop === 'position.z') return 'Pos Z';
    if (prop === 'rotation.x') return 'Pitch';
    if (prop === 'rotation.y') return 'Yaw';
  }

  const labels: Record<string, string> = {
    'opacity': 'Opacity',
    'position.x': 'Pos X',
    'position.y': 'Pos Y',
    'position.z': 'Pos Z',
    'scale.all': 'Scale All',
    'scale.x': 'Scale X',
    'scale.y': 'Scale Y',
    'scale.z': 'Scale Z',
    'rotation.x': 'Rot X',
    'rotation.y': 'Rot Y',
    'rotation.z': 'Rot Z',
  };
  if (labels[prop]) return labels[prop];
  if (prop.startsWith('effect.')) {
    const eqMeta = getAudioEqPropertyMeta(prop, clip);
    if (eqMeta) return eqMeta.label;

    const parts = prop.split('.');
    const paramName = parts[parts.length - 1];
    // Audio effect friendly names
    const audioLabels: Record<string, string> = {
      'volume': 'Volume',
      'band31': '31Hz',
      'band62': '62Hz',
      'band125': '125Hz',
      'band250': '250Hz',
      'band500': '500Hz',
      'band1k': '1kHz',
      'band2k': '2kHz',
      'band4k': '4kHz',
      'band8k': '8kHz',
      'band16k': '16kHz',
    };
    return audioLabels[paramName] || paramName;
  }
  return prop;
};

function getMaskPathValue(mask: ClipMask): NonNullable<Keyframe['pathValue']> {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}

// Get value from transform based on property path
const getValueFromTransform = (transform: ClipTransform, prop: string): number => {
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
};

const getValueFromColorCorrection = (
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>,
  clipLocalTime: number,
): number | null => {
  const colorMeta = getColorPropertyMeta(prop, clip);
  if (!colorMeta || !clip.colorCorrection) return null;

  const colorState = ensureColorCorrectionState(clip.colorCorrection);
  const baseValue = getColorNodeParamValue(
    colorState,
    colorMeta.nodeId,
    colorMeta.paramName,
    colorMeta.defaultValue,
  );

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
};

const getValueFromMaskProperty = (
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>,
  clipLocalTime: number,
): number | null => {
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
        : mask.featherQuality ?? 50;

  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
};

const getValueFromCameraProperty = (
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>,
  clipLocalTime: number,
): number | null => {
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
};

// Format value for display
const formatValue = (value: number, prop: string, clip?: KeyframeTrackClip | null): string => {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty?.property === 'path') return 'Path';
  if (maskProperty?.property === 'feather') return `${value.toFixed(1)}px`;
  if (maskProperty?.property === 'featherQuality') return value.toFixed(0);
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return value.toFixed(3);

  const colorMeta = getColorPropertyMeta(prop, clip);
  if (colorMeta) return value.toFixed(colorMeta.decimals);
  const cameraProperty = parseCameraProperty(prop);
  if (cameraProperty === 'fov') return `${value.toFixed(1)}°`;
  if (cameraProperty === 'near') return value.toFixed(3);
  if (cameraProperty === 'far') return value.toFixed(1);
  if (cameraProperty === 'resolutionWidth' || cameraProperty === 'resolutionHeight') return Math.round(value).toString();
  if (prop === 'opacity') return (value * 100).toFixed(0) + '%';
  if (prop.startsWith('rotation')) return value.toFixed(1) + '°';
  if (prop.startsWith('scale')) return (value * 100).toFixed(0) + '%';
  // Audio effect formatting
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
  const lottieState = parseVectorAnimationStateProperty(prop);
  if (lottieState && isVectorAnimationSourceType(clip?.source?.type)) {
    const mediaFileId = (clip as TimelineClip).mediaFileId ?? (clip as TimelineClip).source?.mediaFileId;
    const stateNames = mediaFileId
      ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)?.vectorAnimation?.stateMachineStates?.[lottieState.stateMachineName] ?? []
      : [];
    return getVectorAnimationStateLabelAtIndex(stateNames, value) ?? `State ${Math.round(value)}`;
  }
  if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) return value === 0 || value === 1 ? (value >= 0.5 ? 'On' : 'Off') : value.toFixed(2);
  return value.toFixed(1);
};

// Get value from effects for effect properties
const getValueFromEffects = (
  effects: Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>,
  prop: string
): number => {
  const effectProperty = parseTimelineEffectProperty(prop);
  if (!effectProperty) return 0;

  const effect = effects.find(e => e.id === effectProperty.effectId);
  if (!effect) return 0;

  if (effectProperty.paramPath.length > 1) {
    const directValue = getAudioEffectParamPathValue(
      effect.params as unknown as AudioEffectParamValue,
      effectProperty.paramPath,
    );
    if (typeof directValue === 'number') return directValue;

    if (effectProperty.paramPath[0] === 'eq') {
      const normalized = normalizeAudioEqParams(effect.params);
      const normalizedValue = getAudioEffectParamPathValue(
        normalized as unknown as AudioEffectParamValue,
        effectProperty.paramPath.slice(1),
      );
      if (typeof normalizedValue === 'number') return normalizedValue;

      const eqMeta = getAudioEqPropertyMeta(prop, {
        id: '',
        startTime: 0,
        duration: 0,
        effects,
      });
      return eqMeta ? getDefaultAudioEqTimelineValue(eqMeta.paramName, eqMeta.frequencyHz) : 0;
    }

    return 0;
  }

  const value = effect.params[effectProperty.paramName];
  return typeof value === 'number' ? value : 0;
};

const getValueFromVectorAnimationSettings = (
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>,
  clipLocalTime: number,
): number | null => {
  const parsed = parseVectorAnimationInputProperty(prop);
  const dataBinding = parseVectorAnimationDataBindingProperty(prop);
  if ((!parsed && !dataBinding) || !isVectorAnimationSourceType(clip.source?.type)) {
    return null;
  }

  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  const baseValue = parsed
    ? vectorAnimationInputValueToNumber(settings.stateMachineInputValues?.[parsed.inputName])
    : vectorAnimationDataBindingValueToNumber(settings.dataBindingValues?.[dataBinding!.propertyName]);
  return interpolateKeyframes(
    keyframes as Keyframe[],
    prop as AnimatableProperty,
    clipLocalTime,
    baseValue,
  );
};

const getValueFromVectorAnimationState = (
  clip: KeyframeTrackClip,
  prop: string,
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>,
  clipLocalTime: number,
): number | null => {
  const parsed = parseVectorAnimationStateProperty(prop);
  if (!parsed || !isVectorAnimationSourceType(clip.source?.type)) {
    return null;
  }

  const mediaFileId = (clip as TimelineClip).mediaFileId ?? (clip as TimelineClip).source?.mediaFileId;
  const stateNames = mediaFileId
    ? useMediaStore.getState().files.find((file) => file.id === mediaFileId)?.vectorAnimation?.stateMachineStates?.[parsed.stateMachineName] ?? []
    : [];
  const settings = mergeVectorAnimationSettings(clip.source.vectorAnimationSettings);
  let currentValue = getVectorAnimationStateIndex(stateNames, settings.stateMachineState);
  const stateKeyframes = keyframes
    .filter((keyframe) => keyframe.property === prop)
    .sort((a, b) => a.time - b.time);

  for (const keyframe of stateKeyframes) {
    if (keyframe.time > clipLocalTime + 1e-6) {
      break;
    }
    currentValue = keyframe.value;
  }

  return currentValue;
};

type PropertyKeyframeDragSession = {
  pointerId: number;
  visited: Set<string>;
};

let propertyKeyframeDragSession: PropertyKeyframeDragSession | null = null;

function endPropertyKeyframeDrag() {
  propertyKeyframeDragSession = null;
  window.removeEventListener('pointerup', endPropertyKeyframeDrag);
  window.removeEventListener('pointercancel', endPropertyKeyframeDrag);
  window.removeEventListener('blur', endPropertyKeyframeDrag);
}

// Single property row with value display and keyframe controls
function PropertyRow({
  prop,
  clipId,
  trackId,
  clip,
  keyframes,
  playheadPosition,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  isCurveExpanded,
  isKeyframeRowHovered,
  onToggleCurveExpanded,
  onKeyframeRowHover,
}: {
  prop: string;
  clipId: string;
  trackId: string;
  clip: KeyframeTrackClip;
  keyframes: Array<{ id: string; time: number; property: string; value: number; easing: string }>;
  playheadPosition: number;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  isCurveExpanded: boolean;
  isKeyframeRowHovered: boolean;
  onToggleCurveExpanded: () => void;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ y: 0, value: 0 });
  const ignoreNextKeyframeButtonClick = useRef(false);
  const keyframeButtonDragId = `${clipId}:${prop}`;

  // Get keyframes for this property only, sorted by time
  const propKeyframes = useMemo(() =>
    keyframes.filter(kf => kf.property === prop).sort((a, b) => a.time - b.time),
    [keyframes, prop]
  );

  // Calculate clip-local time
  const clipLocalTime = playheadPosition - clip.startTime;
  const isWithinClip = clipLocalTime >= 0 && clipLocalTime <= clip.duration;

  // Get current interpolated value (keyframes in deps triggers recalc when values change)
  const currentValue = useMemo(() => {
    if (!isWithinClip) return 0;
    // Effect properties use getInterpolatedEffects
    if (prop.startsWith('effect.')) {
      const effects = getInterpolatedEffects(clipId, clipLocalTime);
      return getValueFromEffects(effects, prop);
    }
    const colorValue = getValueFromColorCorrection(clip, prop, keyframes, clipLocalTime);
    if (colorValue !== null) {
      return colorValue;
    }
    const lottieInputValue = getValueFromVectorAnimationSettings(clip, prop, keyframes, clipLocalTime);
    if (lottieInputValue !== null) {
      return lottieInputValue;
    }
    const lottieStateValue = getValueFromVectorAnimationState(clip, prop, keyframes, clipLocalTime);
    if (lottieStateValue !== null) {
      return lottieStateValue;
    }
    const maskValue = getValueFromMaskProperty(clip, prop, keyframes, clipLocalTime);
    if (maskValue !== null) {
      return maskValue;
    }
    const cameraValue = getValueFromCameraProperty(clip, prop, keyframes, clipLocalTime);
    if (cameraValue !== null) {
      return cameraValue;
    }
    // Transform properties use getInterpolatedTransform
    const transform = getInterpolatedTransform(clipId, clipLocalTime);
    return getValueFromTransform(transform, prop);
  }, [clip, clipId, clipLocalTime, isWithinClip, getInterpolatedTransform, getInterpolatedEffects, keyframes, prop]);

  // Find prev/next keyframes relative to playhead
  const prevKeyframe = useMemo(() => {
    for (let i = propKeyframes.length - 1; i >= 0; i--) {
      if (propKeyframes[i].time < clipLocalTime) return propKeyframes[i];
    }
    return null;
  }, [propKeyframes, clipLocalTime]);

  const nextKeyframe = useMemo(() => {
    for (const kf of propKeyframes) {
      if (kf.time > clipLocalTime) return kf;
    }
    return null;
  }, [propKeyframes, clipLocalTime]);

  // Check if there's a keyframe at current time
  const hasKeyframeAtPlayhead = propKeyframes.some(kf => Math.abs(kf.time - clipLocalTime) < 0.01);

  // Get base sensitivity based on property type
  const getBaseSensitivity = () => {
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') return 0;
    if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return 0.001;
    if (maskProperty?.property === 'feather') return 0.5;
    if (maskProperty?.property === 'featherQuality') return 1;
    const cameraProperty = parseCameraProperty(prop);
    if (cameraProperty === 'fov') return 0.5;
    if (cameraProperty === 'near') return 0.01;
    if (cameraProperty === 'far') return 10;
    if (cameraProperty === 'resolutionWidth' || cameraProperty === 'resolutionHeight') return 16;
    if (prop === 'opacity') return 0.005; // 0-1 range
    if (usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y')) return 0.01;
    if (usesCameraPropertyModel(clip) && prop === 'position.z') return 0.05;
    if (prop.startsWith('scale')) return 0.005; // typically 0-2 range
    if (prop.startsWith('rotation')) return 0.5; // degrees
    if (prop.startsWith('position')) return 1; // pixels
    const colorMeta = getColorPropertyMeta(prop, clip);
    if (colorMeta) return colorMeta.step * 8;
    // Audio effect properties
    const eqMeta = getAudioEqPropertyMeta(prop, clip);
    if (eqMeta?.paramName.endsWith('frequencyHz')) return Math.max(1, eqMeta.frequencyHz * 0.01);
    if (eqMeta?.paramName.endsWith('gainDb')) return 0.1;
    if (eqMeta?.paramName.endsWith('q')) return 0.04;
    if (eqMeta?.paramName.endsWith('thresholdDb') || eqMeta?.paramName.endsWith('rangeDb')) return 0.1;
    if (eqMeta?.paramName.endsWith('ratio')) return 0.08;
    if (eqMeta?.paramName.endsWith('attackMs')) return 0.2;
    if (eqMeta?.paramName.endsWith('releaseMs')) return 2;
    if (prop.includes('.volume')) return 0.005; // 0-1 range
    if (prop.includes('.band')) return 0.1; // dB range (-12 to 12)
    if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) return 0.02;
    if (parseVectorAnimationStateProperty(prop)) return 0.2;
    return 0.1;
  };

  // Get default value for property
  const getDefaultValue = () => {
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') return 0;
    if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') return 0;
    if (maskProperty?.property === 'feather') return 0;
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
    const colorMeta = getColorPropertyMeta(prop, clip);
    if (colorMeta) return colorMeta.defaultValue;
    // Audio effect properties
    const eqMeta = getAudioEqPropertyMeta(prop, clip);
    if (eqMeta) return getDefaultAudioEqTimelineValue(eqMeta.paramName, eqMeta.frequencyHz);
    if (prop.includes('.volume')) return 1; // 100%
    if (prop.includes('.band')) return 0; // 0 dB (no boost/cut)
    if (parseVectorAnimationInputProperty(prop) || parseVectorAnimationDataBindingProperty(prop)) return 0;
    if (parseVectorAnimationStateProperty(prop)) return 0;
    return 0;
  };

  const applyPropertyValue = (value: number) => {
    if (!isWithinClip) return;
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') return;

    const cameraLookAxis = usesCameraPropertyModel(clip)
      ? getCameraLookRotationAxis(prop)
      : null;
    if (!cameraLookAxis) {
      setPropertyValue(clipId, prop as AnimatableProperty, value);
      return;
    }

    const activeComp = useMediaStore.getState().getActiveComposition?.();
    const transform = getInterpolatedTransform(clipId, clipLocalTime);
    const updates = resolveCameraLookAtFixedEyeUpdates(
      clip as TimelineClip,
      transform,
      { [cameraLookAxis]: value },
      {
        width: activeComp?.width ?? 1920,
        height: activeComp?.height ?? 1080,
      },
    );

    if (!updates) {
      setPropertyValue(clipId, prop as AnimatableProperty, value);
      return;
    }

    updates.forEach(({ property, value: updateValue }) => {
      addKeyframe(clipId, property, updateValue);
    });
  };

  // Reset to default value (right-click)
  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isWithinClip) return;
    if (parseMaskProperty(prop)?.property === 'path') return;
    applyPropertyValue(getDefaultValue());
  };

  // Handle value scrubbing (left-click drag)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Left click only
    if (parseMaskProperty(prop)?.property === 'path') return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStart.current = { y: e.clientY, value: currentValue };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = dragStart.current.y - moveEvent.clientY;
      let sensitivity = getBaseSensitivity();
      if (moveEvent.shiftKey && moveEvent.altKey) sensitivity *= 0.1; // Slow mode
      else if (moveEvent.shiftKey) sensitivity *= 10; // Fast mode

      const newValue = dragStart.current.value + deltaY * sensitivity;
      applyPropertyValue(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Jump to previous keyframe
  const jumpToPrev = () => {
    if (prevKeyframe) {
      setPlayheadPosition(clip.startTime + prevKeyframe.time);
    }
  };

  // Jump to next keyframe
  const jumpToNext = () => {
    if (nextKeyframe) {
      setPlayheadPosition(clip.startTime + nextKeyframe.time);
    }
  };

  // Add/toggle keyframe at current position
  const toggleKeyframe = useCallback(() => {
    if (!isWithinClip) return;
    const maskProperty = parseMaskProperty(prop);
    if (maskProperty?.property === 'path') {
      const store = useTimelineStore.getState();
      const runtimeMask = store
        .getInterpolatedMasks(clipId, clipLocalTime)
        ?.find(mask => mask.id === maskProperty.maskId);
      const pathValue = runtimeMask ? getMaskPathValue(runtimeMask) : undefined;
      store.addMaskPathKeyframe(clipId, maskProperty.maskId, pathValue, clipLocalTime);
      return;
    }
    addKeyframe(clipId, prop as AnimatableProperty, currentValue);
  }, [addKeyframe, clipId, clipLocalTime, currentValue, isWithinClip, prop]);

  const applyKeyframeButtonForDrag = useCallback(() => {
    const session = propertyKeyframeDragSession;
    if (!session || session.visited.has(keyframeButtonDragId)) return;

    session.visited.add(keyframeButtonDragId);
    toggleKeyframe();
  }, [keyframeButtonDragId, toggleKeyframe]);

  const handleKeyframeButtonPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();
    ignoreNextKeyframeButtonClick.current = true;

    endPropertyKeyframeDrag();
    propertyKeyframeDragSession = {
      pointerId: e.pointerId,
      visited: new Set([keyframeButtonDragId]),
    };
    window.addEventListener('pointerup', endPropertyKeyframeDrag);
    window.addEventListener('pointercancel', endPropertyKeyframeDrag);
    window.addEventListener('blur', endPropertyKeyframeDrag);

    toggleKeyframe();
  }, [keyframeButtonDragId, toggleKeyframe]);

  const handleKeyframeButtonPointerEnter = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const session = propertyKeyframeDragSession;
    if (!session) return;

    if ((e.buttons & 1) !== 1 || e.pointerId !== session.pointerId) {
      endPropertyKeyframeDrag();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    applyKeyframeButtonForDrag();
  }, [applyKeyframeButtonForDrag]);

  const handleKeyframeButtonClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (ignoreNextKeyframeButtonClick.current) {
      ignoreNextKeyframeButtonClick.current = false;
      e.preventDefault();
      return;
    }

    toggleKeyframe();
  }, [toggleKeyframe]);

  // Handle double-click to toggle curve editor
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCurveExpanded();
  };

  return (
    <>
      <div
        className={`property-label-row flat ${isDragging ? 'dragging' : ''} ${isCurveExpanded ? 'curve-expanded' : ''} ${isKeyframeRowHovered ? 'keyframe-row-highlighted' : ''}`}
        onMouseEnter={() => onKeyframeRowHover?.(trackId, prop as AnimatableProperty, true)}
        onMouseLeave={() => onKeyframeRowHover?.(trackId, prop as AnimatableProperty, false)}
        onDoubleClick={handleDoubleClick}
        title="Double-click to toggle curve editor"
      >
        <span className="property-label">{getPropertyLabel(prop, clip)}</span>
        <div className="property-keyframe-controls">
          <button
            className={`kf-nav-btn ${prevKeyframe ? '' : 'disabled'}`}
            onClick={jumpToPrev}
            title="Previous keyframe"
          >
            ◀
          </button>
          <button
            className={`kf-add-btn ${hasKeyframeAtPlayhead ? 'has-keyframe' : ''}`}
            onPointerDown={handleKeyframeButtonPointerDown}
            onPointerEnter={handleKeyframeButtonPointerEnter}
            onClick={handleKeyframeButtonClick}
            title={hasKeyframeAtPlayhead ? 'Keyframe exists' : 'Add keyframe'}
          >
            ◆
          </button>
          <button
            className={`kf-nav-btn ${nextKeyframe ? '' : 'disabled'}`}
            onClick={jumpToNext}
            title="Next keyframe"
          >
            ▶
          </button>
        </div>
        <span
          className="property-value"
          onMouseDown={handleMouseDown}
          onContextMenu={handleRightClick}
          title="Drag to scrub, Right-click to reset"
        >
          {isWithinClip
            ? (
                usesCameraPropertyModel(clip) && (prop === 'position.x' || prop === 'position.y' || prop === 'position.z')
                  ? currentValue.toFixed(3)
                  : formatValue(currentValue, prop, clip)
              )
            : '—'}
        </span>
      </div>
      {isCurveExpanded && (
        <CurveEditorHeader
          property={prop as AnimatableProperty}
          keyframes={propKeyframes as Keyframe[]}
          onClose={onToggleCurveExpanded}
        />
      )}
    </>
  );
}

// Render property labels for track header (left column) - flat list without folder structure
function TrackPropertyLabels({
  trackId,
  selectedClip,
  clipKeyframes,
  playheadPosition,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  expandedCurveProperties,
  onToggleCurveExpanded,
  hoveredKeyframeRow,
  onKeyframeRowHover,
}: {
  trackId: string;
  selectedClip: KeyframeTrackClip | null;
  clipKeyframes: Map<string, Array<{ id: string; clipId: string; time: number; property: AnimatableProperty; value: number; easing: string }>>;
  playheadPosition: number;
  getInterpolatedTransform: (clipId: string, clipLocalTime: number) => ClipTransform;
  getInterpolatedEffects: (clipId: string, clipLocalTime: number) => Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
  addKeyframe: (clipId: string, property: AnimatableProperty, value: number) => void;
  setPlayheadPosition: (time: number) => void;
  setPropertyValue: (clipId: string, property: AnimatableProperty, value: number) => void;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  onToggleCurveExpanded: (trackId: string, property: AnimatableProperty) => void;
  hoveredKeyframeRow?: { trackId: string; property: AnimatableProperty } | null;
  onKeyframeRowHover?: (trackId: string, property: AnimatableProperty, hovered: boolean) => void;
}) {
  const clipId = selectedClip?.id;
  const keyframes = useMemo(
    () => (clipId ? clipKeyframes.get(clipId) || [] : []),
    [clipId, clipKeyframes],
  );

  // Get keyframes for this clip - use clipKeyframes map to trigger re-render when keyframes change
  const keyframeProperties = useMemo(() => {
    const props = new Set<string>();
    keyframes.forEach((kf) => props.add(kf.property));
    // Hide 3D-only properties when clip is not 3D
    if (shouldHide3DOnlyProperties(selectedClip)) {
      props.delete('rotation.x');
      props.delete('rotation.y');
      props.delete('position.z');
      props.delete('scale.z');
    }
    return props;
  }, [keyframes, selectedClip]);

  // If no clip is selected in this track, show nothing
  if (!selectedClip || keyframeProperties.size === 0) {
    return <div className="track-property-labels" />;
  }

  // Convert Set to sorted array for consistent ordering
  const sortedProperties = Array.from(keyframeProperties).sort((a, b) => {
    // Transform properties order
    const transformOrder = getTransformPropertyOrder(selectedClip);
    // Audio effect properties order (volume first, then bands by frequency)
    const audioParamOrder = ['volume', 'band31', 'band62', 'band125', 'band250', 'band500', 'band1k', 'band2k', 'band4k', 'band8k', 'band16k'];

    const aIdx = transformOrder.indexOf(a);
    const bIdx = transformOrder.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    const aLottieInput = parseVectorAnimationInputProperty(a);
    const bLottieInput = parseVectorAnimationInputProperty(b);
    const aLottieState = parseVectorAnimationStateProperty(a);
    const bLottieState = parseVectorAnimationStateProperty(b);
    const aRiveData = parseVectorAnimationDataBindingProperty(a);
    const bRiveData = parseVectorAnimationDataBindingProperty(b);
    if (aLottieState && bLottieState) return 0;
    if (aLottieState) return -1;
    if (bLottieState) return 1;
    if (aLottieInput && bLottieInput) {
      return aLottieInput.inputName.localeCompare(bLottieInput.inputName);
    }
    if (aLottieInput) return -1;
    if (bLottieInput) return 1;
    if (aRiveData && bRiveData) {
      return aRiveData.propertyName.localeCompare(bRiveData.propertyName);
    }
    if (aRiveData) return -1;
    if (bRiveData) return 1;

    // For effect properties, extract the param name and sort
    if (a.startsWith('effect.') && b.startsWith('effect.')) {
      const aEqMeta = getAudioEqPropertyMeta(a, selectedClip);
      const bEqMeta = getAudioEqPropertyMeta(b, selectedClip);
      if (aEqMeta && bEqMeta) {
        const frequencyDelta = aEqMeta.frequencyHz - bEqMeta.frequencyHz;
        if (Math.abs(frequencyDelta) > 0.001) return frequencyDelta;
        return aEqMeta.paramOrder - bEqMeta.paramOrder;
      }
      if (aEqMeta) return -1;
      if (bEqMeta) return 1;

      const aParam = a.split('.').pop() || '';
      const bParam = b.split('.').pop() || '';
      const aAudioIdx = audioParamOrder.indexOf(aParam);
      const bAudioIdx = audioParamOrder.indexOf(bParam);
      if (aAudioIdx !== -1 && bAudioIdx !== -1) return aAudioIdx - bAudioIdx;
      if (aAudioIdx !== -1) return -1;
      if (bAudioIdx !== -1) return 1;
    }

    return a.localeCompare(b);
  });

  // Check if property has curve editor expanded
  const trackCurveProps = expandedCurveProperties.get(trackId);

  return (
    <div className="track-property-labels">
      {sortedProperties.map((prop) => {
        const isCurveExpanded = trackCurveProps?.has(prop as AnimatableProperty) ?? false;
        const isKeyframeRowHovered =
          hoveredKeyframeRow?.trackId === trackId &&
          hoveredKeyframeRow.property === prop;
        return (
          <PropertyRow
            key={prop}
            prop={prop}
            clipId={selectedClip.id}
            trackId={trackId}
            clip={selectedClip}
            keyframes={keyframes}
            playheadPosition={playheadPosition}
            getInterpolatedTransform={getInterpolatedTransform}
            getInterpolatedEffects={getInterpolatedEffects}
            addKeyframe={addKeyframe}
            setPlayheadPosition={setPlayheadPosition}
            setPropertyValue={setPropertyValue}
            isCurveExpanded={isCurveExpanded}
            isKeyframeRowHovered={isKeyframeRowHovered}
            onToggleCurveExpanded={() => onToggleCurveExpanded(trackId, prop as AnimatableProperty)}
            onKeyframeRowHover={onKeyframeRowHover}
          />
        );
      })}
    </div>
  );
}

function TrackSendStackControl({
  trackId,
  sends,
}: {
  trackId: string;
  sends: readonly AudioSendState[];
}) {
  const addSend = useCallback(() => {
    useTimelineStore.getState().addTrackAudioSend(trackId);
  }, [trackId]);

  return (
    <div className="audio-send-stack">
      <div className="audio-send-stack-header">
        <span>Sends</span>
        <button type="button" onClick={addSend} title="Add send">+ Send</button>
      </div>
      {sends.length === 0 ? (
        <div className="audio-send-empty">No sends</div>
      ) : (
        <div className="audio-send-list">
          {sends.map((send, index) => (
            <div className="audio-send-row" key={send.id}>
              <button
                type="button"
                className={`audio-send-enable ${send.enabled !== false ? 'active' : ''}`}
                onClick={() => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { enabled: send.enabled === false })}
                title={send.enabled === false ? 'Enable send' : 'Bypass send'}
              >
                {index + 1}
              </button>
              <input
                className="audio-send-target"
                type="text"
                value={send.targetBusId}
                aria-label="Send target bus"
                onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { targetBusId: event.currentTarget.value })}
              />
              <input
                className="audio-send-gain"
                type="range"
                min="-60"
                max="18"
                step="0.5"
                value={send.gainDb}
                aria-label="Send gain"
                title={`${send.gainDb.toFixed(1)} dB`}
                onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { gainDb: Number(event.currentTarget.value) })}
              />
              <span className="audio-send-gain-value">{send.gainDb.toFixed(1)}</span>
              <label className="audio-send-prefader" title="Pre-fader send">
                <input
                  type="checkbox"
                  checked={send.preFader}
                  onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { preFader: event.currentTarget.checked })}
                />
                Pre
              </label>
              <button
                type="button"
                className="audio-send-remove"
                onClick={() => useTimelineStore.getState().removeTrackAudioSend(trackId, send.id)}
                title="Remove send"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineHeaderComponent({
  track,
  tracks,
  isDimmed,
  isExpanded,
  baseHeight,
  dynamicHeight,
  hasKeyframes,
  selectedClipIds,
  clips,
  playheadPosition,
  onToggleExpand,
  onToggleSolo,
  onToggleLocked,
  onToggleMuted,
  onToggleVisible,
  onRenameTrack,
  onContextMenu,
  onWheel,
  onResizeStart,
  isResizeActive = false,
  clipKeyframes,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  expandedCurveProperties,
  onToggleCurveExpanded,
  hoveredKeyframeRow,
  onKeyframeRowHover,
  audioLayerAdvancedMode = true,
  showCollapsedAudioSummaryMeter = false,
}: TimelineHeaderProps) {
  // Get the first selected clip in this track
  const trackClips = clips.filter((c) => c.trackId === track.id);
  const selectedTrackClip = trackClips.find((c) => selectedClipIds.has(c.id));
  const effectiveMuted = track.audioState?.muted ?? track.muted;
  const effectiveSolo = track.audioState?.solo ?? track.solo;
  const trackRecordArm = track.audioState?.recordArm === true;
  const trackInputMonitor = track.audioState?.inputMonitor === true;
  const trackVolumeDb = track.audioState?.volumeDb ?? 0;
  const trackPan = track.audioState?.pan ?? 0;
  const trackVolumeLabel = formatAudioTrackVolumeDb(trackVolumeDb);
  const trackPanLabel = formatAudioTrackPan(trackPan);
  const trackVolumeUnit = Math.max(0, Math.min(1, (trackVolumeDb + 60) / 78));
  const audioHeaderDensity = track.type === 'audio'
    ? getAudioTrackHeaderDensity(baseHeight)
    : null;
  const isAudioTrack = track.type === 'audio';
  const isMutedTrack = isAudioTrack && effectiveMuted;
  const isHiddenTrack = track.type === 'video' && track.visible === false;
  const showAudioSummaryMeter = isAudioTrack && audioLayerAdvancedMode && showCollapsedAudioSummaryMeter;
  const showAdvancedAudioControls = isAudioTrack && audioLayerAdvancedMode && !showCollapsedAudioSummaryMeter;
  const audioHeaderControlScale = showAdvancedAudioControls && audioHeaderDensity === 'full'
    ? Math.max(0.78, Math.min(1, baseHeight / 96))
    : 1;
  const audioHeaderFaderScale = showAdvancedAudioControls && audioHeaderDensity !== 'condensed'
    ? Math.max(0, Math.min(1, baseHeight / 96))
    : 1;
  const trackTypeIndex = tracks.filter((timelineTrack) => timelineTrack.type === track.type).findIndex((timelineTrack) => timelineTrack.id === track.id);
  const showTimelineTrackColor = audioLayerAdvancedMode !== false;
  const trackColor = showTimelineTrackColor ? getTimelineTrackColor(track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;
  const trackHeaderStyle = {
    height: dynamicHeight,
    '--track-color': trackColor,
    ...(isAudioTrack ? {
      '--audio-strip-control-scale': audioHeaderControlScale.toFixed(3),
      '--audio-strip-fader-scale': audioHeaderFaderScale.toFixed(3),
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--audio-strip-control-scale'?: string;
    '--audio-strip-fader-scale'?: string;
  };
  const audioMeter = useTimelineStore(state => showAdvancedAudioControls
    ? state.runtimeAudioMeters.trackMeters[track.id]
    : undefined);
  const collapsedAudioSummaryMeter = useTimelineStore(state => showAudioSummaryMeter
    ? state.runtimeAudioMeters.master
    : undefined);
  const targetTrackId = useTimelineStore(state => state.targetTrackIdByType[track.type]);
  const setTargetTrack = useTimelineStore(state => state.setTargetTrack);
  const isTargeted = targetTrackId === track.id;
  const [audioFxOpen, setAudioFxOpen] = useState(false);
  const [audioSendsOpen, setAudioSendsOpen] = useState(false);
  const audioFxPopoverRef = useRef<HTMLDivElement>(null);
  const audioSendsPopoverRef = useRef<HTMLDivElement>(null);

  // Editing state for track name
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!audioFxOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioFxPopoverRef.current?.contains(event.target as Node)) return;
      setAudioFxOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [audioFxOpen]);

  useEffect(() => {
    if (!audioSendsOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioSendsPopoverRef.current?.contains(event.target as Node)) return;
      setAudioSendsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [audioSendsOpen]);

  const startNameEdit = () => {
    setEditValue(track.name);
    setIsEditing(true);
  };

  // Handle click on name to edit without toggling track expansion
  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startNameEdit();
  };

  const handleNameDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startNameEdit();
  };

  // Handle finishing edit
  const handleFinishEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.name) {
      onRenameTrack(trimmed);
    }
    setIsEditing(false);
  };

  // Handle key press in input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(track.name);
    }
  };

  // Handle click on header main area (except buttons) to set the edit target track.
  const handleHeaderClick = (e: React.MouseEvent) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.track-controls')) return;
    if ((e.target as HTMLElement).closest('.audio-track-faders')) return;
    if ((e.target as HTMLElement).closest('.audio-track-popover')) return;
    setTargetTrack(track.id);
  };

  const handleTrackVolumeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value));
  }, [track.id]);

  const handleTrackVolumeReset = useCallback((event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, 0);
  }, [track.id]);

  const handleTrackPanChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useTimelineStore.getState().setTrackAudioPan(track.id, Number(event.currentTarget.value));
  }, [track.id]);

  const handleTrackPanReset = useCallback((event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioPan(track.id, 0);
  }, [track.id]);

  return (
    <div
      className={`track-header ${track.type} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      } ${track.locked ? 'locked' : ''} ${
        isMutedTrack ? 'track-muted' : ''
      } ${
        isHiddenTrack ? 'track-hidden' : ''
      } ${
        audioHeaderDensity ? `audio-strip-${audioHeaderDensity}` : ''
      } ${isAudioTrack ? (audioLayerAdvancedMode ? 'audio-layer-advanced' : 'audio-layer-basic') : ''} ${
        showAdvancedAudioControls && (audioFxOpen || audioSendsOpen) ? 'popover-open' : ''
      } ${
        showAudioSummaryMeter ? 'audio-summary-meter-visible' : ''
      } ${
        isResizeActive ? 'resizing' : ''
      } ${
        isTargeted ? 'targeted' : ''
      }`}
      style={trackHeaderStyle}
      data-dock-layout-child-anim-id={`timeline-track-header:${track.id}`}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    >
      <div
        className="track-header-top"
        style={{ height: baseHeight, cursor: (track.type === 'video' || track.type === 'audio') ? 'pointer' : 'default' }}
        onClick={handleHeaderClick}
      >
        {showAudioSummaryMeter && (
          <AudioLevelMeter
            meter={collapsedAudioSummaryMeter}
            label="Summed audio level"
            className="audio-summary-background-meter"
          />
        )}
        <div className="track-header-main">
          {/* Video and audio tracks always get expand arrow */}
          {(track.type === 'video' || track.type === 'audio') && (
            <span
              className={`track-expand-arrow ${isExpanded ? 'expanded' : ''} ${
                hasKeyframes ? 'has-keyframes' : ''
              }`}
              title={isExpanded ? 'Collapse properties' : 'Expand properties'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
            >
              {'\u25B6'}
            </span>
          )}
          {showTimelineTrackColor && (
            <span
              className="track-color-chip"
              style={{ background: trackColor }}
              title="Track color"
              onClick={(event) => event.stopPropagation()}
            />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="track-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFinishEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span
                className="track-name"
                onClick={handleNameClick}
                onDoubleClick={handleNameDoubleClick}
                title="Click to rename"
              >
                {track.name}
              </span>
            </>
          )}
          {showAdvancedAudioControls && (
            <div
              className="audio-track-pan-row"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="audio-track-pan-label" aria-hidden="true">L</span>
              <input
                className="audio-track-pan-inline"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={trackPan}
                aria-label={`${track.name} pan`}
                title={`Pan ${trackPanLabel}. Double-click to center.`}
                style={getAudioPanSliderStyle(trackPan)}
                onChange={handleTrackPanChange}
                onDoubleClick={handleTrackPanReset}
              />
              <span className="audio-track-pan-label" aria-hidden="true">R</span>
              <span className="audio-track-pan-value" aria-hidden="true">{trackPanLabel}</span>
            </div>
          )}
        </div>
        <div className={`track-controls ${track.type === 'audio' ? 'audio-strip-controls' : ''}`}>
          {track.type === 'audio' ? (
            showAudioSummaryMeter ? (
              <>
                <button
                  className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
                  title={effectiveMuted ? 'Unmute' : 'Mute'}
                >
                  M
                </button>
                <button
                  className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
                  title={track.locked ? 'Unlock Track' : 'Lock Track'}
                >
                  <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
                </button>
                <button
                  className={`btn-icon ${audioFxOpen || (track.audioState?.effectStack?.length ?? 0) > 0 ? 'btn-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudioSendsOpen(false);
                    setAudioFxOpen(open => !open);
                  }}
                  title="Track audio FX"
                >
                  FX
                </button>
                <button
                  className={`btn-icon ${(audioSendsOpen || (track.audioState?.sends?.length ?? 0) > 0) ? 'btn-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudioFxOpen(false);
                    setAudioSendsOpen(open => !open);
                  }}
                  title="Track sends"
                >
                  <span className="audio-button-label-wide">Aux</span>
                  <span className="audio-button-label-short">A</span>
                </button>
              </>
            ) : showAdvancedAudioControls ? (
              <>
                <button
                  className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
                  title={effectiveSolo ? 'Solo On' : 'Solo Off'}
                >
                  S
                </button>
                <button
                  className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
                  title={effectiveMuted ? 'Unmute' : 'Mute'}
                >
                  M
                </button>
                <button
                  className={`btn-icon ${trackInputMonitor ? 'btn-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useTimelineStore.getState().updateTrackAudioState(track.id, { inputMonitor: !trackInputMonitor });
                  }}
                  title={trackInputMonitor ? 'Input monitor on' : 'Input monitor off'}
                >
                  <TrackHeaderIcon name="speaker" />
                </button>
                <button
                  className={`btn-icon ${trackRecordArm ? 'record-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useTimelineStore.getState().updateTrackAudioState(track.id, { recordArm: !trackRecordArm });
                  }}
                  title={trackRecordArm ? 'Record armed' : 'Record arm'}
                >
                  R
                </button>
                <button
                  className={`btn-icon ${(audioSendsOpen || (track.audioState?.sends?.length ?? 0) > 0) ? 'btn-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudioFxOpen(false);
                    setAudioSendsOpen(open => !open);
                  }}
                  title="Track sends"
                >
                  <span className="audio-button-label-wide">Aux</span>
                  <span className="audio-button-label-short">A</span>
                </button>
                <button
                  className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
                  title={track.locked ? 'Unlock Track' : 'Lock Track'}
                >
                  <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
                </button>
                <button
                  className={`btn-icon ${audioFxOpen || (track.audioState?.effectStack?.length ?? 0) > 0 ? 'btn-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAudioSendsOpen(false);
                    setAudioFxOpen(open => !open);
                  }}
                  title="Track audio FX"
                >
                  FX
                </button>
              </>
            ) : (
              <>
                <button
                  className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
                  title={effectiveSolo ? 'Solo On' : 'Solo Off'}
                >
                  S
                </button>
                <button
                  className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
                  title={effectiveMuted ? 'Unmute' : 'Mute'}
                >
                  M
                </button>
                <button
                  className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
                  title={track.locked ? 'Unlock Track' : 'Lock Track'}
                >
                  <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
                </button>
              </>
            )
          ) : (
            <>
              <button
                className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
                title={effectiveSolo ? 'Solo On' : 'Solo Off'}
              >
                S
              </button>
              <button
                className={`btn-icon ${!track.visible ? 'hidden' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
                title={track.visible ? 'Hide' : 'Show'}
              >
                <TrackHeaderIcon name={track.visible ? 'eye' : 'eyeOff'} />
              </button>
              <button
                className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
                title={track.locked ? 'Unlock Track' : 'Lock Track'}
              >
                <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
              </button>
            </>
          )}
        </div>
        {showAdvancedAudioControls && (
          <div
            className="audio-track-faders"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <AudioLevelMeter
              meter={audioMeter}
              label={`${track.name} level`}
              orientation="vertical"
              display="auto"
            />
            <div className="audio-track-fader-column">
              <div
                className="audio-track-fader-control"
                style={{ '--audio-track-volume-unit': trackVolumeUnit.toFixed(4) } as CSSProperties & { '--audio-track-volume-unit': string }}
              >
                <div className="audio-track-fader-rail" aria-hidden="true">
                  <div className="audio-track-fader-fill" />
                  <div className="audio-track-fader-thumb" />
                </div>
                <input
                  className="audio-track-fader"
                  type="range"
                  min="-60"
                  max="18"
                  step="0.5"
                  value={trackVolumeDb}
                  aria-label={`${track.name} volume`}
                  title={`Volume ${trackVolumeLabel} dB. Double-click to reset.`}
                  onChange={handleTrackVolumeChange}
                  onDoubleClick={handleTrackVolumeReset}
                />
              </div>
              <span className="audio-track-fader-value" aria-hidden="true">{trackVolumeLabel}</span>
            </div>
          </div>
        )}
        {showAdvancedAudioControls && audioFxOpen && (
          <div
            ref={audioFxPopoverRef}
            className="audio-track-popover audio-track-fx-popover"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <AudioEffectStackControl
              title={`${track.name} FX`}
              className="audio-effect-stack-compact"
              effects={track.audioState?.effectStack ?? []}
              emptyLabel="No track FX"
              onAddEffect={(descriptorId) => useTimelineStore.getState().addTrackAudioEffectInstance(track.id, descriptorId)}
              onUpdateEffect={(effect, paramName, value) => useTimelineStore.getState().updateTrackAudioEffectInstance(track.id, effect.id, { [paramName]: value })}
              onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setTrackAudioEffectInstanceEnabled(track.id, effectId, enabled)}
              onRemoveEffect={(effectId) => useTimelineStore.getState().removeTrackAudioEffectInstance(track.id, effectId)}
              onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderTrackAudioEffectInstance(track.id, effectId, newIndex)}
            />
          </div>
        )}
        {showAdvancedAudioControls && audioSendsOpen && (
          <div
            ref={audioSendsPopoverRef}
            className="audio-track-popover audio-track-sends-popover"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <TrackSendStackControl
              trackId={track.id}
              sends={track.audioState?.sends ?? []}
            />
          </div>
        )}
        {onResizeStart && (
          <div
            className={`track-resize-handle ${isResizeActive ? 'active' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize track height"
            onPointerDown={(event) => onResizeStart(event, track.id)}
          />
        )}
      </div>
      {/* Property labels - shown when track is expanded (for both video and audio with keyframes) */}
      {(track.type === 'video' || track.type === 'audio') && isExpanded && (
        <TrackPropertyLabels
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          clipKeyframes={clipKeyframes}
          playheadPosition={playheadPosition}
          getInterpolatedTransform={getInterpolatedTransform}
          getInterpolatedEffects={getInterpolatedEffects}
          addKeyframe={addKeyframe}
          setPlayheadPosition={setPlayheadPosition}
          setPropertyValue={setPropertyValue}
          expandedCurveProperties={expandedCurveProperties}
          onToggleCurveExpanded={onToggleCurveExpanded}
          hoveredKeyframeRow={hoveredKeyframeRow}
          onKeyframeRowHover={onKeyframeRowHover}
        />
      )}
    </div>
  );
}

export const TimelineHeader = memo(TimelineHeaderComponent);
