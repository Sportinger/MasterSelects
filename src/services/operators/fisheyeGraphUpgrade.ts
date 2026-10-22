import type { EffectOperatorGraph } from '../../types/operatorGraph';
import { createDefaultFisheyeGraph } from './fisheyeEffectGraph';
import { effectRecipeFingerprint } from './recipeFingerprint';

/**
 * Fingerprint (recipeFingerprint.ts) of the Fisheye recipe that sampled the straight frame and
 * scaled colour together with coverage, which drew a dark rim along feathered lens and frame edges.
 * Frozen: never update it when the current recipe changes.
 */
export const STRAIGHT_ALPHA_FISHEYE_FINGERPRINT = 'b9f5caab4815a';
/**
 * Fingerprint of the premultiplied recipe whose Edge Sampling offsets ran round the pixel, so 2, 3, 5,
 * 6 and 7 samples were rounded down to 1 or 4 (the sample pairs now sit opposite each other). Frozen.
 */
export const QUAD_SAMPLES_FISHEYE_FINGERPRINT = 'a69606124ada9';
const UPGRADED_FINGERPRINTS: ReadonlySet<string | undefined> = new Set([STRAIGHT_ALPHA_FISHEYE_FINGERPRINT, QUAD_SAMPLES_FISHEYE_FINGERPRINT]);
const upgraded = new WeakMap<EffectOperatorGraph, EffectOperatorGraph>();

/**
 * An untouched saved Fisheye graph of an earlier recipe moves to the current one (deliberate fixes:
 * clean transparent edges, then every Edge Sampling count acting). Parameters keep their meaning.
 * Edited graphs, unfinished wiring and bypassed folders are user work and stay as saved.
 */
export function upgradeFisheyeGraph(source: EffectOperatorGraph): EffectOperatorGraph {
  if (source.incomplete || source.groups?.some(group => group.bypassed)) return source;
  const known = upgraded.get(source); if (known) return known;
  const result = UPGRADED_FINGERPRINTS.has(effectRecipeFingerprint(source)) ? createDefaultFisheyeGraph() : source;
  upgraded.set(source, result);
  return result;
}
