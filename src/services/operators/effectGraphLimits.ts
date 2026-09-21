import type { EffectOperatorGraph } from '../../types/operatorGraph';

export interface EffectGraphLimits { readonly nodes: number; readonly edges: number }
export const LEGACY_EFFECT_GRAPH_LIMITS: EffectGraphLimits = { nodes: 64, edges: 256 };
export const IMAGE_EFFECT_GRAPH_LIMITS: EffectGraphLimits = { nodes: 512, edges: 2048 };
/** The canonical 140-node/209-edge Analog graph keeps bounded editing headroom. */
export const ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS: EffectGraphLimits = { nodes: 256, edges: 512 };
/** Expanded lexical scopes are bounded independently from the persisted graph. */
export const IMAGE_SCOPED_INSTRUCTION_LIMIT = 2048;

/** Durable graph limits are domain-specific; non-image formats retain their original caps. */
export function effectGraphLimits(domain: EffectOperatorGraph['domain'] | undefined): EffectGraphLimits {
  return domain === 'image' || domain === 'compute-image' ? IMAGE_EFFECT_GRAPH_LIMITS
    : domain === 'analog-signal' ? ANALOG_SIGNAL_EFFECT_GRAPH_LIMITS : LEGACY_EFFECT_GRAPH_LIMITS;
}
