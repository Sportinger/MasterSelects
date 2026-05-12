export type ColorChannel = 'r' | 'g' | 'b';

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)));
}

function toHexByte(value: number): string {
  return clampColorChannel(value).toString(16).padStart(2, '0');
}

export function rgbColorToHex(color: RgbColor): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

export function normalizeHexColor(value: unknown, fallback = '#ffffff'): string {
  if (Array.isArray(value) && value.length >= 3) {
    const toByte = (channel: unknown) => {
      const numeric = Number(channel);
      return numeric >= 0 && numeric <= 1 ? numeric * 255 : numeric;
    };
    return rgbColorToHex({
      r: toByte(value[0]),
      g: toByte(value[1]),
      b: toByte(value[2]),
    });
  }

  if (typeof value === 'string') {
    const match = HEX_COLOR_PATTERN.exec(value.trim());
    if (match) {
      return `#${match[1].toLowerCase()}`;
    }
  }

  const fallbackMatch = HEX_COLOR_PATTERN.exec(fallback.trim());
  return fallbackMatch ? `#${fallbackMatch[1].toLowerCase()}` : '#ffffff';
}

export function hexColorToRgb(value: unknown, fallback = '#ffffff'): RgbColor {
  const hex = normalizeHexColor(value, fallback).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

export function getHexColorChannel(value: unknown, channel: ColorChannel, fallback = '#ffffff'): number {
  return hexColorToRgb(value, fallback)[channel];
}

export function setHexColorChannel(
  value: unknown,
  channel: ColorChannel,
  channelValue: number,
  fallback = '#ffffff',
): string {
  return rgbColorToHex({
    ...hexColorToRgb(value, fallback),
    [channel]: channelValue,
  });
}

export function parseColorChannelParamName(paramName: string): { paramId: string; channel: ColorChannel } | null {
  const match = /^(.+)\.(r|g|b)$/.exec(paramName);
  if (!match) {
    return null;
  }
  return { paramId: match[1], channel: match[2] as ColorChannel };
}
