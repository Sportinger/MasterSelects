/**
 * Number-to-text tokens for text clips.
 *
 *   {value}         keyframeable/linked Value, up to 2 decimals (trailing zeros trimmed)
 *   {value:1}       fixed decimals (0-6)
 *   {value*100:0}   scaled before formatting, e.g. speed 6.83 -> "683"
 *   {time} {time:2} clip-local seconds
 *
 * Unknown `{...}` sequences stay literal text.
 */
const TOKEN_PATTERN = /\{(value|time)(?:\*(-?\d+(?:\.\d+)?))?(?::(\d))?\}/g;

export interface TextValueTemplateVariables {
  value: number;
  time: number;
}

export function hasTextValueTokens(text: string | undefined): boolean {
  if (!text || !text.includes('{')) return false;
  TOKEN_PATTERN.lastIndex = 0;
  return TOKEN_PATTERN.test(text);
}

export function formatTextValueNumber(value: number, decimals?: number): string {
  if (!Number.isFinite(value)) return '0';
  if (decimals !== undefined) {
    const fixed = value.toFixed(Math.min(6, decimals));
    return /^-0(\.0*)?$/.test(fixed) ? fixed.slice(1) : fixed;
  }
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatTextValueTemplate(text: string, variables: TextValueTemplateVariables): string {
  if (!text.includes('{')) return text;
  return text.replace(TOKEN_PATTERN, (_match, name: 'value' | 'time', scale?: string, decimals?: string) =>
    formatTextValueNumber(variables[name] * (scale === undefined ? 1 : Number(scale)),
      decimals === undefined ? undefined : Number(decimals)));
}
