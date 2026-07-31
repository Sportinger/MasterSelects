import { requestJson } from './cloud/transport';

const DEV_CHAT_ENDPOINT = '/api/support/chat';
const DEV_CHAT_CONVERSATION_STORAGE_KEY = 'masterselects.devChat.conversationId';
const DEV_CHAT_CONVERSATION_HISTORY_STORAGE_KEY = 'masterselects.devChat.conversations';
const MAX_STORED_DEV_CHAT_CONVERSATIONS = 12;
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

export interface StoredDevChatConversation {
  createdAt: string;
  id: string;
  preview?: string;
  updatedAt: string;
}

interface StoreDevChatConversationDetails {
  createdAt?: string;
  preview?: string;
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

function normalizeStoredConversation(
  value: unknown,
): StoredDevChatConversation | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Partial<StoredDevChatConversation>;
  if (
    typeof candidate.id !== 'string'
    || !candidate.id.trim()
    || typeof candidate.createdAt !== 'string'
    || Number.isNaN(Date.parse(candidate.createdAt))
    || typeof candidate.updatedAt !== 'string'
    || Number.isNaN(Date.parse(candidate.updatedAt))
    || (candidate.preview !== undefined && typeof candidate.preview !== 'string')
  ) {
    return undefined;
  }

  return {
    createdAt: candidate.createdAt,
    id: candidate.id,
    ...(candidate.preview?.trim()
      ? { preview: candidate.preview.trim().slice(0, 120) }
      : {}),
    updatedAt: candidate.updatedAt,
  };
}

function writeStoredDevChatConversations(
  conversations: StoredDevChatConversation[],
): void {
  try {
    window.localStorage.setItem(
      DEV_CHAT_CONVERSATION_HISTORY_STORAGE_KEY,
      JSON.stringify(conversations.slice(0, MAX_STORED_DEV_CHAT_CONVERSATIONS)),
    );
  } catch {
    // The active conversation still works for the current page session.
  }
}

export function getStoredDevChatConversationId(): string | undefined {
  try {
    return window.localStorage.getItem(DEV_CHAT_CONVERSATION_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function getStoredDevChatConversations(): StoredDevChatConversation[] {
  let conversations: StoredDevChatConversation[] = [];
  try {
    const rawHistory = window.localStorage.getItem(
      DEV_CHAT_CONVERSATION_HISTORY_STORAGE_KEY,
    );
    const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
    if (Array.isArray(parsedHistory)) {
      const seenIds = new Set<string>();
      conversations = parsedHistory
        .map(normalizeStoredConversation)
        .filter((conversation): conversation is StoredDevChatConversation => {
          if (!conversation || seenIds.has(conversation.id)) return false;
          seenIds.add(conversation.id);
          return true;
        });
    }
  } catch {
    conversations = [];
  }

  const activeConversationId = getStoredDevChatConversationId();
  if (
    activeConversationId
    && !conversations.some((conversation) => conversation.id === activeConversationId)
  ) {
    const migratedAt = new Date().toISOString();
    conversations.unshift({
      createdAt: migratedAt,
      id: activeConversationId,
      updatedAt: migratedAt,
    });
    writeStoredDevChatConversations(conversations);
  }

  return conversations
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, MAX_STORED_DEV_CHAT_CONVERSATIONS);
}

export function storeDevChatConversationId(
  conversationId: string,
  details: StoreDevChatConversationDetails = {},
): void {
  const storedConversations = getStoredDevChatConversations();
  try {
    window.localStorage.setItem(DEV_CHAT_CONVERSATION_STORAGE_KEY, conversationId);
  } catch {
    // The chat still works for the current session when storage is unavailable.
  }

  const existingConversation = storedConversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const updatedAt = new Date().toISOString();
  const updatedConversation: StoredDevChatConversation = {
    createdAt: existingConversation?.createdAt
      ?? details.createdAt
      ?? updatedAt,
    id: conversationId,
    ...(details.preview?.trim()
      ? { preview: details.preview.trim().slice(0, 120) }
      : existingConversation?.preview
        ? { preview: existingConversation.preview }
        : {}),
    updatedAt,
  };

  writeStoredDevChatConversations([
    updatedConversation,
    ...storedConversations.filter((conversation) => conversation.id !== conversationId),
  ]);
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
