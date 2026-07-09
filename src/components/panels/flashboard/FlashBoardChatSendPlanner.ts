import type {
  FlashBoardChatProvider,
  FlashBoardChatRequest,
  FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';

type FlashBoardChatDialogTarget = 'auth' | 'pricing' | 'settings';
type FlashBoardChatPlannedRequest = Omit<FlashBoardChatRequest, 'signal'>;

interface BuildFlashBoardChatSendPlanInput {
  activeChatModelId: string;
  anthropicApiKey: string;
  canUseByoChat: boolean;
  canUseHostedChat: boolean;
  chatMessages: FlashBoardChatMessage[];
  chatPanelOpen: boolean;
  chatProvider: FlashBoardChatProvider;
  chatTemperature: number;
  effectiveChatPrompt: string;
  hasAnthropicKey: boolean;
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  isChatting: boolean;
  lemonadeEndpoint: string;
  openAiApiKey: string;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
  shouldUseHostedChat: boolean;
  useHostedProductionProviders: boolean;
}

export type FlashBoardChatSendPlan =
  | { action: 'openPanel' }
  | { action: 'abort' }
  | { action: 'error'; dialogTarget?: FlashBoardChatDialogTarget; errorMessage: string }
  | { action: 'send'; request: FlashBoardChatPlannedRequest };

export function buildFlashBoardChatRequestPrompt(
  messages: FlashBoardChatMessage[],
  nextUserPrompt: string,
): string {
  const previousContext = messages
    .filter((message) => !message.isPending && !message.isError && message.text.trim())
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text.trim()}`)
    .join('\n\n');

  return previousContext ? `${previousContext}\n\nUser: ${nextUserPrompt}` : nextUserPrompt;
}

export function buildFlashBoardChatSendPlan({
  activeChatModelId,
  anthropicApiKey,
  canUseByoChat,
  canUseHostedChat,
  chatMessages,
  chatPanelOpen,
  chatProvider,
  chatTemperature,
  effectiveChatPrompt,
  hasAnthropicKey,
  hasHostedSession,
  hostedAIEnabled,
  isChatting,
  lemonadeEndpoint,
  openAiApiKey,
  openAiReasoningEffort,
  shouldUseHostedChat,
  useHostedProductionProviders,
}: BuildFlashBoardChatSendPlanInput): FlashBoardChatSendPlan {
  if (!chatPanelOpen) {
    return { action: 'openPanel' };
  }

  if (isChatting) {
    return { action: 'abort' };
  }

  if (!effectiveChatPrompt) {
    return { action: 'error', errorMessage: 'Write a chat prompt before starting chat.' };
  }

  if (chatProvider === 'openai' && !canUseHostedChat && !canUseByoChat) {
    return {
      action: 'error',
      dialogTarget: useHostedProductionProviders || !hasHostedSession
        ? 'auth'
        : !hostedAIEnabled ? 'pricing' : 'settings',
      errorMessage: useHostedProductionProviders
        ? 'Sign in and enable hosted credits to use compact chat.'
        : 'Sign in or add an OpenAI API key in Settings to use compact chat.',
    };
  }

  if (chatProvider === 'anthropic' && !hasAnthropicKey) {
    return {
      action: 'error',
      dialogTarget: 'settings',
      errorMessage: 'Add an Anthropic API key in Settings to use Claude chat.',
    };
  }

  return {
    action: 'send',
    request: {
      anthropicApiKey,
      hostedAvailable: shouldUseHostedChat,
      lemonadeEndpoint,
      model: activeChatModelId,
      openAiApiKey,
      openAiReasoningEffort,
      prompt: buildFlashBoardChatRequestPrompt(chatMessages, effectiveChatPrompt),
      provider: chatProvider,
      temperature: chatTemperature,
    },
  };
}

export function buildFlashBoardChatOptimisticMessages({
  assistantMessageId,
  userMessageId,
  userPrompt,
}: {
  assistantMessageId: string;
  userMessageId: string;
  userPrompt: string;
}): FlashBoardChatMessage[] {
  const createdAt = Date.now();
  return [
    { createdAt, id: userMessageId, role: 'user', text: userPrompt },
    { createdAt, id: assistantMessageId, role: 'assistant', text: 'Thinking...', isPending: true },
  ];
}

export function buildFlashBoardChatCompletionMessages(
  messages: FlashBoardChatMessage[],
  assistantMessageId: string,
  response: string,
  editOptions: FlashBoardChatMessage['editOptions'] = undefined,
  toolCalls: FlashBoardChatMessage['toolCalls'] = undefined,
): FlashBoardChatMessage[] {
  return messages.map((message) => (
    message.id === assistantMessageId
      ? { ...message, text: response || 'Empty response.', editOptions, toolCalls, isPending: false }
      : message
  ));
}

export function buildFlashBoardChatErrorMessages(
  messages: FlashBoardChatMessage[],
  assistantMessageId: string,
  errorMessage: string,
): FlashBoardChatMessage[] {
  return messages.map((message) => (
    message.id === assistantMessageId
      ? { ...message, text: errorMessage, isError: true, isPending: false }
      : message
  ));
}
