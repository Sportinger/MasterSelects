export interface TimelineSpectralRgbColor {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, mix: number): number {
  return start + (end - start) * mix;
}

function mixColor(
  a: TimelineSpectralRgbColor,
  b: TimelineSpectralRgbColor,
  mix: number,
): TimelineSpectralRgbColor {
  return {
    r: Math.round(lerp(a.r, b.r, mix)),
    g: Math.round(lerp(a.g, b.g, mix)),
    b: Math.round(lerp(a.b, b.b, mix)),
  };
}

function spectralColorRaw(value: number): TimelineSpectralRgbColor {
  const intensity = Math.pow(clamp01((value - 0.015) * 1.08), 0.72);
  const stops: Array<{ at: number; color: TimelineSpectralRgbColor }> = [
    { at: 0, color: { r: 3, g: 7, b: 14 } },
    { at: 0.16, color: { r: 11, g: 24, b: 48 } },
    { at: 0.34, color: { r: 21, g: 70, b: 112 } },
    { at: 0.54, color: { r: 35, g: 154, b: 165 } },
    { at: 0.72, color: { r: 218, g: 183, b: 86 } },
    { at: 0.88, color: { r: 232, g: 83, b: 52 } },
    { at: 1, color: { r: 245, g: 248, b: 255 } },
  ];

  for (let index = 0; index < stops.length - 1; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (intensity <= next.at) {
      return mixColor(
        current.color,
        next.color,
        (intensity - current.at) / Math.max(0.001, next.at - current.at),
      );
    }
  }

  return stops[stops.length - 1].color;
}

const SPECTRAL_COLOR_LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let index = 0; index < 256; index += 1) {
    const color = spectralColorRaw(index / 255);
    const offset = index * 3;
    lut[offset] = color.r;
    lut[offset + 1] = color.g;
    lut[offset + 2] = color.b;
  }
  return lut;
})();

export function getTimelineSpectralColor(value: number): TimelineSpectralRgbColor {
  const lutIndex = Math.max(0, Math.min(255, Math.round(clamp01(value) * 255))) * 3;
  return {
    r: SPECTRAL_COLOR_LUT[lutIndex] ?? 0,
    g: SPECTRAL_COLOR_LUT[lutIndex + 1] ?? 0,
    b: SPECTRAL_COLOR_LUT[lutIndex + 2] ?? 0,
  };
}

export function writeTimelineSpectralColor(
  pixels: Uint8ClampedArray,
  offset: number,
  value: number,
  alpha = 236,
): void {
  const color = getTimelineSpectralColor(value);
  pixels[offset] = color.r;
  pixels[offset + 1] = color.g;
  pixels[offset + 2] = color.b;
  pixels[offset + 3] = alpha;
}
