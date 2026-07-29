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
  sendDevChatMessage,
  storeDevChatConversationId,
} from '../../src/services/devChatService';

describe('developer chat service', () => {
  beforeEach(() => {
    window.localStorage.clear();
    requestJsonMock.mockReset();
  });

  it('keeps the conversation id in browser storage', () => {
    expect(getStoredDevChatConversationId()).toBeUndefined();

    storeDevChatConversationId('conversation-123');

    expect(getStoredDevChatConversationId()).toBe('conversation-123');

    clearStoredDevChatConversationId();

    expect(getStoredDevChatConversationId()).toBeUndefined();
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

    await expect(sendDevChatMessage('Can you help?')).resolves.toEqual(response);

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

    await sendDevChatMessage('More context', 'conversation-123');

    const [, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      conversationId: 'conversation-123',
      message: 'More context',
    });
  });

  it('fetches only messages after the supplied cursor and forwards cancellation', async () => {
    const controller = new AbortController();
    requestJsonMock.mockResolvedValue({
      conversationId: 'conversation-123',
      messages: [],
      cursor: 17,
    });

    await fetchDevChatMessages('conversation-123', 17, controller.signal);

    expect(requestJsonMock).toHaveBeenCalledOnce();
    const [url, init] = requestJsonMock.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url, window.location.origin);
    expect(parsedUrl.pathname).toBe('/api/support/chat');
    expect(parsedUrl.searchParams.get('conversationId')).toBe('conversation-123');
    expect(parsedUrl.searchParams.get('after')).toBe('17');
    expect(init).toEqual({
      method: 'GET',
      signal: controller.signal,
    });
  });
});
