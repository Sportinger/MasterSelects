import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultRom1Graph, createRom1GraphBefore20261022 } from './rom1EffectGraph';
import { kneeRom1GainGraph } from './smokeGainUpgrade';

let straight: EffectOperatorGraph | undefined;
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/**
 * Saved Rom1 graphs: the Gain knee first (kneeRom1GainGraph), then an untouched copy of the recipe saved before
 * 2026-10-22 (any presentation) becomes the current premultiplied recipe. A bug fix: the old recipe faded a trail's
 * straight colour with its alpha, so smoke outside a cut-out layer turned dark; on opaque layers both recipes paint
 * the same pixels. Edited graphs are user work and stay as saved.
 */
export function upgradeRom1Graph(source: EffectOperatorGraph): EffectOperatorGraph {
  const kneed = kneeRom1GainGraph(source);
  if (kneed.incomplete || kneed.groups?.some(group => group.bypassed)) return kneed;
  const known = upgraded.get(kneed); if (known) return known;
  straight ??= createRom1GraphBefore20261022();
  const result = matchesEffectRecipe(kneed, straight) ? createDefaultRom1Graph() : kneed;
  upgraded.set(kneed, result); upgraded.set(result, result);
  return result;
}
