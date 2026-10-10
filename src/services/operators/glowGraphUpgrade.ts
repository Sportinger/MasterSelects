import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createDefaultGlowGraph, createLegacyGlowGraph } from './glowEffectGraph';

import { createLegacyAlphaGlowGraph } from './legacyAlphaGlowGraph';

const alphaLegacy = createLegacyAlphaGlowGraph();
const legacy = createLegacyGlowGraph();
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
/**
 * Replace an untouched saved v1 graph (any presentation: packed compositions, folders,
 * layout) with the v2 recipe. Graphs with edited nodes, wiring, exposed values or
 * bypassed folders are user work and stay as saved.
 */
export function upgradeGlowGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  if (!matchesEffectRecipe(source, legacy) && !matchesEffectRecipe(source, alphaLegacy)) { upgraded.set(source, source); return source; }
  const result = createDefaultGlowGraph();
  upgraded.set(source, result); upgraded.set(result, result);
  return result;
}
