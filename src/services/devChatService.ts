import { requestJson } from './cloud/transport';

const DEV_CHAT_ENDPOINT = '/api/support/chat';
const DEV_CHAT_CONVERSATION_STORAGE_KEY = 'masterselects.devChat.conversationId';

export type DevChatSender = 'user' | 'developer';

export interface DevChatMessage {
  id: number;
  sender: DevChatSender;
  message: string;
  createdAt: string;
}

export interface SendDevChatMessageResponse {
  conversationId: string;
  message: DevChatMessage;
}

export interface FetchDevChatMessagesResponse {
  conversationId: string;
  messages: DevChatMessage[];
  cursor: number;
}

export function getStoredDevChatConversationId(): string | undefined {
  try {
    return window.localStorage.getItem(DEV_CHAT_CONVERSATION_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function storeDevChatConversationId(conversationId: string): void {
  try {
    window.localStorage.setItem(DEV_CHAT_CONVERSATION_STORAGE_KEY, conversationId);
  } catch {
    // The chat still works for the current session when storage is unavailable.
  }
}

export function clearStoredDevChatConversationId(): void {
  try {
    window.localStorage.removeItem(DEV_CHAT_CONVERSATION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable, but the in-memory conversation can still reset.
  }
}

export async function sendDevChatMessage(
  message: string,
  conversationId?: string,
): Promise<SendDevChatMessageResponse> {
  return requestJson<SendDevChatMessageResponse>(DEV_CHAT_ENDPOINT, {
    body: JSON.stringify({
      ...(conversationId ? { conversationId } : {}),
      message,
      page: window.location.href,
    }),
    method: 'POST',
  });
}

export async function fetchDevChatMessages(
  conversationId: string,
  after = 0,
  signal?: AbortSignal,
): Promise<FetchDevChatMessagesResponse> {
  const query = new URLSearchParams({
    conversationId,
    after: String(after),
  });

  return requestJson<FetchDevChatMessagesResponse>(`${DEV_CHAT_ENDPOINT}?${query}`, {
    method: 'GET',
    signal,
  });
}
