/**
 * Number-to-text tokens for text clips.
 *
 *   {value}         keyframeable/linked Value, up to 2 decimals (trailing zeros trimmed)
 *   {value:1}       fixed decimals (0-6)
 *   {value*100:0}   scaled before formatting, e.g. speed 6.83 -> "683"
 *   {time} {time:2} clip-local seconds
 *   {frame}         clip-local frame number at the composition frame rate
 *   {timecode}      clip-local HH:MM:SS:FF timecode at the composition frame rate
 *
 * Unknown `{...}` sequences stay literal text.
 */
const TOKEN_PATTERN = /\{(value|time|frame|timecode)(?:\*(-?\d+(?:\.\d+)?))?(?::(\d))?\}/g;

export interface TextValueTemplateVariables {
  value: number;
  time: number;
  /** Frame rate for {frame}/{timecode}; defaults to 30. */
  fps?: number;
}

type TokenName = 'value' | 'time' | 'frame' | 'timecode';

function frameIndex(time: number, fps: number): number {
  return Math.max(0, Math.floor(Math.max(0, time) * fps + 1e-6));
}

export function formatTextTimecode(time: number, fps: number): string {
  const rate = Math.max(1, Math.round(fps));
  const frames = frameIndex(time, fps);
  const seconds = Math.floor(frames / rate);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(frames % rate)}`;
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
  const fps = variables.fps && Number.isFinite(variables.fps) && variables.fps > 0 ? variables.fps : 30;
  return text.replace(TOKEN_PATTERN, (_match, name: TokenName, scale?: string, decimals?: string) => {
    if (name === 'timecode') return formatTextTimecode(variables.time, fps);
    const raw = name === 'frame' ? frameIndex(variables.time, fps) : variables[name];
    return formatTextValueNumber(raw * (scale === undefined ? 1 : Number(scale)),
      decimals === undefined ? (name === 'frame' ? 0 : undefined) : Number(decimals));
  });
}
