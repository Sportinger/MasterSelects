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

  it('starts polling only after the chat was opened in the current page session', async () => {
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
      ({ enabled, paused }) => useDevChatNotification({
        enabled,
        paused,
        fetchMessages,
      }),
      {
        initialProps: {
          enabled: false,
          paused: false,
        },
      },
    );

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(fetchMessages).not.toHaveBeenCalled();

    rerender({ enabled: true, paused: false });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(result.current.unreadCount).toBe(1);

    act(() => result.current.markAllRead());
    expect(result.current.unreadCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(result.current.unreadCount).toBe(1);

    rerender({ enabled: true, paused: true });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });

  it('treats developer messages displayed in the open dialog as read', () => {
    const { result } = renderHook(() => useDevChatNotification({
      enabled: false,
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
  });
});
