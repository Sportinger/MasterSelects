// Reading the parameters of the Generate effects: any value can arrive (AI tools, keyframes, bezier
// overshoot, old saves), so packers read finite numbers with the default as fallback and name
// choices they replace (no silent failure). Number clamps are declared as renderMin/renderMax on
// the parameter and reported by paramRangeNotes.
import type { EffectParam } from '../types';
import { finiteEffectNumber } from '../_shared/effectNumberParam';

type Params = Record<string, number | boolean | string>;

/** The parameter as a finite number; NaN, ±Infinity and unusable text read as `fallback`. */
export function finiteParam(params: Params, key: string, fallback: number): number {
  return finiteEffectNumber(params[key], fallback);
}

/** Choices that are not one of the options render as the default: say which. */
export function generatorChoiceWarnings(definitions: Record<string, EffectParam>, params: Params, ids: readonly string[]): string[] {
  return ids.flatMap(id => {
    const value = params[id], definition = definitions[id];
    if (value === undefined || !definition?.options || definition.options.some(option => option.value === value)) return [];
    return [`${id}: "${String(value)}" is not an option; using ${String(definition.default)}.`];
  });
}
