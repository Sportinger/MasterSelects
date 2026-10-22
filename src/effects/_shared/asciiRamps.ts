// The character ramps of the glyph engine: dark tones pick characters from the start of a ramp, bright
// tones from its end. A Custom Ramp replaces the named one.
export const ASCII_RAMP_PRESETS = {
  standard: ' .:-=+*#%@',
  detailed: ' .\'`^",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks: ' ░▒▓█',
  bars: ' ▁▂▃▄▅▆▇█',
  binary: ' 01',
  numeric: ' 123456789',
  symbols: ' ·×+*#@',
} as const;

export type AsciiRampPreset = keyof typeof ASCII_RAMP_PRESETS;

/** Names in the Ramp menu, in menu order. */
export const ASCII_RAMP_LABELS: Record<AsciiRampPreset, string> = {
  standard: 'Standard', detailed: 'Detailed', blocks: 'Blocks', bars: 'Bars', binary: 'Binary', numeric: 'Numeric', symbols: 'Symbols',
};

/**
 * Most characters a ramp holds: an 8-bit picture has no more tone steps, and the glyph atlas stays small
 * (a much longer ramp used to exceed the GPU's texture size and left the layer empty).
 */
export const ASCII_RAMP_MAX_CHARACTERS = 256;

const customCharacters = (customRamp: string | undefined) => Array.from(customRamp?.trimEnd() ?? '');

/** A longer ramp keeps 256 characters spread evenly from its first to its last, so it still runs from dark to bright. */
function spreadRamp(characters: string[]): string[] {
  const last = characters.length - 1, steps = ASCII_RAMP_MAX_CHARACTERS - 1;
  return Array.from({ length: ASCII_RAMP_MAX_CHARACTERS }, (_, index) => characters[Math.round(index * last / steps)]);
}

/** The characters an effect draws: the Custom Ramp (one character or more; trailing spaces ignored) or the named ramp. */
export function resolveAsciiRamp(preset: string, customRamp?: string): string {
  const custom = customCharacters(customRamp);
  if (custom.length) return (custom.length > ASCII_RAMP_MAX_CHARACTERS ? spreadRamp(custom) : custom).join('');
  return ASCII_RAMP_PRESETS[preset as AsciiRampPreset] ?? ASCII_RAMP_PRESETS.standard;
}

/** Notes for the card and the tools when the drawn ramp differs from what the controls say. */
export function asciiRampWarnings(preset: unknown, customRamp: unknown): string[] {
  const custom = customCharacters(typeof customRamp === 'string' ? customRamp : '');
  if (custom.length > ASCII_RAMP_MAX_CHARACTERS) {
    return [`Custom Ramp has ${custom.length} characters; ${ASCII_RAMP_MAX_CHARACTERS} of them are drawn, spread evenly from the first to the last.`];
  }
  if (!custom.length && typeof preset === 'string' && !(preset in ASCII_RAMP_PRESETS)) {
    return [`Ramp "${preset}" is unknown; the Standard ramp is drawn.`];
  }
  return [];
}
