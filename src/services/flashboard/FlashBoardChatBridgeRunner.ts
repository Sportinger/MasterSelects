import { useAccountStore } from '../../stores/accountStore';
import {
  useFlashBoardStore,
  type FlashBoardChatMessage,
} from '../../stores/flashboardStore';
import { useSettingsStore, type AIProvider } from '../../stores/settingsStore';
import { DEFAULT_LEMONADE_MODEL } from '../lemonadeProvider';
import {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
} from './FlashBoardChatConfig';
import { buildFlashBoardChatRequestPrompt } from './FlashBoardChatHistory';
import {
  sendFlashBoardChatMessage,
  type FlashBoardChatRunRecord,
} from './FlashBoardChatService';
import type {
  FlashBoardChatPromptVersion,
  FlashBoardChatProvider,
  FlashBoardChatRunSource,
  FlashBoardChatToolExecutionMode,
  FlashBoardExecutedToolCall,
  FlashBoardOpenAiReasoningEffort,
} from './FlashBoardChatTypes';

export interface FlashBoardBridgeChatTurnInput {
  idempotencyKey?: string;
  includeContext?: boolean;
  includeHistory?: boolean;
  includePlaybook?: boolean;
  model?: string;
  openAiReasoningEffort?: FlashBoardOpenAiReasoningEffort;
  persistToChat?: boolean;
  prompt: string;
  promptVersion?: FlashBoardChatPromptVersion;
  provider?: FlashBoardChatProvider;
  runSource?: FlashBoardChatRunSource;
  systemPromptOverride?: string;
  temperature?: number;
  toolExecutionMode?: FlashBoardChatToolExecutionMode;
}

export interface FlashBoardBridgeChatTurnResult {
  model: string;
  persistedToChat: boolean;
  promptVersion: FlashBoardChatPromptVersion | 'custom';
  provider: FlashBoardChatProvider;
  response: string;
  run: FlashBoardChatRunRecord;
  toolCalls: FlashBoardExecutedToolCall[];
}

export async function runFlashBoardBridgeChatTurn(
  input: FlashBoardBridgeChatTurnInput,
): Promise<FlashBoardBridgeChatTurnResult> {
  const visiblePrompt = input.prompt.trim();
  if (!visiblePrompt) throw new Error('Missing chat prompt.');

  const settings = useSettingsStore.getState();
  const provider = input.provider ?? (settings.aiProvider === 'lemonade' ? 'lemonade' : 'kie');
  const model = resolveModel(provider, input.model, settings.lemonadeModel);
  const providerSettingsKey: AIProvider = provider === 'lemonade' ? 'lemonade' : 'openai';
  const hasExplicitPromptSelection = input.promptVersion !== undefined
    || input.systemPromptOverride !== undefined;
  const savedPromptOverride = settings.aiSystemPromptOverrides[providerSettingsKey]?.trim();
  const systemPromptOverride = input.systemPromptOverride?.trim()
    || (!hasExplicitPromptSelection ? savedPromptOverride : undefined);
  const includeContext = input.includeContext
    ?? (settings.aiSystemPromptSendContext[providerSettingsKey] !== false);
  const messages = input.includeHistory === false
    ? []
    : useFlashBoardStore.getState().chatMessages;
  const requestPrompt = buildFlashBoardChatRequestPrompt(messages, visiblePrompt);
  const toolCalls: FlashBoardExecutedToolCall[] = [];
  const completedRunRef: { current: FlashBoardChatRunRecord | null } = { current: null };
  const persistToChat = input.persistToChat !== false;
  const messageIds = persistToChat ? appendPendingMessages(visiblePrompt) : null;

  try {
    const kieAiApiKey = settings.apiKeysUnlocked
      ? normalizeApiKey(settings.apiKeys.kieai)
      : '';
    const hostedAvailable = provider === 'kie'
      ? resolveHostedAvailability(kieAiApiKey)
      : false;
    if (provider === 'kie' && !hostedAvailable && !kieAiApiKey) {
      throw new Error('No hosted AI access or unlocked Kie.ai API key is available for chat.');
    }

    const response = await sendFlashBoardChatMessage({
      hostedAvailable,
      idempotencyKey: input.idempotencyKey,
      kieAiApiKey,
      lemonadeContextSize: settings.lemonadeContextSize,
      lemonadeEndpoint: settings.lemonadeEndpoint,
      model,
      onExecutedToolCalls: (calls) => toolCalls.push(...calls),
      onRunCompleted: (run) => {
        completedRunRef.current = run;
      },
      openAiReasoningEffort: input.openAiReasoningEffort ?? DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
      playbookPrompt: visiblePrompt,
      prompt: requestPrompt,
      promptVersion: input.promptVersion,
      provider,
      runSource: input.runSource ?? 'bridge',
      systemPromptIncludeContext: includeContext,
      systemPromptIncludePlaybook: input.includePlaybook,
      systemPromptOverride,
      temperature: input.temperature ?? DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
      toolExecutionMode: input.toolExecutionMode ?? 'normal',
    });
    const completedRun = completedRunRef.current;
    if (!completedRun) throw new Error('Chat completed without a run trace.');
    if (messageIds) completePendingMessage(messageIds.assistantId, response, toolCalls);
    return {
      model,
      persistedToChat: persistToChat,
      promptVersion: completedRun.promptVersion,
      provider,
      response,
      run: completedRun,
      toolCalls,
    };
  } catch (error) {
    if (messageIds) {
      completePendingMessage(
        messageIds.assistantId,
        error instanceof Error ? error.message : String(error),
        toolCalls,
        true,
      );
    }
    throw error;
  }
}

export async function compareFlashBoardChatPrompts(
  input: Omit<FlashBoardBridgeChatTurnInput, 'persistToChat' | 'promptVersion' | 'toolExecutionMode'>,
): Promise<{
  legacy: FlashBoardBridgeChatTurnResult;
  v2: FlashBoardBridgeChatTurnResult;
}> {
  const common = {
    ...input,
    includeHistory: input.includeHistory ?? false,
    persistToChat: false,
    toolExecutionMode: 'read-only' as const,
  };
  const legacy = await runFlashBoardBridgeChatTurn({
    ...common,
    promptVersion: 'legacy-v1',
  });
  const v2 = await runFlashBoardBridgeChatTurn({
    ...common,
    promptVersion: 'v2',
  });
  return { legacy, v2 };
}

function resolveModel(
  provider: FlashBoardChatProvider,
  requestedModel: string | undefined,
  lemonadeModel: string,
): string {
  if (provider === 'lemonade') {
    return requestedModel?.trim() || lemonadeModel.trim() || DEFAULT_LEMONADE_MODEL;
  }
  const model = requestedModel?.trim() || DEFAULT_FLASHBOARD_CHAT_MODEL;
  if (!FLASHBOARD_CHAT_MODEL_OPTIONS.kie.some((candidate) => candidate.id === model)) {
    throw new Error(`Unsupported Kie.ai chat model: ${model}`);
  }
  return model;
}

function resolveHostedAvailability(kieAiApiKey: string): boolean {
  const settings = useSettingsStore.getState();
  const account = useAccountStore.getState();
  const hasHostedAccess = account.session?.authenticated === true && account.hostedAIEnabled;
  const useKieKeyByDefault = settings.apiKeysUnlocked
    && settings.apiKeyDefaults.kieai
    && Boolean(kieAiApiKey);
  return hasHostedAccess && (import.meta.env.PROD || !useKieKeyByDefault);
}

function normalizeApiKey(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function appendPendingMessages(prompt: string): { assistantId: string; userId: string } {
  const createdAt = Date.now();
  const userId = createMessageId('user');
  const assistantId = createMessageId('assistant');
  useFlashBoardStore.setState((state) => ({
    chatMessages: [
      ...state.chatMessages,
      { createdAt, id: userId, role: 'user', text: prompt },
      { createdAt, id: assistantId, role: 'assistant', text: 'Thinking...', isPending: true },
    ],
  }));
  return { assistantId, userId };
}

function completePendingMessage(
  assistantId: string,
  text: string,
  toolCalls: FlashBoardExecutedToolCall[],
  isError = false,
): void {
  useFlashBoardStore.setState((state) => ({
    chatMessages: state.chatMessages.map((message): FlashBoardChatMessage => (
      message.id === assistantId
        ? {
            ...message,
            isError: isError || undefined,
            isPending: false,
            text: text || 'Empty response.',
            toolCalls,
          }
        : message
    )),
  }));
}

function createMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
