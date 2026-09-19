import type { FlashBoardChatRequest } from './FlashBoardChatTypes';
import { sendDirectCodexChat } from './FlashBoardDirectCodexTransport';
import { sendNormalPathAgentChat } from './FlashBoardHostedAgentTransport';

export async function sendIntelligenceChat(request: FlashBoardChatRequest): Promise<string> {
  if (request.agentPath === 'direct-codex') {
    return sendDirectCodexChat(request);
  }
  if (!request.hostedAvailable) {
    throw new Error('Free AI credits are unavailable. Choose a plan to continue.');
  }
  const turnRequest = !request.idempotencyKey
    ? {
        ...request,
        idempotencyKey: `flashboard-chat-turn:${Date.now()}:${crypto.randomUUID()}`,
      }
    : request;
  return sendNormalPathAgentChat({
    request: turnRequest,
  });
}
