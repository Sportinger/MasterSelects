// Shared runtime helpers for transitions.
// Easing is applied to progress centrally (in the compositor) so all transitions
// support it uniformly; hexToRgb is used by packUniforms for color parameters.

export type EasingMode = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

/**
 * Remap a linear progress value (0..1) through an easing curve.
 */
export function applyEasing(progress: number, mode: string | undefined): number {
  const p = Math.min(1, Math.max(0, progress));
  switch (mode) {
    case 'ease-in':
      return p * p;
    case 'ease-out':
      return 1 - (1 - p) * (1 - p);
    case 'ease-in-out':
      return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    case 'linear':
    default:
      return p;
  }
}

/**
 * Convert a CSS hex color (#rgb or #rrggbb) to normalized [r, g, b] floats (0..1).
 * Falls back to black on malformed input.
 */
export function hexToRgb(hex: string | number | boolean | undefined): [number, number, number] {
  if (typeof hex !== 'string') return [0, 0, 0];
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return [0, 0, 0];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}
