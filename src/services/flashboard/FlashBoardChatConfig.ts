import { DEFAULT_LEMONADE_MODEL } from '../lemonadeProvider';
import type { FlashBoardChatModelOption, FlashBoardChatProvider, FlashBoardChatProviderOption, FlashBoardOpenAiReasoningEffort } from './FlashBoardChatTypes';

export const FLASHBOARD_CHAT_PROVIDERS: FlashBoardChatProviderOption[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'lemonade', label: 'Lemon' },
];

const OPENAI_REASONING_EFFORTS_FULL: FlashBoardOpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];
const OPENAI_REASONING_EFFORTS_FAST: FlashBoardOpenAiReasoningEffort[] = ['none', 'low', 'medium', 'high'];

export const FLASHBOARD_CHAT_MODEL_OPTIONS: Record<FlashBoardChatProvider, FlashBoardChatModelOption[]> = {
  openai: [
    {
      id: 'gpt-5.5',
      label: '5.5',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FULL,
    },
    {
      id: 'gpt-5.4',
      label: '5.4',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FULL,
    },
    {
      id: 'gpt-5.4-mini',
      label: '5.4 Fast',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FAST,
    },
    {
      id: 'gpt-5.4-nano',
      label: '5.4 Instant',
      provider: 'openai',
      supportsTemperature: false,
      supportsReasoningEffort: true,
      reasoningEfforts: OPENAI_REASONING_EFFORTS_FAST,
    },
  ],
  anthropic: [
    { id: 'claude-opus-4-1-20250805', label: 'Opus 4.1', provider: 'anthropic', supportsTemperature: true },
    { id: 'claude-sonnet-4-20250514', label: 'Sonnet 4', provider: 'anthropic', supportsTemperature: true },
    { id: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5', provider: 'anthropic', supportsTemperature: true },
  ],
  lemonade: [
    { id: DEFAULT_LEMONADE_MODEL, label: 'Lemonade', provider: 'lemonade', supportsTemperature: true },
  ],
};

export const DEFAULT_FLASHBOARD_CHAT_PROVIDER: FlashBoardChatProvider = 'openai';
export const DEFAULT_FLASHBOARD_CHAT_MODEL = 'gpt-5.4-nano';
export const DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT: FlashBoardOpenAiReasoningEffort = 'none';
const FLASHBOARD_CHAT_MODEL_CREDIT_COSTS: Record<string, number> = {
  'gpt-5.5': 5,
  'gpt-5.4': 5,
  'gpt-5.4-mini': 1,
  'gpt-5.4-nano': 1,
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
  return option?.supportsTemperature ?? provider !== 'openai';
}

export function isOpenAiReasoningEffortSupported(model: string): boolean {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.openai.find((candidate) => candidate.id === model);
  if (option) {
    return option.supportsReasoningEffort === true && (option.reasoningEfforts?.length ?? 0) > 0;
  }

  return model.startsWith('gpt-5') || model.startsWith('o3') || model.startsWith('o4');
}

export function getOpenAiReasoningEffortOptions(model: string): Array<{
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}> {
  const option = FLASHBOARD_CHAT_MODEL_OPTIONS.openai.find((candidate) => candidate.id === model);
  const supportedEfforts = option?.reasoningEfforts ?? (
    isOpenAiReasoningEffortSupported(model) ? OPENAI_REASONING_EFFORTS_FULL : []
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
