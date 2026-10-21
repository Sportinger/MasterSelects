import type { EffectParam } from '../types';
import { DISTORT_EDGE_OPTIONS, DISTORT_SHAPE_OPTIONS } from '../../services/operators/uvDistortRecipes';
import common from './uvDistortCommon.wgsl?raw';

export const UV_DISTORT_COMMON_WGSL = common;

/** Circle keeps the area round on any frame; Stretch to Frame is the original per-axis ellipse.
 * graphOnly: an edited saved graph without this control hides it instead of showing a dead control. */
export const SHAPE_PARAM: EffectParam = { type: 'select', label: 'Shape', default: 'circle', options: DISTORT_SHAPE_OPTIONS, graphOnly: true };
/** What a sample that leaves the frame shows. Clamp is the original behaviour. */
export const EDGES_PARAM: EffectParam = { type: 'select', label: 'Frame Edges', default: 'mirror', options: DISTORT_EDGE_OPTIONS, graphOnly: true };

const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const distortNumber = finite;
export const shapeIndex = (value: unknown) => value === 'frame' ? 1 : 0;
export const edgeIndex = (value: unknown) => Math.max(0, DISTORT_EDGE_OPTIONS.findIndex(option => option.value === value));

/** Radius at or below zero leaves no area to distort: say so instead of silently passing the picture through. */
export function radiusWarnings(params: Record<string, number | boolean | string>): string[] {
  const radius = params.radius;
  return typeof radius === 'number' && !(radius > 0)
    ? [`radius: ${radius} leaves no area to distort, so the picture is unchanged. Use a radius above 0 (0.5 = half the shorter frame side).`] : [];
}
