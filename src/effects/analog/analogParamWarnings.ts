import type { EffectParam } from '../types';

type Values = Record<string, number | boolean | string>;
const format = (value: number) => Number(value.toPrecision(4)).toString();

/**
 * Notes for numbers outside the range a recipe renders (keyframe overshoot, tool calls and node
 * drivers do not clamp): the recipe clamps them, and these notes say so instead of failing silently.
 */
export function clampedValueNotes(definitions: Record<string, EffectParam>, values: Values,
  ranges: Record<string, readonly [number, number]>): string[] {
  return Object.entries(ranges).flatMap(([param, [min, max]]) => {
    const value = values[param];
    if (typeof value !== 'number') return [];
    const label = definitions[param]?.label ?? param;
    if (!Number.isFinite(value)) return [`${label} is not a finite number, so the effect cannot render it.`];
    if (value >= min && value <= max) return [];
    const rendered = value < min ? min : max;
    return [`${label} ${format(value)} is outside the rendered range ${format(min)} to ${format(max)} and renders as ${format(rendered)}.`];
  });
}
