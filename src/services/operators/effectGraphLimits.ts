import type { EffectOperatorGraph } from '../../types/operatorGraph';

export interface EffectGraphLimits { readonly nodes: number; readonly edges: number }
/**
 * Effect graphs have no node or edge cap (decision 2026-10-28, user): a recipe or a hand-built graph
 * may be as large as its look needs. The per-domain names stay so callers keep one lookup.
 */
const UNLIMITED: EffectGraphLimits = { nodes: Number.POSITIVE_INFINITY, edges: Number.POSITIVE_INFINITY };
export const LEGACY_EFFECT_GRAPH_LIMITS = UNLIMITED;
export const IMAGE_EFFECT_GRAPH_LIMITS = UNLIMITED;
export const ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS = UNLIMITED;
export const SCENE_EFFECT_GRAPH_LIMITS = UNLIMITED;
export const GEOMETRY_EFFECT_GRAPH_LIMITS = UNLIMITED;
// Independent formation, circulation and inherited force branches need bounded headroom.
// These are generated expressions, not a fixed-size GPU register array.
export const GEOMETRY_FIELD_INSTRUCTION_LIMIT = 640;
/**
 * Instructions of one compiled image plan (the generated shader). Raised from 2048 with the node cap's
 * removal (2026-10-28, user): large recipes such as Data HUD need several thousand; the bound only stops
 * runaway expansion of kernel and sequence scopes.
 */
export const IMAGE_SCOPED_INSTRUCTION_LIMIT = 16384;

/** Durable graph limits by domain (all unlimited, see UNLIMITED). */
export function effectGraphLimits(domain: EffectOperatorGraph['domain'] | undefined): EffectGraphLimits {
  return domain === 'image' || domain === 'compute-image' ? IMAGE_EFFECT_GRAPH_LIMITS
    : domain === 'analog-signal' ? ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS
    : domain === 'geometry' ? GEOMETRY_EFFECT_GRAPH_LIMITS
    : domain === 'scene' ? SCENE_EFFECT_GRAPH_LIMITS : LEGACY_EFFECT_GRAPH_LIMITS;
}
