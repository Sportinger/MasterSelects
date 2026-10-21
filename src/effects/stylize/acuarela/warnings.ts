/**
 * Acuarela values the watercolour recipe clamps or treats specially (keyframes, overshooting
 * curves and tools can set any value). Named by parameter id; the inspector shows the label.
 */
type Params = Record<string, number | boolean | string>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function acuarelaParamWarnings(params: Params): string[] {
  // Effects saved with the original smoke recipe have no watercolour values and are not affected.
  if (params.wash === undefined && params.bleed === undefined) return [];
  const notes: string[] = [];
  const below = (id: string, minimum: number, meaning: string) => {
    const value = params[id];
    if (finite(value) && value < minimum) notes.push(`${id}: ${value} is below ${minimum}; it renders as ${meaning}.`);
  };
  below('wash', 0, '0 (no wash)');
  below('bleed', 0, '0 (no bleeding)');
  below('grainSize', 0.25, '0.25 (the finest grain)');
  for (const id of ['opacity', 'lift']) {
    const value = params[id];
    if (finite(value) && (value < 0 || value > 1)) notes.push(`${id}: ${value} is outside 0-1; it is clamped to ${value < 0 ? 0 : 1}.`);
  }
  const wash = params.wash;
  if (finite(wash) && wash > 12) notes.push(`wash: above 12 px the 7 x 7 wash taps spread apart and fine detail turns blotchy.`);
  return notes;
}
