import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from '../operators/effectFamilyPresentation';
import { createLegacyColorEffectGraph } from '../operators/legacyColorEffectGraphs';

/** Diagnostic code: an adjustment-layer color effect that the worker GPU color matrix does not reproduce. */
export const ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED = 'adjustment-color-recipe-unsupported';

type MatrixColorType = 'brightness' | 'contrast' | 'saturation';
const MATRIX_COLOR_TYPES: ReadonlySet<string> = new Set<MatrixColorType>(['brightness', 'contrast', 'saturation']);
const originals = new Map<MatrixColorType, EffectOperatorGraph>();
const verdicts = new WeakMap<EffectOperatorGraph, boolean>();

export interface WorkerGpuAdjustmentColorDivergence {
  readonly code: typeof ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED;
  readonly effectId: string;
  readonly effectType: MatrixColorType;
  readonly message: string;
}

/**
 * The worker GPU adjustment executor renders Brightness, Contrast and Saturation as the original
 * linear 4×5 color matrices (offset, scale around 0.5, luma mix without a gamut limit). Only an
 * effect that still carries the original graph looks like that; a new effect (2026-10 curve and
 * gamut-safe recipes, or no graph yet) or an edited graph renders differently there than on the
 * main GPU path and in export. Lists those effects so the divergence is reported, not silent.
 */
export function workerGpuAdjustmentColorDivergences(
  effects: readonly { id: string; type: string; enabled?: boolean; operatorGraph?: EffectOperatorGraph }[],
): WorkerGpuAdjustmentColorDivergence[] {
  return effects.flatMap((effect) => {
    if (effect.enabled === false || !MATRIX_COLOR_TYPES.has(effect.type)) return [];
    const effectType = effect.type as MatrixColorType;
    if (effect.operatorGraph && isOriginalColorGraph(effectType, effect.operatorGraph)) return [];
    return [{
      code: ADJUSTMENT_COLOR_RECIPE_UNSUPPORTED,
      effectId: effect.id,
      effectType,
      message: `Worker GPU render modes draw adjustment-layer ${effectType} with the original linear color matrix; `
        + 'this effect uses the current recipe or an edited graph, so it looks different there than in the preview and export.',
    }];
  });
}

function isOriginalColorGraph(type: MatrixColorType, graph: EffectOperatorGraph): boolean {
  const known = verdicts.get(graph);
  if (known !== undefined) return known;
  let original = originals.get(type);
  if (!original) { original = createLegacyColorEffectGraph(type); originals.set(type, original); }
  const verdict = matchesEffectRecipe(graph, original);
  verdicts.set(graph, verdict);
  return verdict;
}
