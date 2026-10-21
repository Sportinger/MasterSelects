import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultChromaKeyGraph } from './chromaKeyEffectGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyChromaKeyGraph } from './legacyChromaKeyEffectGraph';

let legacy: EffectOperatorGraph | undefined;
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/**
 * Replace an untouched saved Rec.601 chroma-distance graph (any presentation) with the screen-matte
 * keyer. Graphs with edited nodes, wiring, exposed values or bypassed folders are user work and stay
 * as saved; they keep reading the retired Tolerance and Edge Softness parameters.
 */
export function upgradeChromaKeyGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  legacy ??= createLegacyChromaKeyGraph();
  const result = matchesEffectRecipe(source, legacy) ? createDefaultChromaKeyGraph() : source;
  upgraded.set(source, result);
  return result;
}
