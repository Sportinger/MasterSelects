export type OpenAiModelTier = 'low' | 'mid' | 'high' | 'premium';
export type OpenAiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAiModelCatalogEntry {
  creditCost: number;
  defaultReasoningEffort: OpenAiReasoningEffort | null;
  id: string;
  inputUsdPerMillionTokens: number;
  label: string;
  outputUsdPerMillionTokens: number;
  supportedReasoningEfforts: OpenAiReasoningEffort[];
  tier: OpenAiModelTier;
  visibleInChatDropdown: boolean;
}

const REPRESENTATIVE_INPUT_TOKENS = 1_000;
const REPRESENTATIVE_OUTPUT_TOKENS = 500;
const CREDIT_ROUNDING_EPSILON = 1e-9;
const GPT_5_LATEST_REASONING_EFFORTS: OpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const GPT_5_1_REASONING_EFFORTS: OpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high'];
const GPT_5_LEGACY_REASONING_EFFORTS: OpenAiReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
const O_SERIES_REASONING_EFFORTS: OpenAiReasoningEffort[] = ['low', 'medium', 'high'];

// Approximate one hosted credit from current paid plan pricing in PricingDialog.
// This keeps chat requests close to break-even instead of the older, looser mapping.
const USD_PER_HOSTED_CREDIT = 0.00125;

function estimateCreditCost(inputUsdPerMillionTokens: number, outputUsdPerMillionTokens: number): number {
  const estimatedRequestUsd =
    (inputUsdPerMillionTokens * REPRESENTATIVE_INPUT_TOKENS) / 1_000_000
    + (outputUsdPerMillionTokens * REPRESENTATIVE_OUTPUT_TOKENS) / 1_000_000;

  return Math.max(1, Math.ceil((estimatedRequestUsd / USD_PER_HOSTED_CREDIT) - CREDIT_ROUNDING_EPSILON));
}

function inferTier(creditCost: number): OpenAiModelTier {
  if (creditCost <= 1) {
    return 'low';
  }

  if (creditCost <= 3) {
    return 'mid';
  }

  if (creditCost <= 8) {
    return 'high';
  }

  return 'premium';
}

function defineModel(input: Omit<OpenAiModelCatalogEntry, 'creditCost' | 'tier'>): OpenAiModelCatalogEntry {
  const creditCost = estimateCreditCost(input.inputUsdPerMillionTokens, input.outputUsdPerMillionTokens);

  return {
    ...input,
    creditCost,
    tier: inferTier(creditCost),
  };
}

export const DEFAULT_OPENAI_MODEL_ID = 'gpt-5.1';

export const OPENAI_MODEL_CATALOG: OpenAiModelCatalogEntry[] = [
  // Current frontier GPT-5.4 family
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.4',
    inputUsdPerMillionTokens: 2.5,
    label: 'GPT-5.4',
    outputUsdPerMillionTokens: 15,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.4-mini',
    inputUsdPerMillionTokens: 0.75,
    label: 'GPT-5.4 Mini',
    outputUsdPerMillionTokens: 4.5,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.4-nano',
    inputUsdPerMillionTokens: 0.2,
    label: 'GPT-5.4 Nano',
    outputUsdPerMillionTokens: 1.25,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),

  // Chat-oriented and coding-oriented GPT-5 successors
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.3-chat-latest',
    inputUsdPerMillionTokens: 1.75,
    label: 'GPT-5.3 Chat',
    outputUsdPerMillionTokens: 14,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.3-codex',
    inputUsdPerMillionTokens: 1.75,
    label: 'GPT-5.3 Codex',
    outputUsdPerMillionTokens: 14,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.2',
    inputUsdPerMillionTokens: 1.75,
    label: 'GPT-5.2',
    outputUsdPerMillionTokens: 14,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.2-codex',
    inputUsdPerMillionTokens: 1.75,
    label: 'GPT-5.2 Codex',
    outputUsdPerMillionTokens: 14,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.1',
    inputUsdPerMillionTokens: 1.25,
    label: 'GPT-5.1',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: GPT_5_1_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.1-codex-mini',
    inputUsdPerMillionTokens: 0.25,
    label: 'GPT-5.1 Codex Mini',
    outputUsdPerMillionTokens: 2,
    supportedReasoningEfforts: GPT_5_1_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),

  // Previous GPT-5 generation
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'gpt-5',
    inputUsdPerMillionTokens: 1.25,
    label: 'GPT-5',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: GPT_5_LEGACY_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'gpt-5-mini',
    inputUsdPerMillionTokens: 0.25,
    label: 'GPT-5 Mini',
    outputUsdPerMillionTokens: 2,
    supportedReasoningEfforts: GPT_5_LEGACY_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'gpt-5-nano',
    inputUsdPerMillionTokens: 0.05,
    label: 'GPT-5 Nano',
    outputUsdPerMillionTokens: 0.4,
    supportedReasoningEfforts: GPT_5_LEGACY_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),

  // Reasoning models that still work with Chat Completions
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'o3',
    inputUsdPerMillionTokens: 2,
    label: 'o3',
    outputUsdPerMillionTokens: 8,
    supportedReasoningEfforts: O_SERIES_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'o4-mini',
    inputUsdPerMillionTokens: 1.1,
    label: 'o4-mini',
    outputUsdPerMillionTokens: 4.4,
    supportedReasoningEfforts: O_SERIES_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'o3-mini',
    inputUsdPerMillionTokens: 1.1,
    label: 'o3-mini',
    outputUsdPerMillionTokens: 4.4,
    supportedReasoningEfforts: O_SERIES_REASONING_EFFORTS,
    visibleInChatDropdown: true,
  }),

  // GPT-4.x and GPT-4o fallbacks
  defineModel({
    defaultReasoningEffort: null,
    id: 'gpt-4.1',
    inputUsdPerMillionTokens: 2,
    label: 'GPT-4.1',
    outputUsdPerMillionTokens: 8,
    supportedReasoningEfforts: [],
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: null,
    id: 'gpt-4.1-mini',
    inputUsdPerMillionTokens: 0.4,
    label: 'GPT-4.1 Mini',
    outputUsdPerMillionTokens: 1.6,
    supportedReasoningEfforts: [],
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: null,
    id: 'gpt-4.1-nano',
    inputUsdPerMillionTokens: 0.1,
    label: 'GPT-4.1 Nano',
    outputUsdPerMillionTokens: 0.4,
    supportedReasoningEfforts: [],
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: null,
    id: 'gpt-4o',
    inputUsdPerMillionTokens: 2.5,
    label: 'GPT-4o',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: [],
    visibleInChatDropdown: true,
  }),
  defineModel({
    defaultReasoningEffort: null,
    id: 'gpt-4o-mini',
    inputUsdPerMillionTokens: 0.15,
    label: 'GPT-4o Mini',
    outputUsdPerMillionTokens: 0.6,
    supportedReasoningEfforts: [],
    visibleInChatDropdown: true,
  }),

  // Hidden pricing entries for models we should not expose in this Chat Completions UI.
  defineModel({
    defaultReasoningEffort: 'high',
    id: 'gpt-5.4-pro',
    inputUsdPerMillionTokens: 30,
    label: 'GPT-5.4 Pro',
    outputUsdPerMillionTokens: 180,
    supportedReasoningEfforts: ['high'],
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.2-pro',
    inputUsdPerMillionTokens: 21,
    label: 'GPT-5.2 Pro',
    outputUsdPerMillionTokens: 168,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'high',
    id: 'gpt-5-pro',
    inputUsdPerMillionTokens: 15,
    label: 'GPT-5 Pro',
    outputUsdPerMillionTokens: 120,
    supportedReasoningEfforts: ['high'],
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'o3-pro',
    inputUsdPerMillionTokens: 20,
    label: 'o3-pro',
    outputUsdPerMillionTokens: 80,
    supportedReasoningEfforts: O_SERIES_REASONING_EFFORTS,
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'medium',
    id: 'gpt-5-codex',
    inputUsdPerMillionTokens: 1.25,
    label: 'GPT-5 Codex',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: GPT_5_LEGACY_REASONING_EFFORTS,
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.1-codex',
    inputUsdPerMillionTokens: 1.25,
    label: 'GPT-5.1 Codex',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: GPT_5_1_REASONING_EFFORTS,
    visibleInChatDropdown: false,
  }),
  defineModel({
    defaultReasoningEffort: 'none',
    id: 'gpt-5.1-codex-max',
    inputUsdPerMillionTokens: 1.25,
    label: 'GPT-5.1 Codex Max',
    outputUsdPerMillionTokens: 10,
    supportedReasoningEfforts: GPT_5_LATEST_REASONING_EFFORTS,
    visibleInChatDropdown: false,
  }),
];

export const DEFAULT_OPENAI_MODEL_PRICING = {
  creditCost: 5,
  tier: 'high' as const,
};

const OPENAI_MODEL_PRICING_MAP = Object.fromEntries(
  OPENAI_MODEL_CATALOG.map((model) => [
    model.id,
    {
      creditCost: model.creditCost,
      tier: model.tier,
    },
  ]),
) as Record<string, { creditCost: number; tier: OpenAiModelTier }>;

export const OPENAI_CHAT_DROPDOWN_MODELS = OPENAI_MODEL_CATALOG.filter((model) => model.visibleInChatDropdown);

export function getOpenAiModelPricing(modelId: string): { creditCost: number; tier: OpenAiModelTier } {
  return OPENAI_MODEL_PRICING_MAP[modelId] ?? DEFAULT_OPENAI_MODEL_PRICING;
}

export function getOpenAiModelEntry(modelId: string): OpenAiModelCatalogEntry | undefined {
  return OPENAI_MODEL_CATALOG.find((model) => model.id === modelId);
}
