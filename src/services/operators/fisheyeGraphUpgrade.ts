import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultFisheyeGraph } from './fisheyeEffectGraph';
import { effectRecipeFingerprint } from './recipeFingerprint';

/**
 * Fingerprint (recipeFingerprint.ts) of the Fisheye recipe that sampled the straight frame and
 * scaled colour together with coverage, which drew a dark rim along feathered lens and frame edges.
 * Frozen: never update it when the current recipe changes.
 */
export const STRAIGHT_ALPHA_FISHEYE_FINGERPRINT = 'b9f5caab4815a';
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/**
 * An untouched saved Fisheye graph of the straight-alpha recipe moves to the current premultiplied
 * recipe (a deliberate fix: same lens, clean transparent edges). Parameters keep their meaning.
 * Edited graphs, unfinished wiring and bypassed folders are user work and stay as saved.
 */
export function upgradeFisheyeGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  const result = effectRecipeFingerprint(source) === STRAIGHT_ALPHA_FISHEYE_FINGERPRINT ? createDefaultFisheyeGraph() : source;
  upgraded.set(source, result);
  return result;
}
