import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestJsonMock } = vi.hoisted(() => ({
  requestJsonMock: vi.fn(),
}));

vi.mock('../../src/services/cloud/transport', () => ({
  requestJson: requestJsonMock,
}));

import {
  clearStoredDevChatConversationId,
  fetchDevChatMessages,
  getStoredDevChatConversationId,
  getStoredDevChatConversations,
  sendDevChatMessage,
  storeDevChatConversationId,
} from '../../src/services/devChatService';

describe('developer chat service', () => {
  beforeEach(() => {
    window.localStorage.clear();
    requestJsonMock.mockReset();
  });

  it('keeps previous conversations in browser storage when the active chat is cleared', () => {
    expect(getStoredDevChatConversationId()).toBeUndefined();

    storeDevChatConversationId('conversation-123', {
      createdAt: '2026-07-29T18:00:00.000Z',
      preview: 'Can you help?',
    });

    expect(getStoredDevChatConversationId()).toBe('conversation-123');
    expect(getStoredDevChatConversations()).toEqual([
      expect.objectContaining({
        createdAt: '2026-07-29T18:00:00.000Z',
        id: 'conversation-123',
        preview: 'Can you help?',
      }),
    ]);

    clearStoredDevChatConversationId();

    expect(getStoredDevChatConversationId()).toBeUndefined();
    expect(getStoredDevChatConversations()).toEqual([
      expect.objectContaining({
        id: 'conversation-123',
        preview: 'Can you help?',
      }),
    ]);
  });

  it('stores multiple conversations and makes a selected chat active again', () => {
    storeDevChatConversationId('conversation-1', {
      createdAt: '2026-07-29T18:00:00.000Z',
      preview: 'First topic',
    });
    storeDevChatConversationId('conversation-2', {
      createdAt: '2026-07-29T19:00:00.000Z',
      preview: 'Second topic',
    });

    expect(getStoredDevChatConversations().map((conversation) => conversation.id))
      .toEqual(['conversation-2', 'conversation-1']);

    storeDevChatConversationId('conversation-1');

    expect(getStoredDevChatConversationId()).toBe('conversation-1');
    expect(getStoredDevChatConversations()[0]).toMatchObject({
      id: 'conversation-1',
      preview: 'First topic',
    });
  });

  it('sends a new message using the public support-chat contract', async () => {
    const response = {
      conversationId: 'conversation-123',
      message: {
        id: 1,
        sender: 'user' as const,
        message: 'Can you help?',
        createdAt: '2026-07-29T18:00:00.000Z',
      },
    };
    requestJsonMock.mockResolvedValue(response);

    await expect(sendDevChatMessage('Can you help?')).resolves.toEqual({
      ...response,
      message: {
        ...response.message,
        deliveryStatus: 'delivered',
      },
    });

    expect(requestJsonMock).toHaveBeenCalledOnce();
    const [url, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/support/chat');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      message: 'Can you help?',
      page: window.location.href,
    });
  });

  it('continues an existing conversation when sending another message', async () => {
    requestJsonMock.mockResolvedValue({
      conversationId: 'conversation-123',
      message: {
        id: 2,
        sender: 'user',
        message: 'More context',
        createdAt: '2026-07-29T18:01:00.000Z',
      },
    });

    await sendDevChatMessage(
      'More context',
      'conversation-123',
      'b9c03eca-459d-4da2-9e3e-95a105e394a1',
    );

    const [, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      conversationId: 'conversation-123',
      clientMessageId: 'b9c03eca-459d-4da2-9e3e-95a105e394a1',
      message: 'More context',
    });
  });

  it('preserves a pending delivery status from an accepted send', async () => {
    requestJsonMock.mockResolvedValue({
      conversationId: 'conversation-123',
      message: {
        createdAt: '2026-07-29T18:01:00.000Z',
        deliveryStatus: 'pending',
        id: 2,
        message: 'Awaiting confirmation',
        sender: 'user',
      },
    });

    await expect(sendDevChatMessage(
      'Awaiting confirmation',
      'conversation-123',
      '31b5a838-8db4-405f-816b-571cff889b42',
    )).resolves.toMatchObject({
      conversationId: 'conversation-123',
      message: {
        deliveryStatus: 'pending',
        id: 2,
      },
    });
  });

  it('fetches only messages after the supplied cursor and forwards cancellation', async () => {
    const controller = new AbortController();
    requestJsonMock.mockResolvedValue({
      conversationId: 'conversation-123',
      messages: [],
      cursor: 17,
    });

    await fetchDevChatMessages('conversation-123', 17, controller.signal, [4, 9]);

    expect(requestJsonMock).toHaveBeenCalledOnce();
    const [url, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url, window.location.origin);
    expect(parsedUrl.pathname).toBe('/api/support/chat');
    expect(parsedUrl.searchParams.get('conversationId')).toBe('conversation-123');
    expect(parsedUrl.searchParams.get('after')).toBe('17');
    expect(parsedUrl.searchParams.get('pendingIds')).toBe('4,9');
    expect(init).toEqual({
      method: 'GET',
      signal: controller.signal,
    });
  });

  it('defensively caps pending reconciliation IDs at the backend limit', async () => {
    requestJsonMock.mockResolvedValue({
      conversationId: 'conversation-123',
      messages: [],
      cursor: 60,
    });
    const pendingIds = Array.from({ length: 60 }, (_, index) => index + 1);

    await fetchDevChatMessages('conversation-123', 60, undefined, pendingIds);

    const [url] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url, window.location.origin);
    const requestedPendingIds = parsedUrl.searchParams.get('pendingIds')?.split(',') ?? [];
    expect(requestedPendingIds).toHaveLength(50);
    expect(requestedPendingIds[0]).toBe('1');
    expect(requestedPendingIds[49]).toBe('50');
  });
});
