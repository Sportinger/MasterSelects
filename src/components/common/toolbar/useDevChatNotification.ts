import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDevChatMessages,
  getStoredDevChatConversationId,
  type DevChatMessage,
  type FetchDevChatMessagesResponse,
} from '../../../services/devChatService';

const BACKGROUND_POLL_INTERVAL_MS = 10_000;

interface UseDevChatNotificationOptions {
  enabled: boolean;
  paused: boolean;
  fetchMessages?: (
    conversationId: string,
    after?: number,
    signal?: AbortSignal,
  ) => Promise<FetchDevChatMessagesResponse>;
}

interface DevChatNotificationState {
  markAllRead: () => void;
  markMessagesSeen: (
    conversationId: string,
    messages: DevChatMessage[],
    cursor: number,
  ) => void;
  unreadCount: number;
}

export function useDevChatNotification({
  enabled,
  paused,
  fetchMessages = fetchDevChatMessages,
}: UseDevChatNotificationOptions): DevChatNotificationState {
  const [unreadCount, setUnreadCount] = useState(0);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const cursorRef = useRef(0);
  const latestDeveloperMessageIdRef = useRef(0);
  const lastSeenDeveloperMessageIdRef = useRef(0);
  const unreadDeveloperMessageIdsRef = useRef(new Set<number>());

  const switchConversation = useCallback((conversationId: string) => {
    if (conversationIdRef.current === conversationId) return;

    conversationIdRef.current = conversationId;
    cursorRef.current = 0;
    latestDeveloperMessageIdRef.current = 0;
    lastSeenDeveloperMessageIdRef.current = 0;
    unreadDeveloperMessageIdsRef.current.clear();
    setUnreadCount(0);
  }, []);

  const markMessagesSeen = useCallback((
    conversationId: string,
    messages: DevChatMessage[],
    cursor: number,
  ) => {
    switchConversation(conversationId);
    cursorRef.current = Math.max(cursorRef.current, cursor);

    let latestSeenDeveloperMessageId = lastSeenDeveloperMessageIdRef.current;
    for (const message of messages) {
      if (message.sender !== 'developer') continue;
      latestSeenDeveloperMessageId = Math.max(latestSeenDeveloperMessageId, message.id);
      latestDeveloperMessageIdRef.current = Math.max(
        latestDeveloperMessageIdRef.current,
        message.id,
      );
    }

    lastSeenDeveloperMessageIdRef.current = latestSeenDeveloperMessageId;
    for (const messageId of unreadDeveloperMessageIdsRef.current) {
      if (messageId <= latestSeenDeveloperMessageId) {
        unreadDeveloperMessageIdsRef.current.delete(messageId);
      }
    }
    setUnreadCount(unreadDeveloperMessageIdsRef.current.size);
  }, [switchConversation]);

  const markAllRead = useCallback(() => {
    lastSeenDeveloperMessageIdRef.current = Math.max(
      lastSeenDeveloperMessageIdRef.current,
      latestDeveloperMessageIdRef.current,
    );
    unreadDeveloperMessageIdsRef.current.clear();
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!enabled || paused) return;

    const conversationId = getStoredDevChatConversationId();
    if (!conversationId) {
      conversationIdRef.current = undefined;
      cursorRef.current = 0;
      latestDeveloperMessageIdRef.current = 0;
      lastSeenDeveloperMessageIdRef.current = 0;
      unreadDeveloperMessageIdsRef.current.clear();
      setUnreadCount(0);
      return;
    }

    switchConversation(conversationId);
    const controller = new AbortController();
    let active = true;
    let pollInFlight = false;

    const poll = async () => {
      if (!active || pollInFlight || document.visibilityState === 'hidden') return;
      pollInFlight = true;

      try {
        const response = await fetchMessages(
          conversationId,
          cursorRef.current,
          controller.signal,
        );
        if (!active || controller.signal.aborted) return;

        cursorRef.current = Math.max(cursorRef.current, response.cursor);
        for (const message of response.messages) {
          if (message.sender !== 'developer') continue;
          latestDeveloperMessageIdRef.current = Math.max(
            latestDeveloperMessageIdRef.current,
            message.id,
          );
          if (message.id > lastSeenDeveloperMessageIdRef.current) {
            unreadDeveloperMessageIdsRef.current.add(message.id);
          }
        }
        setUnreadCount(unreadDeveloperMessageIdsRef.current.size);
      } catch {
        // This is a quiet background check. The open chat keeps its visible error handling.
      } finally {
        pollInFlight = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };

    void poll();
    const interval = window.setInterval(() => void poll(), BACKGROUND_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fetchMessages, paused, switchConversation]);

  return {
    markAllRead,
    markMessagesSeen,
    unreadCount,
  };
}
