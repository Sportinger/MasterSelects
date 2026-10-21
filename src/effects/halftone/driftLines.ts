// Drift Lines: its presets and the note for bands too thin to show. The recipe is the editable graph
// in src/services/operators/motionHalftoneEffectGraphs.ts (createDriftLinesGraph) and its shader twin
// driftLinesFragment; Band Size (scale) counts pixels of a 1080p frame (shorter side).
import type { EffectPreset } from '../types';

/** Frame height Band Size is measured on: a 4K or 720p frame shows the same bands as 1080p. */
export const DRIFT_LINES_REFERENCE_HEIGHT = 1080;

export const DRIFT_LINES_PRESETS: readonly EffectPreset[] = [
  // Fine rows, a small drift: the picture shimmers like air over a hot floor.
  { id: 'heat-haze', name: 'Heat Haze', params: { scale: 3, amount: 0.05, speed: 0.6 } },
  // Broad bands that slide slowly, shaded like half-open blinds.
  { id: 'venetian-blinds', name: 'Venetian Blinds', params: { scale: 54, amount: 0.3, speed: 0.25 } },
  // Thin columns that run up and down.
  { id: 'rain-curtain', name: 'Rain Curtain', params: { scale: 6, amount: 0.25, angle: 90, speed: 1.6 } },
  // Fine rows torn the full width, fast.
  { id: 'torn-signal', name: 'Torn Signal', params: { scale: 6, amount: 1, speed: 3 } },
];

const finite = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Bands thinner than one pixel of the frame cannot show: they render one pixel tall (small frames only). */
export function driftLinesWarnings(params: Record<string, number | boolean | string>, width = 1920, height = 1080): string[] {
  const scale = Math.max(finite(params.scale, 14), 2);
  const shortSide = Math.min(width, height);
  if (!(shortSide > 0) || scale * shortSide / DRIFT_LINES_REFERENCE_HEIGHT >= 1) return [];
  return [`Band Size ${Number(scale.toPrecision(4))} px is thinner than one pixel on this ${width}×${height} frame; the bands render 1 pixel tall.`];
}
