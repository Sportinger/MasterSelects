import { CELL_REFERENCE_HEIGHT } from '../../services/operators/cellGridRecipes';

/** Rendered pixels per 1080p pixel: the shorter frame side over 1080. */
export const cellPixelScale = (width = 1920, height = 1080) => Math.min(width, height) / CELL_REFERENCE_HEIGHT;

/**
 * A cell size the recipe raises to its minimum (`minimum` rendered pixels): say so. `atMinimum`
 * says what such cells show (Blockify still posterizes 1-pixel cells; Block Mosaic draws 2-pixel tiles).
 */
export function cellSizeWarnings(id: string, value: unknown, minimum: number, width: number | undefined, height: number | undefined, atMinimum: string): string[] {
  if (typeof value !== 'number') return [];
  const rendered = Math.floor(value * cellPixelScale(width, height) + 0.5);
  if (rendered >= minimum) return [];
  return [`${id}: ${value} is below ${minimum} rendered pixel${minimum === 1 ? '' : 's'} at ${width ?? 1920}×${height ?? 1080}; ${atMinimum}.`];
}

/**
 * Pixelate below one rendered pixel is the picture itself, the intended end of a reveal: no note.
 * Only values that are not a size at all (negative, not finite) are reported.
 */
export function pixelSizeWarnings(value: unknown): string[] {
  if (typeof value !== 'number' || value >= 0) return [];
  return [`size: ${value} is below 0; Pixelate shows the picture unchanged.`];
}

/** Amount mixes with the original between 0 and 1; values outside are clamped. */
export function amountWarnings(value: unknown): string[] {
  return typeof value === 'number' && (value < 0 || value > 1) ? [`amount: ${value} is outside 0–1; the effect uses ${value < 0 ? 0 : 1}.`] : [];
}
