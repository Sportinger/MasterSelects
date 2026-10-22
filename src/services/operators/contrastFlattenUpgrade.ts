import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultContrastGraph, createFormerContrastGraph } from './colorEffectGraphs';
import { matchesEffectRecipe } from './effectFamilyPresentation';

const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();
let former: EffectOperatorGraph | undefined;

/**
 * Bug fix of 2026-10-22: the Contrast recipe saved between the 2026-10 rebuild and this date ran
 * the S-curve family below Amount 1 too, an inverse S whose slope at black and white is infinite,
 * so 8-bit shadow noise became colour blotches (Amount 0.3 turned one code value into about 40).
 * A saved graph that is exactly that recipe gets the current one, which is identical from Amount 1
 * up and flattens toward mid-grey below it. Edited graphs keep what their author built.
 */
export function flattenContrastGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  const known = upgraded.get(source); if (known) return known;
  former ??= createFormerContrastGraph();
  const result = matchesEffectRecipe(source, former) ? createDefaultContrastGraph() : source;
  upgraded.set(source, result); upgraded.set(result, result);
  return result;
}
