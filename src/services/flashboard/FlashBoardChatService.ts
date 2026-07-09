import { buildFlashBoardChatSystemPrompt } from './FlashBoardChatPrompt';
import { sendAnthropicChat, sendLemonadeChat, sendOpenAiChat } from './FlashBoardChatProviderTransport';
import type { FlashBoardChatRequest } from './FlashBoardChatTypes';

export type {
  FlashBoardExecutedToolCall,
  FlashBoardChatModelOption,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
  FlashBoardChatRequest,
  FlashBoardOpenAiReasoningEffort,
} from './FlashBoardChatTypes';
export {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_PROVIDER,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_CHAT_PROVIDERS,
  FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS,
  getFlashBoardChatCreditCost,
  getFlashBoardChatCreditLabel,
  getOpenAiReasoningEffortOptions,
  isOpenAiReasoningEffortSupported,
} from './FlashBoardChatConfig';
export { buildFlashBoardChatSystemPrompt, FLASHBOARD_CHAT_SYSTEM_PROMPT } from './FlashBoardChatPrompt';

export async function sendFlashBoardChatMessage(request: FlashBoardChatRequest): Promise<string> {
  const prompt = request.prompt.trim();
  if (!prompt) {
    throw new Error('Write a prompt before starting chat.');
  }

  const systemPrompt = buildFlashBoardChatSystemPrompt(request.systemPromptOverride);

  switch (request.provider) {
    case 'anthropic':
      return sendAnthropicChat({ ...request, prompt }, systemPrompt);
    case 'lemonade':
      return sendLemonadeChat({ ...request, prompt }, systemPrompt);
    case 'openai':
    default:
      return sendOpenAiChat({ ...request, prompt }, systemPrompt);
  }
}
