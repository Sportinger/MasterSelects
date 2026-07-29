import type {
  FlashBoardChatProvider,
  FlashBoardChatRequest,
  FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';
import { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';
import type { FlashBoardChatMessage } from './FlashBoardChatOutput';

export { buildFlashBoardChatRequestPrompt } from '../../../services/flashboard/FlashBoardChatHistory';

type FlashBoardChatDialogTarget = 'auth' | 'pricing' | 'settings';
type FlashBoardChatPlannedRequest = Omit<FlashBoardChatRequest, 'signal'>;

interface BuildFlashBoardChatSendPlanInput {
  activeChatModelId: string;
  canUseByoChat: boolean;
  canUseHostedChat: boolean;
  chatMessages: FlashBoardChatMessage[];
  chatPanelOpen: boolean;
  chatProvider: FlashBoardChatProvider;
  chatTemperature: number;
  effectiveChatPrompt: string;
  hasHostedSession: boolean;
  hostedAIEnabled: boolean;
  isChatting: boolean;
  lemonadeContextSize: number;
  lemonadeEndpoint: string;
  kieAiApiKey: string;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
  shouldUseHostedChat: boolean;
  useHostedProductionProviders: boolean;
}

export type FlashBoardChatSendPlan =
  | { action: 'openPanel' }
  | { action: 'abort' }
  | { action: 'error'; dialogTarget?: FlashBoardChatDialogTarget; errorMessage: string }
  | { action: 'send'; request: FlashBoardChatPlannedRequest };

export function buildFlashBoardChatSendPlan({
  activeChatModelId,
  canUseByoChat,
  canUseHostedChat,
  chatMessages,
  chatPanelOpen,
  chatProvider,
  chatTemperature,
  effectiveChatPrompt,
  hasHostedSession,
  hostedAIEnabled,
  isChatting,
  lemonadeContextSize,
  lemonadeEndpoint,
  kieAiApiKey,
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

  if (chatProvider === 'kie' && !canUseHostedChat && !canUseByoChat) {
    return {
      action: 'error',
      dialogTarget: useHostedProductionProviders || !hasHostedSession
        ? 'auth'
        : !hostedAIEnabled ? 'pricing' : 'settings',
      errorMessage: useHostedProductionProviders
        ? 'Sign in and enable hosted credits to use compact chat.'
        : 'Sign in or add a Kie.ai API key in Settings to use compact chat.',
    };
  }

  return {
    action: 'send',
    request: {
      hostedAvailable: shouldUseHostedChat,
      kieAiApiKey,
      lemonadeContextSize: chatProvider === 'lemonade' ? lemonadeContextSize : undefined,
      lemonadeEndpoint,
      model: activeChatModelId,
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
  kernelReport: FlashBoardChatMessage['kernelReport'] = undefined,
): FlashBoardChatMessage[] {
  return messages.map((message) => (
    message.id === assistantMessageId
      ? {
          ...message,
          text: response || 'Empty response.',
          editOptions,
          toolCalls,
          kernelReport,
          kernelProgress: undefined,
          isPending: false,
        }
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
      ? {
          ...message,
          text: errorMessage,
          isError: true,
          isPending: false,
          kernelProgress: undefined,
        }
      : message
  ));
}
