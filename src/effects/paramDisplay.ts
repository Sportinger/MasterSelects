// How inspectors show a stored effect number. Display only: project data, keyframes, tool calls
// and MIDI keep the parameter's own unit (radians, turns, pixels).
import type { EffectParam } from './types';

/** A shown value is the stored one × scale, with this suffix, step and number of decimals. */
export interface ParamDisplay {
  readonly scale: number;
  readonly suffix?: string;
  readonly step?: number;
  readonly decimals?: number;
}

/** Decimals a step implies (0.5 → 1, 0.05 → 2, 0.001 → 3), so values read like the slider moves. */
export function stepDecimals(step: number): number {
  if (!(step > 0)) return 0;
  const fraction = /\.(\d+)$/.exec(String(Number(step.toPrecision(6))))?.[1];
  return Math.min(4, fraction ? fraction.length : step >= 1 ? 0 : Math.ceil(-Math.log10(step)));
}

/**
 * Few enough decimals that a value with its unit (" EV", "°") fits the field, but as many as the
 * stored value needs (up to 3), so a stored 0.25 EV never reads 0.3 EV.
 */
export function unitFieldDecimals(step: number, value: number): number {
  let decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  while (decimals < 3 && Number.isFinite(value) && Math.abs(Number(value.toFixed(decimals)) - value) > 1e-6) decimals += 1;
  return decimals;
}

const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * The display of one number parameter: `displayUnit: 'degrees'` shows radians as whole degrees
 * (Twirl's Twist, Kaleidoscope's Rotation); `displayScale` with `unit` shows a scaled unit (Hue
 * Shift's turns as degrees) and `unit` alone a suffix (" EV"), with as many decimals as the value
 * needs; other rows show the stored value at the decimals its step implies.
 */
export function effectParamDisplay(definition: Pick<EffectParam, 'step' | 'displayUnit' | 'displayScale' | 'unit'>, value?: number): ParamDisplay {
  if (definition.displayUnit === 'degrees') return { scale: RADIANS_TO_DEGREES, suffix: '°', step: 1, decimals: 0 };
  const scale = definition.displayScale ?? 1, step = (definition.step ?? 0.01) * scale;
  return { scale, step, ...(definition.unit
    ? { suffix: definition.unit, decimals: unitFieldDecimals(step, (value ?? 0) * scale) }
    : { decimals: stepDecimals(step) }) };
}
