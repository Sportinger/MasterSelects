import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDevChatMessages,
  getStoredDevChatConversations,
  type DevChatMessage,
  type FetchDevChatMessagesResponse,
} from '../../../services/devChatService';

const BACKGROUND_POLL_INTERVAL_MS = 10_000;
const DEV_CHAT_NOTIFICATION_STATE_STORAGE_KEY = 'masterselects.devChat.notificationState';

interface UseDevChatNotificationOptions {
  paused: boolean;
  fetchMessages?: (
    conversationId: string,
    after?: number,
    signal?: AbortSignal,
  ) => Promise<FetchDevChatMessagesResponse>;
}

interface DevChatNotificationState {
  markMessagesSeen: (
    conversationId: string,
    messages: DevChatMessage[],
    cursor: number,
  ) => void;
  unreadCount: number;
}

interface StoredConversationNotificationState {
  cursor: number;
  lastSeenDeveloperMessageId: number;
}

interface StoredDevChatNotificationState {
  conversations: Record<string, StoredConversationNotificationState>;
  version: 2;
}

interface ConversationNotificationRuntime extends StoredConversationNotificationState {
  unreadDeveloperMessageIds: Set<number>;
}

function normalizeStoredConversationNotificationState(
  value: unknown,
): StoredConversationNotificationState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const state = value as Partial<StoredConversationNotificationState>;
  if (
    typeof state.cursor !== 'number'
    || !Number.isSafeInteger(state.cursor)
    || state.cursor < 0
    || typeof state.lastSeenDeveloperMessageId !== 'number'
    || !Number.isSafeInteger(state.lastSeenDeveloperMessageId)
    || state.lastSeenDeveloperMessageId < 0
  ) {
    return undefined;
  }
  return {
    cursor: state.cursor,
    lastSeenDeveloperMessageId: state.lastSeenDeveloperMessageId,
  };
}

function readStoredNotificationStates(): Record<
  string,
  StoredConversationNotificationState
> {
  try {
    const rawState = window.localStorage.getItem(DEV_CHAT_NOTIFICATION_STATE_STORAGE_KEY);
    if (!rawState) return {};

    const state = JSON.parse(rawState) as Partial<StoredDevChatNotificationState> & {
      conversationId?: unknown;
      cursor?: unknown;
      lastSeenDeveloperMessageId?: unknown;
    };
    const normalizedStates: Record<string, StoredConversationNotificationState> = {};

    if (state.version === 2 && state.conversations && typeof state.conversations === 'object') {
      for (const [conversationId, conversationState] of Object.entries(state.conversations)) {
        const normalizedState = normalizeStoredConversationNotificationState(conversationState);
        if (conversationId && normalizedState) {
          normalizedStates[conversationId] = normalizedState;
        }
      }
      return normalizedStates;
    }

    const legacyState = normalizeStoredConversationNotificationState(state);
    if (
      typeof state.conversationId === 'string'
      && state.conversationId
      && legacyState
    ) {
      normalizedStates[state.conversationId] = legacyState;
    }
    return normalizedStates;
  } catch {
    return {};
  }
}

function storeNotificationState(
  conversationId: string,
  cursor: number,
  lastSeenDeveloperMessageId: number,
): void {
  try {
    const conversations = readStoredNotificationStates();
    conversations[conversationId] = {
      cursor,
      lastSeenDeveloperMessageId,
    };
    window.localStorage.setItem(
      DEV_CHAT_NOTIFICATION_STATE_STORAGE_KEY,
      JSON.stringify({
        conversations,
        version: 2,
      } satisfies StoredDevChatNotificationState),
    );
  } catch {
    // Notifications keep working for the current page session without storage.
  }
}

export function useDevChatNotification({
  paused,
  fetchMessages = fetchDevChatMessages,
}: UseDevChatNotificationOptions): DevChatNotificationState {
  const [unreadCount, setUnreadCount] = useState(0);
  const conversationStatesRef = useRef(
    new Map<string, ConversationNotificationRuntime>(),
  );

  const updateUnreadCount = useCallback(() => {
    let totalUnreadCount = 0;
    for (const state of conversationStatesRef.current.values()) {
      totalUnreadCount += state.unreadDeveloperMessageIds.size;
    }
    setUnreadCount(totalUnreadCount);
  }, []);

  const getConversationState = useCallback((conversationId: string) => {
    const existingState = conversationStatesRef.current.get(conversationId);
    if (existingState) return existingState;

    const storedState = readStoredNotificationStates()[conversationId];
    const state: ConversationNotificationRuntime = {
      cursor: storedState?.cursor ?? 0,
      lastSeenDeveloperMessageId: storedState?.lastSeenDeveloperMessageId ?? 0,
      unreadDeveloperMessageIds: new Set<number>(),
    };
    conversationStatesRef.current.set(conversationId, state);
    return state;
  }, []);

  const markMessagesSeen = useCallback((
    conversationId: string,
    messages: DevChatMessage[],
    cursor: number,
  ) => {
    const state = getConversationState(conversationId);
    state.cursor = Math.max(state.cursor, cursor);

    let latestSeenDeveloperMessageId = state.lastSeenDeveloperMessageId;
    for (const message of messages) {
      if (message.sender !== 'developer') continue;
      latestSeenDeveloperMessageId = Math.max(latestSeenDeveloperMessageId, message.id);
    }

    state.lastSeenDeveloperMessageId = latestSeenDeveloperMessageId;
    for (const messageId of state.unreadDeveloperMessageIds) {
      if (messageId <= latestSeenDeveloperMessageId) {
        state.unreadDeveloperMessageIds.delete(messageId);
      }
    }
    storeNotificationState(
      conversationId,
      state.cursor,
      state.lastSeenDeveloperMessageId,
    );
    updateUnreadCount();
  }, [getConversationState, updateUnreadCount]);

  useEffect(() => {
    if (paused) return;

    const conversationIds = getStoredDevChatConversations().map(
      (conversation) => conversation.id,
    );
    if (conversationIds.length === 0) {
      conversationStatesRef.current.clear();
      setUnreadCount(0);
      return;
    }

    for (const conversationId of conversationIds) {
      getConversationState(conversationId);
    }
    const controller = new AbortController();
    let active = true;
    const pollsInFlight = new Set<string>();

    const pollConversation = async (conversationId: string) => {
      if (!active || pollsInFlight.has(conversationId)) return;
      pollsInFlight.add(conversationId);
      const state = getConversationState(conversationId);

      try {
        const response = await fetchMessages(
          conversationId,
          state.cursor,
          controller.signal,
        );
        if (!active || controller.signal.aborted) return;

        state.cursor = Math.max(state.cursor, response.cursor);
        for (const message of response.messages) {
          if (message.sender !== 'developer') continue;
          if (message.id > state.lastSeenDeveloperMessageId) {
            state.unreadDeveloperMessageIds.add(message.id);
          }
        }
        updateUnreadCount();
      } catch {
        // This is a quiet background check. The open chat keeps its visible error handling.
      } finally {
        pollsInFlight.delete(conversationId);
      }
    };

    const poll = () => {
      if (!active || document.visibilityState === 'hidden') return;
      for (const conversationId of conversationIds) {
        void pollConversation(conversationId);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') poll();
    };

    poll();
    const interval = window.setInterval(poll, BACKGROUND_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchMessages, getConversationState, paused, updateUnreadCount]);

  return {
    markMessagesSeen,
    unreadCount,
  };
}
