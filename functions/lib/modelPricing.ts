import {
  DEFAULT_OPENAI_MODEL_PRICING,
  getOpenAiModelPricing,
  OPENAI_MODEL_CATALOG,
  type OpenAiModelTier,
} from '../../src/shared/openAiModelCatalog';

/**
 * Shared hosted-chat pricing.
 *
 * The source of truth lives in src/shared/openAiModelCatalog.ts so the chat
 * dropdown and the Cloudflare billing route stay aligned.
 */
export interface ModelPricingEntry {
  /** Credits consumed per request */
  creditCost: number;
  /** Tier label for UI display */
  tier: OpenAiModelTier;
}

/** Look up credit cost for a model. Unknown models use the shared default. */
export function getModelCreditCost(model: string): number {
  return getOpenAiModelPricing(model).creditCost;
}

/** Look up full pricing entry for a model. */
export function getModelPricing(model: string): ModelPricingEntry {
  return getOpenAiModelPricing(model);
}

/** Get all known model pricing entries (for capabilities/UI). */
export function getAllModelPricing(): Record<string, ModelPricingEntry> {
  return Object.fromEntries(
    OPENAI_MODEL_CATALOG.map((entry) => [
      entry.id,
      {
        creditCost: entry.creditCost,
        tier: entry.tier,
      },
    ]),
  );
}

export { DEFAULT_OPENAI_MODEL_PRICING };
