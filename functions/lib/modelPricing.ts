/**
 * Model-weighted credit costs (Option B).
 *
 * Each model has a fixed credit cost per request. The base unit is 1 credit
 * for the cheapest models (nano/mini). Expensive models cost proportionally
 * more credits so that break-even is maintained across all plans.
 *
 * Pricing reference (USD per 1M tokens, March 2026):
 *   gpt-4.1-nano:   $0.10 in / $0.40 out   → ~$0.0003/req → 1 credit
 *   gpt-4.1-mini:   $0.40 in / $1.60 out   → ~$0.0012/req → 1 credit
 *   gpt-4o-mini:    $0.15 in / $0.60 out   → ~$0.0005/req → 1 credit
 *   gpt-5-nano:     $0.05 in / $0.40 out   → ~$0.0003/req → 1 credit
 *   gpt-5-mini:     $0.25 in / $2.00 out   → ~$0.0013/req → 1 credit
 *   gpt-4o:         $2.50 in / $10.00 out  → ~$0.0075/req → 5 credits
 *   gpt-4.1:        $2.00 in / $8.00 out   → ~$0.006/req  → 5 credits
 *   gpt-5:          $1.25 in / $10.00 out  → ~$0.006/req  → 5 credits
 *   gpt-5.1:        ~$2 in / ~$8 out       → ~$0.006/req  → 5 credits
 *   o4-mini:        $1.10 in / $4.40 out   → ~$0.003/req  → 3 credits
 *   o3-mini:        $1.10 in / $4.40 out   → ~$0.003/req  → 3 credits
 *   o3:             $2.00 in / $8.00 out   → ~$0.006/req  → 5 credits (+ reasoning tokens)
 *   gpt-5.1-codex:  ~$2 in / ~$8 out      → ~$0.006/req  → 5 credits
 *   gpt-5.2:        ~$3 in / ~$12 out     → ~$0.008/req  → 8 credits
 *   gpt-5.2-pro:    ~$5 in / ~$20 out     → ~$0.013/req  → 10 credits
 *   o3-pro:         $20 in / $80 out       → ~$0.06/req   → 50 credits
 */

export interface ModelPricingEntry {
  /** Credits consumed per request */
  creditCost: number;
  /** Tier label for UI display */
  tier: 'low' | 'mid' | 'high' | 'premium';
}

const MODEL_PRICING: Record<string, ModelPricingEntry> = {
  // --- Tier: low (1 credit) ---
  'gpt-4.1-nano':       { creditCost: 1,  tier: 'low' },
  'gpt-4.1-mini':       { creditCost: 1,  tier: 'low' },
  'gpt-4o-mini':        { creditCost: 1,  tier: 'low' },
  'gpt-5-nano':         { creditCost: 1,  tier: 'low' },
  'gpt-5-mini':         { creditCost: 1,  tier: 'low' },
  'gpt-5.1-codex-mini': { creditCost: 1,  tier: 'low' },

  // --- Tier: mid (3 credits) ---
  'o4-mini':            { creditCost: 3,  tier: 'mid' },
  'o3-mini':            { creditCost: 3,  tier: 'mid' },

  // --- Tier: high (5 credits) ---
  'gpt-4o':             { creditCost: 5,  tier: 'high' },
  'gpt-4.1':            { creditCost: 5,  tier: 'high' },
  'gpt-5':              { creditCost: 5,  tier: 'high' },
  'gpt-5.1':            { creditCost: 5,  tier: 'high' },
  'gpt-5.1-codex':      { creditCost: 5,  tier: 'high' },
  'o3':                 { creditCost: 5,  tier: 'high' },

  // --- Tier: premium (8-50 credits) ---
  'gpt-5.2':            { creditCost: 8,  tier: 'premium' },
  'gpt-5.2-pro':        { creditCost: 10, tier: 'premium' },
  'o3-pro':             { creditCost: 50, tier: 'premium' },
};

/** Default cost for unknown models */
const DEFAULT_CREDIT_COST: ModelPricingEntry = { creditCost: 5, tier: 'high' };

/** Look up credit cost for a model. Unknown models default to 5 (high tier). */
export function getModelCreditCost(model: string): number {
  return (MODEL_PRICING[model] ?? DEFAULT_CREDIT_COST).creditCost;
}

/** Look up full pricing entry for a model. */
export function getModelPricing(model: string): ModelPricingEntry {
  return MODEL_PRICING[model] ?? DEFAULT_CREDIT_COST;
}

/** Get all known model pricing entries (for capabilities/UI). */
export function getAllModelPricing(): Record<string, ModelPricingEntry> {
  return { ...MODEL_PRICING };
}
