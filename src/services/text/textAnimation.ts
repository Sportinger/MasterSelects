import type { TextClipProperties } from '../../types/text';
import type { Keyframe } from '../../types/keyframes';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';

/** One contract for controls, keyframes and every text rendering consumer. */
export const TEXT_NUMERIC_PARAMETERS = {
  fontSize: { label: 'Font Size', min: 1, max: 500, step: 1, fallback: 72 },
  lineHeight: { label: 'Line Height', min: 0.1, max: 5, step: 0.1, fallback: 1.2 },
  letterSpacing: { label: 'Letter Spacing', min: -100, max: 200, step: 0.1, fallback: 0 },
  strokeWidth: { label: 'Stroke Width', min: 0, max: 100, step: 0.1, fallback: 2 },
  shadowOffsetX: { label: 'Shadow Offset X', min: -500, max: 500, step: 1, fallback: 4 },
  shadowOffsetY: { label: 'Shadow Offset Y', min: -500, max: 500, step: 1, fallback: 4 },
  shadowBlur: { label: 'Shadow Blur', min: 0, max: 200, step: 0.1, fallback: 8 },
  // Free-range number for {value} tokens; the slider covers a practical span only.
  value: { label: 'Value', min: -1e9, max: 1e9, step: 0.01, fallback: 0, sliderMin: 0, sliderMax: 100 },
} as const;
export type TextNumericParameter = keyof typeof TEXT_NUMERIC_PARAMETERS;
export type TextProperty = `text.${TextNumericParameter}`;
export function parseTextProperty(path: string): TextNumericParameter | null {
  const key = path.startsWith('text.') ? path.slice(5) : '';
  return Object.hasOwn(TEXT_NUMERIC_PARAMETERS, key) ? key as TextNumericParameter : null;
}
export function normalizeTextValue(key: TextNumericParameter, value: number): number {
  const definition = TEXT_NUMERIC_PARAMETERS[key];
  return Number.isFinite(value) ? Math.max(definition.min, Math.min(definition.max, value)) : definition.fallback;
}
export function sampleTextProperties(properties: TextClipProperties, keyframes: readonly Keyframe[], time: number): TextClipProperties {
  const keys = keyframes.filter(key => parseTextProperty(key.property));
  if (!keys.length) return properties;
  const result = { ...properties };
  for (const key of Object.keys(TEXT_NUMERIC_PARAMETERS) as TextNumericParameter[]) {
    result[key] = normalizeTextValue(key, interpolateKeyframes(keys, `text.${key}`, time, properties[key] ?? TEXT_NUMERIC_PARAMETERS[key].fallback));
  }
  return result;
}
