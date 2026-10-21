import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { matchesEffectRecipe } from './effectFamilyPresentation';
import { createLegacyGlowGraph, createRingGlowGraph } from './glowEffectGraph';

import { createLegacyAlphaGlowGraph } from './legacyAlphaGlowGraph';

const alphaLegacy = createLegacyAlphaGlowGraph();
const legacy = createLegacyGlowGraph();
const ring = createRingGlowGraph();
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
const ringGraphs = new WeakMap<EffectOperatorGraph, boolean>();
/**
 * Replace an untouched saved v1 graph (any presentation: packed compositions, folders,
 * layout) with the v2 ring recipe, as before the bloom existed: saved Glows keep the ring
 * look they were authored with. Graphs with edited nodes, wiring, exposed values or
 * bypassed folders are user work and stay as saved.
 */
export function upgradeGlowGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  if (!matchesEffectRecipe(source, legacy) && !matchesEffectRecipe(source, alphaLegacy)) { upgraded.set(source, source); return source; }
  const result = createRingGlowGraph();
  upgraded.set(source, result); upgraded.set(result, result);
  return result;
}

/** True for the untouched ring recipe (v1 or v2, any presentation): a Glow saved before the bloom. */
export function isRingGlowGraph(source: EffectOperatorGraph | undefined): boolean {
  if (!source || source.incomplete) return false;
  const known = ringGraphs.get(source); if (known !== undefined) return known;
  const result = matchesEffectRecipe(upgradeGlowGraph(source), ring);
  ringGraphs.set(source, result);
  return result;
}

