// Composition formats the phone offers, at 1080 px on the short side, and how a size maps back
// to one of them. Pure.

export type PhoneFormatPresetId = '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | '21:9';

export const PHONE_FORMAT_PRESETS: readonly { id: PhoneFormatPresetId; label: string; hint: string; width: number; height: number }[] = [
  { id: '9:16', label: '9:16', hint: 'Stories, Reels, Shorts', width: 1080, height: 1920 },
  { id: '16:9', label: '16:9', hint: 'Widescreen', width: 1920, height: 1080 },
  { id: '1:1', label: '1:1', hint: 'Square', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', hint: 'Portrait post', width: 1080, height: 1350 },
  { id: '4:3', label: '4:3', hint: 'Classic', width: 1440, height: 1080 },
  { id: '21:9', label: '21:9', hint: 'Cinema', width: 2520, height: 1080 },
];

export type PhoneFormatLayout = 'relative' | 'pixels';

export function phoneFormatPresetFor(width: number, height: number): PhoneFormatPresetId | null {
  return PHONE_FORMAT_PRESETS.find((preset) => preset.width === width && preset.height === height)?.id ?? null;
}

/** Aspect label of any size, e.g. 1280x720 -> "16:9", 1000x700 -> "10:7". */
export function phoneAspectLabel(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const w = Math.round(width), h = Math.round(height);
  if (w <= 0 || h <= 0) return '–';
  const divisor = gcd(w, h);
  return `${w / divisor}:${h / divisor}`;
}
