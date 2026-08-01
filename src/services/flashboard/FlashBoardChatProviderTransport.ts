import {
  FLASHBOARD_CHAT_MODEL_OPTIONS,
} from './FlashBoardChatConfig';
import type { FlashBoardChatRequest } from './FlashBoardChatTypes';
import { sendHostedKieAgentChat } from './FlashBoardHostedAgentTransport';

export async function sendKieChat(request: FlashBoardChatRequest, systemPrompt: string): Promise<string> {
  if (!request.hostedAvailable) {
    throw new Error('Sign in and enable hosted credits to use AI chat.');
  }
  const turnRequest = !request.idempotencyKey
    ? {
        ...request,
        idempotencyKey: `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`,
      }
    : request;
  const model = FLASHBOARD_CHAT_MODEL_OPTIONS.kie.find((candidate) => candidate.id === turnRequest.model);
  if (!model?.kieProtocol) {
    throw new Error(`Unsupported Kie.ai chat model: ${turnRequest.model}`);
  }
  return sendHostedKieAgentChat({
    protocol: model.kieProtocol,
    request: turnRequest,
    supportsTools: model.supportsTools,
    systemPrompt,
  });
}
