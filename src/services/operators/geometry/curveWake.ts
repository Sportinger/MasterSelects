import type { OperatorDefinition, OperatorValue } from '../../../types/operatorGraph';
import { STRAND_CURVES_FORMAT } from './curveFormat';

export const CURVE_WAKE_NUMBERS = [
  ['count', 'Particles', 6000, 1, 65536, 1],
  ['opacity', 'Opacity', .5, 0, 1, .01],
  ['size', 'Particle Radius', .003, .0001, .1, .0001],
  ['lifetime', 'Lifetime (s)', 2, .1, 10, .1],
  ['speed', 'Drift Speed', .18, 0, 2, .01],
  ['drag', 'Drift Damping', 1.2, .01, 10, .01],
  ['curl', 'Curl Amount', .12, 0, 2, .01],
  ['curlRate', 'Curl Rate', .8, 0, 5, .01],
  ['pulseRate', 'Pulse Rate (Hz)', .4, 0, 10, .01],
  ['pulsePhase', 'Pulse Phase (turns)', 0, -1000000, 1000000, .01],
  ['waveLag', 'Wave Delay', 3.2, 0, 30, .01],
  ['waveFront', 'Wave Origin', .8, -10, 10, .01],
  ['waveScale', 'Wave Length Scale', 1, .001, 1000, .01],
  ['surfaceRadius', 'Surface Offset', .015, 0, 1, .001],
  ['seed', 'Seed', 41, 0, 99999, 1],
] as const;
export type CurveWakeSpec = Record<typeof CURVE_WAKE_NUMBERS[number][0], number> & { color: string };
export const CURVE_WAKE_OPERATOR: OperatorDefinition = {
  id: 'geometry.curve-wake', version: 1, label: 'Curve Particle Wake',
  description: 'A lightweight procedural wake sampled from final GPU curve positions. Pulses peel small 3D particles off the yarn into damped curly trails along local -Z. Connect Pulse Phase to the same unwrapped phase as the curve wave; Wave Delay/Origin/Length Scale match its longitudinal phase. Stateless and deterministic when seeking: a stylized current-shape wake, not a historical fluid or collision simulation. Pulse Rate 0 disables the wake; use opacity to fade it in/out. Place before Strand Render; one wake per strand layer. Bypass removes only the wake.',
  inputs: [{ id: 'curves', label: 'Curves', type: 'curves', required: true, contract: { formats: [STRAND_CURVES_FORMAT] } },
    ...CURVE_WAKE_NUMBERS.map(([id, label]) => ({ id, label, type: 'number' as const }))],
  outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: [STRAND_CURVES_FORMAT] } }],
  parameters: [...CURVE_WAKE_NUMBERS.map(([id, label, value, min, max, step]) =>
    ({ id, label, type: 'number' as const, default: value, min, max, step, animatable: true })),
    { id: 'color', label: 'Color', type: 'color', default: '#fff0d5', animatable: true }],
  runtime: 'builtin', invalidates: 'appearance', state: 'stateless', addable: true,
  implementation: 'shared', consumers: ['Weave'], bypass: 'passthrough',
};

export function readCurveWake(read: (id: string) => OperatorValue | undefined): CurveWakeSpec {
  const out: Record<string, unknown> = {};
  for (const [id, label, initial, min, max] of CURVE_WAKE_NUMBERS) {
    const value = read(id) ?? initial;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max
      || ((id === 'count' || id === 'seed') && !Number.isInteger(value)))
      throw new Error(`Curve Particle Wake: ${label} must be ${min}–${max}${id === 'count' || id === 'seed' ? ' (integer)' : ''}.`);
    out[id] = value;
  }
  const color = read('color') ?? '#fff0d5';
  if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new Error('Curve Particle Wake: use a six-digit color.');
  out.color = color;
  return out as CurveWakeSpec;
}

export function isCurveWake(value: unknown): value is CurveWakeSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set<string>(['color', ...CURVE_WAKE_NUMBERS.map(([id]) => id)]);
  if (Object.keys(record).some(key => !allowed.has(key)) || [...allowed].some(key => !(key in record))) return false;
  try { readCurveWake(id => record[id] as OperatorValue); return true; } catch { return false; }
}
