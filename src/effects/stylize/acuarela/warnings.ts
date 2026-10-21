/**
 * Acuarela values the watercolour recipe clamps or treats specially (keyframes, overshooting
 * curves and tools can set any value). Named by parameter id; the inspector shows the label.
 * Effects saved with the original smoke recipe get the smoke notes (shared with Rom1).
 */
import { hasLegacyAcuarelaParams } from '../../../services/operators/acuarelaEffectGraph';
import { rom1ParamWarnings } from '../rom1/warnings';
import { ACUARELA_DENSITY_MAX } from '../../../services/operators/acuarelaWatercolorGraph';

type Params = Record<string, number | boolean | string>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Pigment density terms at their largest: 1 + 1.5 Edges + 0.84 Granulation + 0.55 Blooms (see acuarelaWatercolorGraph.ts). */
const DENSITY_LIMIT = ACUARELA_DENSITY_MAX;

export function acuarelaParamWarnings(params: Params): string[] {
  // The smoke recipe clamps Gain to 0-1 (a lift of at most 0.35); its other notes are Rom1's.
  if (hasLegacyAcuarelaParams(params)) return rom1ParamWarnings(params)
    .map(note => note.startsWith('gain:') && finite(params.gain) && params.gain > 1 ? `gain: ${params.gain} is outside 0-1; it is clamped to 1.` : note);
  const notes: string[] = [];
  const below = (id: string, minimum: number, meaning: string) => {
    const value = params[id];
    if (finite(value) && value < minimum) notes.push(`${id}: ${value} is below ${minimum}; it renders as ${meaning}.`);
  };
  below('wash', 0, '0 (no wash)');
  below('bleed', 0, '0 (no bleeding)');
  below('grainSize', 0.25, '0.25 (the finest grain)');
  for (const id of ['opacity', 'lift', 'simplify', 'shadows']) {
    const value = params[id];
    if (finite(value) && (value < 0 || value > 1)) notes.push(`${id}: ${value} is outside 0-1; it is clamped to ${value < 0 ? 0 : 1}.`);
  }
  const inverted: Record<string, string> = { edges: 'lightens the pooled side of every edge', blooms: 'turns blooms into dark spots with light rims',
    granulation: 'lifts pigment out of the paper valleys', paper: 'inverts the paper relief' };
  for (const [id, meaning] of Object.entries(inverted)) {
    const value = params[id];
    if (finite(value) && value < 0) notes.push(`${id}: ${value} is below 0 and ${meaning}.`);
    else if (finite(value) && value > 2) notes.push(`${id}: ${value} is above the 0-2 range; the effect is exaggerated.`);
  }
  const wash = params.wash;
  if (finite(wash) && wash > 12) notes.push(`wash: above 12 px the 7 x 7 wash taps spread apart and fine detail turns grainy.`);
  const term = (id: string, weight: number) => finite(params[id]) ? Math.max(0, params[id] as number) * weight : 0;
  const peak = 1 + term('edges', 1.5) + term('granulation', 0.84) + term('blooms', 0.55);
  if (peak > DENSITY_LIMIT) notes.push(`density: Edges, Granulation and Blooms together can reach a pigment density of ${peak.toFixed(2)}; it is clamped to ${DENSITY_LIMIT}, so the darkest strokes flatten.`);
  return notes;
}
