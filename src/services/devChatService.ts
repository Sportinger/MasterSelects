import { requestJson } from './cloud/transport';

const DEV_CHAT_ENDPOINT = '/api/support/chat';
const DEV_CHAT_CONVERSATION_STORAGE_KEY = 'masterselects.devChat.conversationId';
export const MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST = 50;

export type DevChatSender = 'user' | 'developer';
export type DevChatDeliveryStatus = 'pending' | 'delivered';

export interface DevChatMessage {
  deliveryStatus: DevChatDeliveryStatus;
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

type DevChatMessagePayload = Omit<DevChatMessage, 'deliveryStatus'> & {
  deliveryStatus?: DevChatDeliveryStatus;
};

interface SendDevChatMessagePayload extends Omit<SendDevChatMessageResponse, 'message'> {
  message: DevChatMessagePayload;
}

interface FetchDevChatMessagesPayload extends Omit<FetchDevChatMessagesResponse, 'messages'> {
  messages: DevChatMessagePayload[];
}

function normalizeDevChatMessage(message: DevChatMessagePayload): DevChatMessage {
  return {
    ...message,
    deliveryStatus: message.deliveryStatus === 'pending' ? 'pending' : 'delivered',
  };
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
  clientMessageId?: string,
): Promise<SendDevChatMessageResponse> {
  const response = await requestJson<SendDevChatMessagePayload>(DEV_CHAT_ENDPOINT, {
    body: JSON.stringify({
      ...(conversationId ? { conversationId } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
      message,
      page: window.location.href,
    }),
    method: 'POST',
  });

  return {
    ...response,
    message: normalizeDevChatMessage(response.message),
  };
}

export async function fetchDevChatMessages(
  conversationId: string,
  after = 0,
  signal?: AbortSignal,
  pendingIds?: number[],
): Promise<FetchDevChatMessagesResponse> {
  const query = new URLSearchParams({
    conversationId,
    after: String(after),
  });
  if (pendingIds?.length) {
    const pendingIdBatch = [...new Set(pendingIds)]
      .slice(0, MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST);
    query.set('pendingIds', pendingIdBatch.join(','));
  }

  const response = await requestJson<FetchDevChatMessagesPayload>(`${DEV_CHAT_ENDPOINT}?${query}`, {
    method: 'GET',
    signal,
  });

  return {
    ...response,
    messages: response.messages.map(normalizeDevChatMessage),
  };
}
