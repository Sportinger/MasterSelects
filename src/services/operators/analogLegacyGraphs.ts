import type { Effect } from '../../types/effects';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM } from './effectGraph';
import { createLegacyCrtScreenGraph } from './legacyCrtScreenGraph';
import { createLegacyGlitchGraph } from './legacyGlitchGraph';
import { createLegacyFilmPrismGraph } from './legacyFilmPrismGraph';
import { createLegacyHoloGraph } from './legacyHoloGraph';
import { createLegacyRibbonScanGraph } from './legacyRibbonScanGraph';

/**
 * Analog effects whose look was rebuilt in the 2026-10 analog review. Saved effects keep the look
 * they were made with:
 * - a saved graph (every project saved since effect graphs exist stores one) stays as saved;
 * - an effect saved before effect graphs existed, or a custom Look entry saved before the rebuild,
 *   carries only parameters. New effects always carry every default parameter, so one without the
 *   recipe's `marker` parameter is old data: it is given the frozen original graph.
 * The original graphs bind the original parameters only; the new recipe parameters are
 * `graphOnly` and hide on such an effect.
 */
const REBUILT: Record<string, { marker: string; original: () => EffectOperatorGraph }> = {
  'crt-screen': { marker: 'lineCount', original: createLegacyCrtScreenGraph },
  glitch: { marker: 'density', original: createLegacyGlitchGraph },
  'film-prism': { marker: 'grain', original: createLegacyFilmPrismGraph },
  holo: { marker: 'stripes', original: createLegacyHoloGraph },
  'ribbon-scan': { marker: 'edges', original: createLegacyRibbonScanGraph },
};

export function isRebuiltAnalogEffectType(type: string): boolean { return Object.hasOwn(REBUILT, type); }

/** True when parameters of a graph-less instance predate the rebuilt recipe of `type`. */
export function predatesAnalogRecipe(type: string, params: Record<string, unknown>): boolean {
  return isRebuiltAnalogEffectType(type) && params[REBUILT[type].marker] === undefined;
}

/** The frozen original graph of a rebuilt analog effect type. */
export function originalAnalogGraph(type: string): EffectOperatorGraph | undefined {
  return isRebuiltAnalogEffectType(type) ? REBUILT[type].original() : undefined;
}

/** Project-file entry: a graph-less rebuilt analog effect from before the rebuild gets its original graph. */
export function pinOriginalAnalogGraph(effect: Effect): Effect {
  if (effect.operatorGraph || effect.params[EFFECT_GRAPH_PARAM] !== undefined || !predatesAnalogRecipe(effect.type, effect.params)) return effect;
  return { ...effect, operatorGraph: REBUILT[effect.type].original() };
}
