// Text style of the phone title sheet: the subset of the editor's TextClipProperties the phone edits
// (font, size, spacing, colour, outline, shadow, alignment), how it is read from a clip at the
// playhead and how it is written back through the same store actions the desktop Text inspector
// uses. Keyframeable numbers (text.fontSize, ...) go through setPropertyValue, so an animated value
// gets a keyframe at the playhead exactly like on the desktop; plain values go through
// updateTextProperties.

import { googleFontsService } from '../../../services/googleFontsService';
import { normalizeTextValue, TEXT_NUMERIC_PARAMETERS } from '../../../services/text/textAnimation';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES } from '../../../stores/timeline/constants';
import type { TextClipProperties } from '../../../types/text';
import type { TimelineClip } from '../../../types/timeline';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';

/** Keyframeable numbers of the style (text.<name> keyframe properties). */
export const PHONE_TEXT_NUMBERS = [
  'fontSize', 'letterSpacing', 'lineHeight', 'strokeWidth', 'shadowOffsetX', 'shadowOffsetY', 'shadowBlur',
] as const;
export type PhoneTextNumber = typeof PHONE_TEXT_NUMBERS[number];

export interface PhoneTextStyle {
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  color: string;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
  textAlign: TextClipProperties['textAlign'];
  verticalAlign: TextClipProperties['verticalAlign'];
}

const STYLE_KEYS: readonly (keyof PhoneTextStyle)[] = [
  'fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'letterSpacing', 'lineHeight', 'color',
  'strokeEnabled', 'strokeColor', 'strokeWidth', 'shadowEnabled', 'shadowColor', 'shadowOffsetX',
  'shadowOffsetY', 'shadowBlur', 'textAlign', 'verticalAlign',
];

/** Phone slider ranges: practical spans inside the editor's limits (TEXT_NUMERIC_PARAMETERS). */
export const PHONE_TEXT_RANGES: Record<PhoneTextNumber, { min: number; max: number; step: number }> = {
  fontSize: { min: 8, max: 400, step: 1 },
  letterSpacing: { min: -20, max: 100, step: 0.5 },
  lineHeight: { min: 0.5, max: 3, step: 0.05 },
  strokeWidth: { min: 0, max: 40, step: 0.5 },
  shadowOffsetX: { min: -100, max: 100, step: 1 },
  shadowOffsetY: { min: -100, max: 100, step: 1 },
  shadowBlur: { min: 0, max: 100, step: 0.5 },
};

export function pickPhoneTextStyle(properties: Partial<TextClipProperties>): PhoneTextStyle {
  const base = { ...DEFAULT_TEXT_PROPERTIES, ...properties };
  const style = {} as Record<keyof PhoneTextStyle, unknown>;
  for (const key of STYLE_KEYS) style[key] = base[key];
  return style as unknown as PhoneTextStyle;
}

export const DEFAULT_PHONE_TEXT_STYLE: PhoneTextStyle = pickPhoneTextStyle(DEFAULT_TEXT_PROPERTIES);

/** The clip's style as it renders at clip-local `time`: animated numbers are sampled from their keyframes. */
export function readPhoneTextStyle(clip: TimelineClip, time: number): PhoneTextStyle {
  const style = pickPhoneTextStyle(clip.textProperties ?? {});
  const keys = useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [];
  const local = Math.max(0, Math.min(clip.duration, time));
  for (const key of PHONE_TEXT_NUMBERS) {
    style[key] = interpolateKeyframes(keys, `text.${key}`, local, style[key] ?? TEXT_NUMERIC_PARAMETERS[key].fallback);
  }
  return style;
}

/** Fonts the phone offers: the editor's default system font first, then the editor's web fonts. */
export function getPhoneTextFonts(): readonly { family: string; category: string }[] {
  return [
    { family: DEFAULT_TEXT_PROPERTIES.fontFamily, category: 'system' },
    ...googleFontsService.getAvailableFonts().map((font) => ({ family: font.family, category: font.category })),
  ];
}

/** Nearest available weight of `family` to `weight` (same rule as the desktop font picker). */
export function nearestFontWeight(family: string, weight: number): number {
  // System fonts (the default Arial) are not in the web-font table; the browser has regular and bold.
  const weights = googleFontsService.isManagedFont(family) ? googleFontsService.getAvailableWeights(family) : [400, 700];
  return weights.reduce((best, candidate) => (Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best), weights[0] ?? 400);
}

/** Bold toggles between the nearest weight to 400 and to 700 of the family. */
export function toggledBoldWeight(family: string, weight: number): number {
  return weight >= 600 ? nearestFontWeight(family, 400) : nearestFontWeight(family, 700);
}

const EPSILON = 1e-6;

/**
 * Writes text + style to the clip as ABSOLUTE values (safe to repeat). A number that already has
 * text keyframes is set through setPropertyValue (keyframe at the playhead, like the desktop
 * inspector) and only when it differs, so re-applying never adds spurious keyframes.
 */
export function writePhoneTextDraft(clipId: string, text: string, style: PhoneTextStyle): void {
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip?.textProperties) return;
  // Only fields that differ from what the clip has (missing fields count as the editor default).
  const current = pickPhoneTextStyle(clip.textProperties) as unknown as Record<string, unknown>;
  const patch: Partial<TextClipProperties> = clip.textProperties.text === text ? {} : { text };
  const animated: { key: PhoneTextNumber; value: number }[] = [];
  for (const key of STYLE_KEYS) {
    let value: unknown = style[key];
    if ((PHONE_TEXT_NUMBERS as readonly string[]).includes(key)) {
      const numberKey = key as PhoneTextNumber;
      value = normalizeTextValue(numberKey, value as number);
      if (state.hasKeyframes(clipId, `text.${numberKey}`)) { animated.push({ key: numberKey, value: value as number }); continue; }
    }
    if (current[key] !== value) (patch as Record<string, unknown>)[key] = value;
  }
  if (Object.keys(patch).length > 0) state.updateTextProperties(clipId, patch);
  if (animated.length === 0) return;
  const time = state.playheadPosition - clip.startTime;
  const now = readPhoneTextStyle(useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId) ?? clip, time);
  for (const { key, value } of animated) {
    if (Math.abs(now[key] - value) > EPSILON) useTimelineStore.getState().setPropertyValue(clipId, `text.${key}`, value);
  }
}

/** True when `style` differs from `other` in any field. */
export function phoneTextStyleDiffers(style: PhoneTextStyle, other: PhoneTextStyle): boolean {
  return STYLE_KEYS.some((key) => {
    const a = style[key];
    const b = other[key];
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > EPSILON : a !== b;
  });
}
