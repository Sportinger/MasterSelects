import type { FlashBoardChatModelOption, FlashBoardChatProvider, FlashBoardChatProviderOption, FlashBoardOpenAiReasoningEffort } from './FlashBoardChatTypes';

export const FLASHBOARD_CHAT_PROVIDERS: FlashBoardChatProviderOption[] = [
  { id: 'kie', label: 'AI' },
];

const KIE_GPT_REASONING_EFFORTS: FlashBoardOpenAiReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

export const FLASHBOARD_CHAT_MODEL_OPTIONS: Record<FlashBoardChatProvider, FlashBoardChatModelOption[]> = {
  kernel: [
    {
      id: 'masterselects-ai',
      label: 'MasterSelectsAI',
      provider: 'kernel',
      supportsTemperature: false,
      supportsTools: true,
    },
  ],
  kie: [
    {
      id: 'gpt-5-6-terra',
      kieProtocol: 'openai-responses',
      label: '5.6 Terra',
      provider: 'kie',
      supportsTemperature: false,
      supportsTools: true,
      supportsReasoningEffort: true,
      reasoningEfforts: KIE_GPT_REASONING_EFFORTS,
    },
    {
      id: 'gpt-5-6-luna',
      kieProtocol: 'openai-responses',
      label: '5.6 Luna',
      provider: 'kie',
      supportsTemperature: false,
      supportsTools: true,
      supportsReasoningEffort: true,
      reasoningEfforts: KIE_GPT_REASONING_EFFORTS,
    },
    {
      id: 'gpt-5-6-sol',
      kieProtocol: 'openai-responses',
      label: '5.6 Sol',
      provider: 'kie',
      supportsTemperature: false,
      supportsTools: true,
      supportsReasoningEffort: true,
      reasoningEfforts: KIE_GPT_REASONING_EFFORTS,
    },
    {
      id: 'gpt-5-5',
      kieProtocol: 'openai-responses',
      label: '5.5',
      provider: 'kie',
      supportsTemperature: false,
      supportsTools: true,
      supportsReasoningEffort: true,
      reasoningEfforts: KIE_GPT_REASONING_EFFORTS,
    },
    {
      id: 'gpt-5-4',
      kieProtocol: 'openai-responses',
      label: '5.4',
      provider: 'kie',
      supportsTemperature: false,
      supportsTools: true,
      supportsReasoningEffort: true,
      reasoningEfforts: KIE_GPT_REASONING_EFFORTS,
    },
    {
      id: 'claude-opus-4-8',
      kieProtocol: 'claude-messages',
      label: 'Opus 4.8',
      provider: 'kie',
      supportsTemperature: true,
      supportsTools: true,
    },
    {
      id: 'claude-sonnet-5',
      kieProtocol: 'claude-messages',
      label: 'Sonnet 5',
      provider: 'kie',
      supportsTemperature: true,
      supportsTools: true,
    },
    {
      id: 'claude-fable-5',
      kieProtocol: 'claude-messages',
      label: 'Fable 5 (chat only)',
      provider: 'kie',
      supportsTemperature: true,
      supportsTools: false,
    },
  ],
};

export const DEFAULT_FLASHBOARD_CHAT_PROVIDER: FlashBoardChatProvider = 'kie';
export const DEFAULT_FLASHBOARD_KERNEL_MODEL = 'masterselects-ai';
export const DEFAULT_FLASHBOARD_CHAT_MODEL = 'gpt-5-6-terra';
export const DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT: FlashBoardOpenAiReasoningEffort = 'medium';
const FLASHBOARD_CHAT_MODEL_CREDIT_COSTS: Record<string, number> = {
  'gpt-5-6-luna': 3,
  'gpt-5-6-terra': 5,
  'gpt-5-6-sol': 8,
  'gpt-5-5': 5,
  'gpt-5-4': 5,
  'claude-opus-4-8': 8,
  'claude-sonnet-5': 5,
  'claude-fable-5': 10,
};
export const FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS: Array<{
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}> = [
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'XHigh' },
];
export const DEFAULT_FLASHBOARD_CHAT_TEMPERATURE = 0.7;
export const FLASHBOARD_CHAT_MAX_PROVIDER_TOOLS = 128;
/**
 * Tool rounds per turn. 12 could not finish real work: reading a 26-clip
 * timeline plus editing it already spent most of the budget, and a long
 * transcript was unreachable. This is a runaway guard, not a work budget —
 * it exists so a looping model cannot burn credits forever.
 */
export const FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS = 400;
/** Output tokens per provider round. 2048 truncated long plans mid-list. */
export const FLASHBOARD_CHAT_MAX_OUTPUT_TOKENS = 32_000;
/**
 * Hosted models get the full tool result. The old 8,000-char cap replaced the
 * whole payload with a sliced prefix, which forced the model to re-read the
 * same timeline in overlapping slices and cost it clip ids mid-list. Hosted
 * context windows are large enough to carry the real thing.
 */
export const FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS = Number.POSITIVE_INFINITY;
export function getFlashBoardChatCreditCost(model: string): number {
  return FLASHBOARD_CHAT_MODEL_CREDIT_COSTS[model] ?? 5;
}

export function getFlashBoardChatCreditLabel(_model: string): string {
  return 'usage × 6';
}

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FLASHBOARD_CHAT_TEMPERATURE;
  }

  return Math.max(0, Math.min(2, Math.round(value * 10) / 10));
}

export function isTemperatureSupported(provider: FlashBoardChatProvider, model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS[provider].find((candidate) => candidate.id === model);
  return option?.supportsTemperature ?? false;
}

export function isOpenAiReasoningEffortSupported(model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === model);
  if (option) {
    return option.supportsReasoningEffort === true && (option.reasoningEfforts?.length ?? 0) > 0;
  }

  return model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4');
}

export function getOpenAiReasoningEffortOptions(model: string): Array<{
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}> {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === model);
  const supportedEfforts = option?.reasoningEfforts ?? (
    isOpenAiReasoningEffortSupported(model) ? KIE_GPT_REASONING_EFFORTS : []
  );

  return FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS.filter((effort) => supportedEfforts.includes(effort.id));
}

export function normalizeOpenAiReasoningEffort(
  model: string,
  effort: FlashBoardOpenAiReasoningEffort | undefined,
): FlashBoardOpenAiReasoningEffort {
  const supportedEfforts = getOpenAiReasoningEffortOptions(model).map((option) => option.id);
  return effort && supportedEfforts.includes(effort)
    ? effort
    : DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT;
}
