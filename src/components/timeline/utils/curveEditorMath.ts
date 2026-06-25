import {
  parseMaskProperty,
  type AnimatableProperty,
  type EasingType,
  type Keyframe,
} from '../../../types';
import { parseCameraProperty } from '../../../types';
import { PRESET_BEZIER } from '../../../utils/keyframeInterpolation';
import {
  parseVectorAnimationInputProperty,
  parseVectorAnimationStateProperty,
} from '../../../types/vectorAnimation';

export function getPropertyDefaults(property: AnimatableProperty): { min: number; max: number; fallbackPad: number } {
  const maskProperty = parseMaskProperty(property);
  if (maskProperty?.property === 'path') {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  if (maskProperty?.property === 'position.x' || maskProperty?.property === 'position.y') {
    return { min: -1, max: 1, fallbackPad: 0.05 };
  }
  if (maskProperty?.property === 'feather' || maskProperty?.property === 'edgeFeather') {
    return { min: 0, max: 500, fallbackPad: 5 };
  }
  if (maskProperty?.property === 'featherQuality') {
    return { min: 1, max: 100, fallbackPad: 5 };
  }
  const cameraProperty = parseCameraProperty(property);
  if (cameraProperty === 'fov') {
    return { min: 10, max: 140, fallbackPad: 2 };
  }
  if (cameraProperty === 'near') {
    return { min: 0.001, max: 10, fallbackPad: 0.1 };
  }
  if (cameraProperty === 'far') {
    return { min: 1, max: 1000, fallbackPad: 10 };
  }
  if (parseVectorAnimationStateProperty(property)) {
    return { min: 0, max: 1, fallbackPad: 0 };
  }
  if (property === 'opacity' || property.includes('.volume')) {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  if (property.startsWith('scale.')) {
    return { min: 0, max: 2, fallbackPad: 0.05 };
  }
  if (property.startsWith('rotation.')) {
    return { min: -360, max: 360, fallbackPad: 5 };
  }
  if (property.startsWith('position.')) {
    return { min: -1000, max: 1000, fallbackPad: 10 };
  }
  if (parseVectorAnimationInputProperty(property)) {
    return { min: 0, max: 1, fallbackPad: 0.05 };
  }
  return { min: -100, max: 100, fallbackPad: 5 };
}

export function niceStep(range: number, targetLines: number = 5): number {
  if (range <= 0) return 1;
  const roughStep = range / targetLines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;

  return nice * magnitude;
}

export function generateBezierPath(
  prevKf: Keyframe,
  nextKf: Keyframe,
  timeToX: (time: number) => number,
  valueToY: (value: number) => number,
): string {
  const x1 = timeToX(prevKf.time);
  const y1 = valueToY(prevKf.value);
  const x2 = timeToX(nextKf.time);
  const y2 = valueToY(nextKf.value);

  const timeDelta = nextKf.time - prevKf.time;
  const valueDelta = nextKf.value - prevKf.value;

  let cp1x: number, cp1y: number, cp2x: number, cp2y: number;

  if (prevKf.easing === 'bezier' || prevKf.handleOut || nextKf.handleIn) {
    const handleOut = prevKf.handleOut || { x: timeDelta / 3, y: valueDelta / 3 };
    const handleIn = nextKf.handleIn || { x: -timeDelta / 3, y: -valueDelta / 3 };

    cp1x = timeToX(prevKf.time + handleOut.x);
    cp1y = valueToY(prevKf.value + handleOut.y);
    cp2x = timeToX(nextKf.time + handleIn.x);
    cp2y = valueToY(nextKf.value + handleIn.y);
  } else {
    const preset = PRESET_BEZIER[prevKf.easing as Exclude<EasingType, 'bezier'>] || PRESET_BEZIER.linear;

    cp1x = x1 + (x2 - x1) * preset.p1[0];
    cp1y = y1 + (y2 - y1) * preset.p1[1];
    cp2x = x1 + (x2 - x1) * preset.p2[0];
    cp2y = y1 + (y2 - y1) * preset.p2[1];
  }

  return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}

export function generateStepPath(
  prevKf: Keyframe,
  nextKf: Keyframe,
  timeToX: (time: number) => number,
  valueToY: (value: number) => number,
): string {
  const x1 = timeToX(prevKf.time);
  const y1 = valueToY(prevKf.value);
  const x2 = timeToX(nextKf.time);
  const y2 = valueToY(nextKf.value);
  return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
}
