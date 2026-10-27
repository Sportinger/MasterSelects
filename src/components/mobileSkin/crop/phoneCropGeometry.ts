// Pure crop and transform math of the crop & transform sheet. Crop values are the desktop
// inspector's (source pixels per edge plus softness, resolveCropMask.ts); transform values are
// the clip transform in the units the desktop inspector shows (pixels, percent, degrees).

import type { ResolveCropValues } from '../../panels/properties/transformTab/resolveCropMask';
import type { TimelineClip } from '../../../types/timeline';
import type { PhoneSize } from './phoneClipTarget';

export type PhoneCropRatioId = 'free' | '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | '3:4';

export const PHONE_CROP_RATIOS: readonly { id: PhoneCropRatioId; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
];

export const NO_CROP: ResolveCropValues = { left: 0, right: 0, top: 0, bottom: 0, softness: 0 };

/** Largest centred crop of `ratio` (width / height) inside the source; softness is kept. */
export function phoneRatioCrop(source: PhoneSize, ratio: number, softness = 0): ResolveCropValues {
  const sourceRatio = source.width / source.height;
  if (Math.abs(sourceRatio - ratio) < 1e-6) return { ...NO_CROP, softness };
  if (sourceRatio > ratio) {
    const side = (source.width - source.height * ratio) / 2;
    return { left: side, right: side, top: 0, bottom: 0, softness };
  }
  const side = (source.height - source.width / ratio) / 2;
  return { left: 0, right: 0, top: side, bottom: side, softness };
}

export function isPhoneCropEmpty(values: ResolveCropValues): boolean {
  return values.left < 1e-6 && values.right < 1e-6 && values.top < 1e-6 && values.bottom < 1e-6;
}

/** The ratio chip a crop matches (a centred ratio crop), else 'free'. An empty crop matches nothing. */
export function detectPhoneCropRatio(values: ResolveCropValues, source: PhoneSize): PhoneCropRatioId | null {
  if (isPhoneCropEmpty(values)) return null;
  for (const entry of PHONE_CROP_RATIOS) {
    if (entry.ratio === null) continue;
    const expected = phoneRatioCrop(source, entry.ratio);
    if (isPhoneCropEmpty(expected)) continue;
    const close = (['left', 'right', 'top', 'bottom'] as const).every((edge) => Math.abs(expected[edge] - values[edge]) < 0.5);
    if (close) return entry.id;
  }
  return 'free';
}

/** Sets one edge in percent of the source side, keeping at least 1 % of the picture. */
export function setPhoneCropEdge(values: ResolveCropValues, edge: 'left' | 'right' | 'top' | 'bottom', percent: number, source: PhoneSize): ResolveCropValues {
  const horizontal = edge === 'left' || edge === 'right';
  const side = horizontal ? source.width : source.height;
  const opposite = horizontal ? (edge === 'left' ? values.right : values.left) : (edge === 'top' ? values.bottom : values.top);
  const max = Math.max(0, side * 0.99 - opposite);
  const pixels = Math.min(max, Math.max(0, (percent / 100) * side));
  return { ...values, [edge]: pixels };
}

export interface PhoneTransformValues {
  /** Offset from the centre in composition pixels. */
  x: number;
  y: number;
  /** Uniform scale on top of the clip's own fit (1 = as placed). */
  scale: number;
  /** Magnitudes of the axis scales (the fit the clip was placed with). */
  scaleX: number;
  scaleY: number;
  rotation: number;
  /** 0..1 */
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

export type PhoneTransformKey = 'position.x' | 'position.y' | 'scale.all' | 'scale.x' | 'scale.y' | 'rotation.z' | 'opacity';

export function readPhoneTransform(transform: TimelineClip['transform'], comp: PhoneSize): PhoneTransformValues {
  return {
    x: transform.position.x * (comp.width / 2),
    y: transform.position.y * (comp.height / 2),
    scale: transform.scale.all ?? 1,
    scaleX: Math.abs(transform.scale.x) || 1,
    scaleY: Math.abs(transform.scale.y) || 1,
    rotation: transform.rotation.z,
    opacity: transform.opacity,
    flipH: transform.scale.x < 0,
    flipV: transform.scale.y < 0,
  };
}

/** Stored property value for one transform key (what setPropertyValue receives). */
export function phoneTransformPropertyValue(key: PhoneTransformKey, values: PhoneTransformValues, comp: PhoneSize): number {
  switch (key) {
    case 'position.x': return values.x / (comp.width / 2);
    case 'position.y': return values.y / (comp.height / 2);
    case 'scale.all': return values.scale;
    case 'scale.x': return values.flipH ? -values.scaleX : values.scaleX;
    case 'scale.y': return values.flipV ? -values.scaleY : values.scaleY;
    case 'rotation.z': return values.rotation;
    case 'opacity': return Math.min(1, Math.max(0, values.opacity));
  }
}

/** Transform with position, rotation, opacity, uniform scale and flips back at their defaults; the fit stays. */
export function resetPhoneTransform(values: PhoneTransformValues): PhoneTransformValues {
  return { ...values, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
}
