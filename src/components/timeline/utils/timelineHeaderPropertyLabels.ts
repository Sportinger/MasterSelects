import {
  parseCameraProperty,
  parseMaskProperty,
} from '../../../types';
import {
  parseVectorAnimationDataBindingProperty,
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';
import { getAudioEqPropertyMeta } from './timelineHeaderAudioEqPropertyModel';
import { getTimelineHeaderColorPropertyMeta } from './timelineHeaderColorPropertyModel';
import {
  getTimelineHeaderTransformPropertyOrder,
  type KeyframeTrackClip,
  usesCameraPropertyModel,
} from './timelineHeaderPropertyTypes';

export function getHeaderPropertyLabel(
  prop: string,
  clip?: KeyframeTrackClip | null,
  isAudioTrack = false,
): string {
  const maskProperty = parseMaskProperty(prop);
  if (maskProperty) {
    const maskName = clip?.masks?.find(mask => mask.id === maskProperty.maskId)?.name ?? 'Mask';
    const labels: Record<string, string> = {
      path: 'Path',
      'position.x': 'X',
      'position.y': 'Y',
      feather: 'Feather',
      edgeFeather: 'Edge Feather',
      featherQuality: 'Quality',
    };
    return `${maskName} ${labels[maskProperty.property] ?? maskProperty.property}`.replace(/\s+/g, ' ').trim();
  }

  const colorMeta = getTimelineHeaderColorPropertyMeta(prop, clip);
  if (colorMeta) {
    const nodeName = colorMeta.nodeName?.trim();
    return nodeName && nodeName !== 'Primary' ? `${nodeName} ${colorMeta.label}` : colorMeta.label;
  }

  const lottieInput = parseVectorAnimationInputProperty(prop);
  if (lottieInput) return lottieInput.inputName;
  const riveData = parseVectorAnimationDataBindingProperty(prop);
  if (riveData) return riveData.propertyName;
  if (parseVectorAnimationStateProperty(prop)) return 'State';

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

  if (isAudioTrack && prop === 'opacity') return 'Volume';

  const labels: Record<string, string> = {
    opacity: 'Opacity',
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
    const audioLabels: Record<string, string> = {
      volume: 'Volume',
      band31: '31Hz',
      band62: '62Hz',
      band125: '125Hz',
      band250: '250Hz',
      band500: '500Hz',
      band1k: '1kHz',
      band2k: '2kHz',
      band4k: '4kHz',
      band8k: '8kHz',
      band16k: '16kHz',
    };
    return audioLabels[paramName] || formatPropertyToken(paramName);
  }
  return formatPropertyToken(prop);
}

function formatPropertyToken(value: string): string {
  return value
    .replace(/^.*\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sortTimelineHeaderProperties(
  properties: Iterable<string>,
  selectedClip: KeyframeTrackClip,
): string[] {
  const audioParamOrder = ['volume', 'band31', 'band62', 'band125', 'band250', 'band500', 'band1k', 'band2k', 'band4k', 'band8k', 'band16k'];
  return Array.from(properties).sort((a, b) => {
    const transformOrder = getTimelineHeaderTransformPropertyOrder(selectedClip);
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
    if (aLottieInput && bLottieInput) return aLottieInput.inputName.localeCompare(bLottieInput.inputName);
    if (aLottieInput) return -1;
    if (bLottieInput) return 1;
    if (aRiveData && bRiveData) return aRiveData.propertyName.localeCompare(bRiveData.propertyName);
    if (aRiveData) return -1;
    if (bRiveData) return 1;

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
}
