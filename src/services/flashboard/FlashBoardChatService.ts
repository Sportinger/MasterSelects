import {
  createLemonadeChatCompletionStream,
  DEFAULT_LEMONADE_MODEL,
} from '../lemonadeProvider';
import { cloudAiService } from '../cloudAiService';

export type FlashBoardChatProvider = 'openai' | 'anthropic' | 'lemonade';
export type FlashBoardOpenAiReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface FlashBoardChatProviderOption {
  id: FlashBoardChatProvider;
  label: string;
}

export interface FlashBoardChatModelOption {
  id: string;
  label: string;
  provider: FlashBoardChatProvider;
  supportsTemperature: boolean;
  supportsReasoningEffort?: boolean;
  reasoningEfforts?: FlashBoardOpenAiReasoningEffort[];
  maxTokensParameter?: 'max_tokens' | 'max_completion_tokens';
}

export interface FlashBoardChatRequest {
  anthropicApiKey?: string;
  hostedAvailable?: boolean;
  lemonadeEndpoint?: string;
  model: string;
  openAiApiKey?: string;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  prompt: string;
  provider: FlashBoardChatProvider;
  signal?: AbortSignal;
  temperature: number;
}

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
export const DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT: FlashBoardOpenAiReasoningEffort = 'medium';
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

const FLASHBOARD_CHAT_SYSTEM_PROMPT = [
  'You are a concise creative assistant inside MasterSelects.',
  'Help the user reason about prompts, edits, media ideas, and generation settings.',
  'Do not claim to edit the timeline directly from this compact chat.',
].join(' ');

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_FLASHBOARD_CHAT_TEMPERATURE;
  }

  return Math.max(0, Math.min(2, Math.round(value * 10) / 10));
}

function isTemperatureSupported(provider: FlashBoardChatProvider, model: string): boolean {
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

function normalizeOpenAiReasoningEffort(
  model: string,
  effort: FlashBoardOpenAiReasoningEffort | undefined,
): FlashBoardOpenAiReasoningEffort {
  const supportedEfforts = getOpenAiReasoningEffortOptions(model).map((option) => option.id);
  return effort && supportedEfforts.includes(effort)
    ? effort
    : DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT;
}

function readErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as { error?: unknown; message?: unknown };
  if (typeof payload.message === 'string') {
    return payload.message;
  }
  if (payload.error && typeof payload.error === 'object') {
    const error = payload.error as { message?: unknown };
    return typeof error.message === 'string' ? error.message : null;
  }
  if (typeof payload.error === 'string') {
    return payload.error;
  }

  return null;
}

function readOpenAiResponseText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
        type?: string;
      }>;
      type?: string;
    }>;
  };

  if (typeof response.output_text === 'string') {
    return response.output_text.trim();
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim() ?? '';
}

function readOpenAiChatCompletionText(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const response = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

async function sendHostedOpenAiChat(request: FlashBoardChatRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      { role: 'system', content: FLASHBOARD_CHAT_SYSTEM_PROMPT },
      { role: 'user', content: request.prompt },
    ],
    max_completion_tokens: 2048,
  };

  if (isTemperatureSupported('openai', request.model)) {
    body.temperature = clampTemperature(request.temperature);
  }

  const data = await cloudAiService.createChatCompletion(body);
  return readOpenAiChatCompletionText(data) || readOpenAiResponseText(data) || 'OpenAI returned an empty response.';
}

async function sendOpenAiChat(request: FlashBoardChatRequest): Promise<string> {
  if (request.hostedAvailable) {
    return sendHostedOpenAiChat(request);
  }

  const apiKey = request.openAiApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Settings to use compact chat.');
  }

  const body: Record<string, unknown> = {
    model: request.model,
    instructions: FLASHBOARD_CHAT_SYSTEM_PROMPT,
    input: request.prompt,
    max_output_tokens: 2048,
    store: false,
  };

  if (isTemperatureSupported('openai', request.model)) {
    body.temperature = clampTemperature(request.temperature);
  }

  if (isOpenAiReasoningEffortSupported(request.model)) {
    body.reasoning = {
      effort: normalizeOpenAiReasoningEffort(request.model, request.openAiReasoningEffort),
    };
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(data) ?? `OpenAI request failed: ${response.status}`);
  }

  return readOpenAiResponseText(data) || 'OpenAI returned an empty response.';
}

async function sendAnthropicChat(request: FlashBoardChatRequest): Promise<string> {
  const apiKey = request.anthropicApiKey?.trim();
  if (!apiKey) {
    throw new Error('Add an Anthropic API key in Settings to use Claude chat.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: 2048,
      temperature: clampTemperature(request.temperature),
      system: FLASHBOARD_CHAT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: request.prompt }],
    }),
    signal: request.signal,
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(data) ?? `Anthropic request failed: ${response.status}`);
  }

  const content = (data as { content?: Array<{ text?: unknown; type?: string }> } | null)
    ?.content
    ?.filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
    .trim();

  return content || 'Anthropic returned an empty response.';
}

async function sendLemonadeChat(request: FlashBoardChatRequest): Promise<string> {
  const result = await createLemonadeChatCompletionStream({
    endpoint: request.lemonadeEndpoint ?? '',
    model: request.model || DEFAULT_LEMONADE_MODEL,
    messages: [
      { role: 'system', content: FLASHBOARD_CHAT_SYSTEM_PROMPT },
      { role: 'user', content: request.prompt },
    ],
    maxTokens: 1024,
    temperature: clampTemperature(request.temperature),
    signal: request.signal,
    timeoutMs: 45_000,
  });

  return result.content?.trim() || 'Lemonade returned an empty response.';
}

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  switch (request.provider) {
    case 'anthropic':
      return sendAnthropicChat({ ...request, prompt });
    case 'lemonade':
      return sendLemonadeChat({ ...request, prompt });
    case 'openai':
    default:
      return sendOpenAiChat({ ...request, prompt });
  }
}
