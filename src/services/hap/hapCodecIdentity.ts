// HAP codec identity: FourCC classification shared by import, provider
// selection, decode, and export. Mirrors turboResCodecIdentity so runtime
// provider planning treats both codec families uniformly.

export const HAP_VIDEO_FOURCCS = ['hap1', 'hap5', 'hapy', 'hapm', 'hapa'] as const;

/** Normalized (lowercase) HAP sample-description FourCC. */
export type HapVideoFourCC = (typeof HAP_VIDEO_FOURCCS)[number];

/** Encoder-facing HAP flavor selection (same ids as the export settings). */
export type HapEncodeVariant = 'hap' | 'hap_alpha' | 'hap_q';

export function normalizeHapCodecId(codecId: unknown): string | undefined {
  if (typeof codecId !== 'string') return undefined;
  const normalized = codecId.trim();
  if (!normalized) return undefined;
  return normalized.length === 4 ? normalized.toLowerCase() : normalized;
}

export function getHapVideoFourCC(codecId: unknown): HapVideoFourCC | undefined {
  const normalized = normalizeHapCodecId(codecId);
  return HAP_VIDEO_FOURCCS.includes(normalized as HapVideoFourCC)
    ? normalized as HapVideoFourCC
    : undefined;
}

export function isHapCodecId(codecId: unknown): boolean {
  return getHapVideoFourCC(codecId) !== undefined;
}

export type HapCodecDecision =
  | { kind: 'hap'; fourCC: HapVideoFourCC }
  | { kind: 'not-hap'; codecId?: string };

export function decideHapCodec(codecId: unknown): HapCodecDecision {
  const fourCC = getHapVideoFourCC(codecId);
  if (fourCC) return { kind: 'hap', fourCC };
  return { kind: 'not-hap', codecId: normalizeHapCodecId(codecId) };
}

export function getHapCodecLabel(codecId: unknown): string | undefined {
  switch (getHapVideoFourCC(codecId)) {
    case 'hap1': return 'HAP';
    case 'hap5': return 'HAP Alpha';
    case 'hapy': return 'HAP Q';
    case 'hapm': return 'HAP Q Alpha';
    case 'hapa': return 'HAP Alpha-Only';
    default: return undefined;
  }
}

/** Container sample-description FourCC written by the muxer (case matters). */
export function hapContainerFourCC(variant: HapEncodeVariant): string {
  switch (variant) {
    case 'hap': return 'Hap1';
    case 'hap_alpha': return 'Hap5';
    case 'hap_q': return 'HapY';
  }
}

export function hapEncodeVariantLabel(variant: HapEncodeVariant): string {
  switch (variant) {
    case 'hap': return 'HAP';
    case 'hap_alpha': return 'HAP Alpha';
    case 'hap_q': return 'HAP Q';
  }
}

/** Whether the flavor carries alpha (drives sample-description depth). */
export function hapVariantHasAlpha(variant: HapEncodeVariant): boolean {
  return variant === 'hap_alpha';
}

/** Decoded plane layout per FourCC, in frame order. */
export function hapDecodePlanes(fourCC: HapVideoFourCC): readonly (
  | 'bc1'
  | 'bc3'
  | 'ycocg-bc3'
  | 'bc4-alpha'
  | 'bc4-luma'
)[] {
  switch (fourCC) {
    case 'hap1': return ['bc1'];
    case 'hap5': return ['bc3'];
    case 'hapy': return ['ycocg-bc3'];
    case 'hapm': return ['ycocg-bc3', 'bc4-alpha'];
    case 'hapa': return ['bc4-luma'];
  }
}

export function hapFourCCHasAlpha(fourCC: HapVideoFourCC): boolean {
  return fourCC === 'hap5' || fourCC === 'hapm';
}
