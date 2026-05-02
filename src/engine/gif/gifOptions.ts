export type GifDither =
  | 'sierra2_4a'
  | 'floyd_steinberg'
  | 'bayer'
  | 'none';

export type GifLoopMode = 'forever' | 'once';
export type GifPaletteMode = 'global' | 'per-frame';

export interface GifExportOptions {
  gifColors?: number;
  gifDither?: GifDither;
  gifLoop?: GifLoopMode;
  gifPaletteMode?: GifPaletteMode;
  gifOptimize?: boolean;
  gifAlphaThreshold?: number;
}

export interface GifSizeEstimateInput extends Required<GifExportOptions> {
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
}

export interface GifSizeEstimate {
  bytes: number;
  minBytes: number;
  maxBytes: number;
  frameCount: number;
  bytesPerPixelFrame: number;
}

export const GIF_COLOR_PRESETS = [64, 128, 256] as const;

export const GIF_DITHER_OPTIONS: Array<{ id: GifDither; label: string; sizeFactor: number }> = [
  { id: 'sierra2_4a', label: 'Sierra', sizeFactor: 1.22 },
  { id: 'floyd_steinberg', label: 'Floyd', sizeFactor: 1.18 },
  { id: 'bayer', label: 'Bayer', sizeFactor: 1.08 },
  { id: 'none', label: 'None', sizeFactor: 0.82 },
];

export const GIF_PALETTE_MODES: Array<{ id: GifPaletteMode; label: string; sizeFactor: number }> = [
  { id: 'global', label: 'Global', sizeFactor: 0.94 },
  { id: 'per-frame', label: 'Per-frame', sizeFactor: 1.08 },
];

export function clampGifColors(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 256;
  }
  return Math.max(2, Math.min(256, Math.round(value ?? 256)));
}

export function clampGifAlphaThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 128;
  }
  return Math.max(0, Math.min(255, Math.round(value ?? 128)));
}

export function getGifDitherLabel(dither: GifDither): string {
  return GIF_DITHER_OPTIONS.find((entry) => entry.id === dither)?.label ?? 'Sierra';
}

export function getGifPaletteModeLabel(mode: GifPaletteMode): string {
  return GIF_PALETTE_MODES.find((entry) => entry.id === mode)?.label ?? 'Global';
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB';
  }

  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const decimals = unitIndex <= 1 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

export function estimateGifSize(input: GifSizeEstimateInput): GifSizeEstimate {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const fps = Math.max(1, input.fps);
  const durationSeconds = Math.max(0, input.durationSeconds);
  const frameCount = Math.max(1, Math.ceil(durationSeconds * fps));
  const colors = clampGifColors(input.gifColors);
  const dither = GIF_DITHER_OPTIONS.find((entry) => entry.id === input.gifDither) ?? GIF_DITHER_OPTIONS[0];
  const paletteMode = GIF_PALETTE_MODES.find((entry) => entry.id === input.gifPaletteMode) ?? GIF_PALETTE_MODES[0];

  const colorFactor = 0.24 + (colors / 256) * 0.38;
  const optimizeFactor = input.gifOptimize ? 0.9 : 1;
  const bytesPerPixelFrame = Math.max(
    0.16,
    Math.min(1.35, colorFactor * dither.sizeFactor * paletteMode.sizeFactor * optimizeFactor),
  );

  const pixelPayload = width * height * frameCount * bytesPerPixelFrame;
  const paletteBytes = colors * 3;
  const perFrameOverhead = 42 + (input.gifPaletteMode === 'per-frame' ? paletteBytes : 0);
  const overhead = 96 + paletteBytes + frameCount * perFrameOverhead;
  const bytes = Math.round(pixelPayload + overhead);

  return {
    bytes,
    minBytes: Math.round(bytes * 0.55),
    maxBytes: Math.round(bytes * 1.75),
    frameCount,
    bytesPerPixelFrame,
  };
}
