export const ASCII_RAMP_PRESETS = {
  standard: ' .:-=+*#%@',
  detailed: ' .\'`^",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks: ' ░▒▓█',
  binary: ' 01',
  numeric: ' 123456789',
  symbols: ' ·×+*#@',
} as const;

export type AsciiRampPreset = keyof typeof ASCII_RAMP_PRESETS;

export function resolveAsciiRamp(preset: string, customRamp?: string): string {
  const custom = customRamp?.trimEnd();
  if (custom && Array.from(custom).length >= 2) return custom;
  return ASCII_RAMP_PRESETS[preset as AsciiRampPreset] ?? ASCII_RAMP_PRESETS.standard;
}
