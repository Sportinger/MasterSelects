import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDevChatNotification } from '../../src/components/common/toolbar/useDevChatNotification';

const CONVERSATION_ID = 'conversation-notification-test';

describe('useDevChatNotification', () => {
  const originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'visibilityState',
  );

  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem('masterselects.devChat.conversationId', CONVERSATION_ID);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalVisibilityStateDescriptor) {
      Object.defineProperty(
        document,
        'visibilityState',
        originalVisibilityStateDescriptor,
      );
    } else {
      delete (document as Document & { visibilityState?: DocumentVisibilityState }).visibilityState;
    }
  });

  it('polls an existing conversation immediately and pauses while the chat is open', async () => {
    const fetchMessages = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: CONVERSATION_ID,
        cursor: 2,
        messages: [{
          createdAt: '2026-07-30T09:00:00.000Z',
          deliveryStatus: 'delivered',
          id: 2,
          message: 'First developer reply',
          sender: 'developer',
        }],
      })
      .mockResolvedValueOnce({
        conversationId: CONVERSATION_ID,
        cursor: 3,
        messages: [{
          createdAt: '2026-07-30T09:01:00.000Z',
          deliveryStatus: 'delivered',
          id: 3,
          message: 'Second developer reply',
          sender: 'developer',
        }],
      });

    const { result, rerender } = renderHook(
      ({ paused }) => useDevChatNotification({
        paused,
        fetchMessages,
      }),
      {
        initialProps: {
          paused: false,
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(1);

    act(() => result.current.markMessagesSeen(CONVERSATION_ID, [{
      createdAt: '2026-07-30T09:00:00.000Z',
      deliveryStatus: 'delivered',
      id: 2,
      message: 'First developer reply',
      sender: 'developer',
    }], 2));
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);

    rerender({ paused: true });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });

  it('treats developer messages displayed in the open dialog as read', () => {
    const { result } = renderHook(() => useDevChatNotification({
      paused: true,
      fetchMessages: vi.fn(),
    }));

    act(() => {
      result.current.markMessagesSeen(CONVERSATION_ID, [{
        createdAt: '2026-07-30T09:00:00.000Z',
        deliveryStatus: 'delivered',
        id: 7,
        message: 'Already visible in the dialog',
        sender: 'developer',
      }], 7);
    });

    expect(result.current.unreadCount).toBe(0);
    expect(JSON.parse(
      window.localStorage.getItem('masterselects.devChat.notificationState') ?? '{}',
    )).toEqual({
      conversations: {
        [CONVERSATION_ID]: {
          cursor: 7,
          lastSeenDeveloperMessageId: 7,
        },
      },
      version: 2,
    });
  });

  it('polls immediately after the open chat is closed and reports a later reply', async () => {
    window.localStorage.removeItem('masterselects.devChat.conversationId');
    const fetchMessages = vi.fn(async () => ({
      conversationId: CONVERSATION_ID,
      cursor: 8,
      messages: [{
        createdAt: '2026-07-30T09:02:00.000Z',
        deliveryStatus: 'delivered' as const,
        id: 8,
        message: 'Reply received after closing the dialog',
        sender: 'developer' as const,
      }],
    }));

    const { result, rerender } = renderHook(
      ({ paused }) => useDevChatNotification({
        paused,
        fetchMessages,
      }),
      {
        initialProps: {
          paused: true,
        },
      },
    );

    window.localStorage.setItem('masterselects.devChat.conversationId', CONVERSATION_ID);
    act(() => {
      result.current.markMessagesSeen(CONVERSATION_ID, [{
        createdAt: '2026-07-30T09:00:00.000Z',
        deliveryStatus: 'delivered',
        id: 7,
        message: 'Last reply visible before closing',
        sender: 'developer',
      }], 7);
    });

    rerender({ paused: false });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(fetchMessages).toHaveBeenCalledWith(
      CONVERSATION_ID,
      7,
      expect.any(AbortSignal),
    );
    expect(result.current.unreadCount).toBe(1);
  });

  it('checks saved older conversations and keeps their unread replies separate', async () => {
    window.localStorage.setItem('masterselects.devChat.conversations', JSON.stringify([
      {
        createdAt: '2026-07-30T09:00:00.000Z',
        id: CONVERSATION_ID,
        updatedAt: '2026-07-30T09:00:00.000Z',
      },
      {
        createdAt: '2026-07-29T09:00:00.000Z',
        id: 'older-conversation',
        updatedAt: '2026-07-29T09:00:00.000Z',
      },
    ]));
    const fetchMessages = vi.fn(async (conversationId: string) => ({
      conversationId,
      cursor: conversationId === CONVERSATION_ID ? 8 : 4,
      messages: [{
        createdAt: '2026-07-30T09:02:00.000Z',
        deliveryStatus: 'delivered' as const,
        id: conversationId === CONVERSATION_ID ? 8 : 4,
        message: `Reply in ${conversationId}`,
        sender: 'developer' as const,
      }],
    }));

    const { result } = renderHook(() => useDevChatNotification({
      paused: false,
      fetchMessages,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(fetchMessages).toHaveBeenCalledWith(
      'older-conversation',
      0,
      expect.any(AbortSignal),
    );
    expect(result.current.unreadCount).toBe(2);

    act(() => {
      result.current.markMessagesSeen('older-conversation', [{
        createdAt: '2026-07-30T09:02:00.000Z',
        deliveryStatus: 'delivered',
        id: 4,
        message: 'Reply in older-conversation',
        sender: 'developer',
      }], 4);
    });

    expect(result.current.unreadCount).toBe(1);
  });

  it('continues after the persisted read cursor and only counts newer replies', async () => {
    window.localStorage.setItem('masterselects.devChat.notificationState', JSON.stringify({
      conversationId: CONVERSATION_ID,
      cursor: 7,
      lastSeenDeveloperMessageId: 7,
    }));
    const fetchMessages = vi.fn(async () => ({
      conversationId: CONVERSATION_ID,
      cursor: 8,
      messages: [{
        createdAt: '2026-07-30T09:02:00.000Z',
        deliveryStatus: 'delivered' as const,
        id: 8,
        message: 'New after reload',
        sender: 'developer' as const,
      }],
    }));

    const { result } = renderHook(() => useDevChatNotification({
      paused: false,
      fetchMessages,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledWith(
      CONVERSATION_ID,
      7,
      expect.any(AbortSignal),
    );
    expect(result.current.unreadCount).toBe(1);
  });
});
