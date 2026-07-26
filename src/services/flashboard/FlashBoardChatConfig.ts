import { DEFAULT_LEMONADE_MODEL } from '../lemonadeProvider';
import type { FlashBoardChatModelOption, FlashBoardChatProvider, FlashBoardChatProviderOption, FlashBoardOpenAiReasoningEffort } from './FlashBoardChatTypes';

export const FLASHBOARD_CHAT_PROVIDERS: FlashBoardChatProviderOption[] = [
  { id: 'kie', label: 'Kie.ai' },
  { id: 'lemonade', label: 'Lemon' },
];

const KIE_GPT_REASONING_EFFORTS: FlashBoardOpenAiReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];

export const FLASHBOARD_CHAT_MODEL_OPTIONS: Record<FlashBoardChatProvider, FlashBoardChatModelOption[]> = {
  kie: [
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
  lemonade: [
    {
      id: DEFAULT_LEMONADE_MODEL,
      label: 'Lemonade',
      provider: 'lemonade',
      supportsTemperature: true,
      supportsTools: true,
    },
  ],
};

export const DEFAULT_FLASHBOARD_CHAT_PROVIDER: FlashBoardChatProvider = 'kie';
export const DEFAULT_FLASHBOARD_CHAT_MODEL = 'gpt-5-6-luna';
export const DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT: FlashBoardOpenAiReasoningEffort = 'low';
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
export const FLASHBOARD_CHAT_MAX_TOOL_ITERATIONS = 12;
export const FLASHBOARD_CHAT_MAX_TOOL_RESULT_CHARS = 8000;
export const FLASHBOARD_LEMONADE_MAX_TOOL_RESULT_CHARS = 2000;
export const FLASHBOARD_LEMONADE_INITIAL_RESPONSE_TIMEOUT_MS = 180_000;
export const FLASHBOARD_LEMONADE_STREAM_IDLE_TIMEOUT_MS = 90_000;

export function getFlashBoardChatCreditCost(model: string): number {
  return FLASHBOARD_CHAT_MODEL_CREDIT_COSTS[model] ?? 5;
}

export function getFlashBoardChatCreditLabel(model: string): string {
  const cost = getFlashBoardChatCreditCost(model);
  return `${cost} cr`;
}

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FLASHBOARD_CHAT_TEMPERATURE;
  }

  return Math.max(0, Math.min(2, Math.round(value * 10) / 10));
}

export function isTemperatureSupported(provider: FlashBoardChatProvider, model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS[provider].find((candidate) => candidate.id === model);
  return option?.supportsTemperature ?? provider !== 'kie';
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
