import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevChatDialog } from '../../src/components/common/DevChatDialog';
import { storeDevChatConversationId } from '../../src/services/devChatService';

const STORAGE_KEY = 'masterselects.devChat.conversationId';
const TEST_CONVERSATION_ID = 'conversation-123';

describe('DevChatDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders as a non-modal floating window and moves from its header', () => {
    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={vi.fn()}
        sendMessage={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const heading = screen.getByRole('heading', { name: 'Chat with dev' });
    const header = heading.closest('.dev-chat-header');
    expect(header).not.toBeNull();
    expect(dialog).not.toHaveAttribute('aria-modal');

    Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: 460 });
    Object.defineProperty(dialog, 'offsetHeight', { configurable: true, value: 400 });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      bottom: 500,
      height: 400,
      left: 200,
      right: 660,
      top: 100,
      width: 460,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(header!, { clientX: 220, clientY: 120 });
    expect(dialog).toHaveClass('is-dragging');
    fireEvent.mouseMove(document, { clientX: 320, clientY: 220 });
    fireEvent.mouseUp(document);

    expect(dialog).toHaveStyle({ left: '300px', top: '200px' });
    expect(dialog).not.toHaveClass('is-dragging');
  });

  it('sends a trimmed message and persists the returned conversation', async () => {
    const sendMessage = vi.fn(async () => ({
      conversationId: TEST_CONVERSATION_ID,
      message: {
        deliveryStatus: 'delivered' as const,
        id: 1,
        sender: 'user' as const,
        message: 'Hello developer',
        createdAt: '2026-07-29T18:00:00.000Z',
      },
    }));
    const fetchMessages = vi.fn(async () => ({
      conversationId: TEST_CONVERSATION_ID,
      messages: [],
      cursor: 1,
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={sendMessage}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Message to the developer' });
    fireEvent.change(textarea, { target: { value: '  Hello developer  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await act(async () => {
      await sendMessage.mock.results[0]?.value;
    });

    expect(sendMessage).toHaveBeenCalledWith(
      'Hello developer',
      undefined,
      expect.any(String),
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(TEST_CONVERSATION_ID);
    expect(screen.getByText('Hello developer')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(textarea).toHaveValue('');
  });

  it('stores a pending response and replaces its badge when polling confirms delivery', async () => {
    let resolvePoll: ((value: {
      conversationId: string;
      cursor: number;
      messages: Array<{
        createdAt: string;
        deliveryStatus: 'delivered';
        id: number;
        message: string;
        sender: 'user';
      }>;
    }) => void) | undefined;
    const fetchMessages = vi.fn(() => new Promise<{
      conversationId: string;
      cursor: number;
      messages: Array<{
        createdAt: string;
        deliveryStatus: 'delivered';
        id: number;
        message: string;
        sender: 'user';
      }>;
    }>((resolve) => {
      resolvePoll = resolve;
    }));
    const sendMessage = vi.fn(async () => ({
      conversationId: 'pending-conversation',
      message: {
        createdAt: '2026-07-29T18:00:00.000Z',
        deliveryStatus: 'pending' as const,
        id: 4,
        message: 'Please deliver this',
        sender: 'user' as const,
      },
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={sendMessage}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Message to the developer' });
    fireEvent.change(textarea, { target: { value: 'Please deliver this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendMessage.mock.results[0]?.value;
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('pending-conversation');
    expect(textarea).toHaveValue('');
    expect(screen.getByText('Delivery pending…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeInTheDocument();

    await act(async () => {
      resolvePoll?.({
        conversationId: 'pending-conversation',
        cursor: 4,
        messages: [{
          createdAt: '2026-07-29T18:00:00.000Z',
          deliveryStatus: 'delivered',
          id: 4,
          message: 'Please deliver this',
          sender: 'user',
        }],
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('Delivery pending…')).not.toBeInTheDocument();
    expect(screen.getByText('Please deliver this')).toBeInTheDocument();
  });

  it('does not downgrade a delivered message when a late send response is pending', async () => {
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    const fetchMessages = vi.fn(async () => ({
      conversationId: TEST_CONVERSATION_ID,
      cursor: 5,
      messages: [{
        createdAt: '2026-07-29T18:00:00.000Z',
        deliveryStatus: 'delivered' as const,
        id: 5,
        message: 'Already confirmed',
        sender: 'user' as const,
      }],
    }));
    const sendMessage = vi.fn(async () => ({
      conversationId: TEST_CONVERSATION_ID,
      message: {
        createdAt: '2026-07-29T18:00:00.000Z',
        deliveryStatus: 'pending' as const,
        id: 5,
        message: 'Already confirmed',
        sender: 'user' as const,
      },
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={sendMessage}
      />,
    );
    await act(async () => {
      await fetchMessages.mock.results[0]?.value;
    });

    const textarea = screen.getByRole('textbox', { name: 'Message to the developer' });
    fireEvent.change(textarea, { target: { value: 'Already confirmed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendMessage.mock.results[0]?.value;
    });

    expect(screen.queryByText('Delivery pending…')).not.toBeInTheDocument();
    expect(screen.getByText('Already confirmed')).toBeInTheDocument();
  });

  it('reports developer messages displayed by the dialog as seen', async () => {
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    const developerMessage = {
      createdAt: '2026-07-29T18:02:00.000Z',
      deliveryStatus: 'delivered' as const,
      id: 6,
      message: 'A reply from the developer',
      sender: 'developer' as const,
    };
    const fetchMessages = vi.fn(async () => ({
      conversationId: TEST_CONVERSATION_ID,
      cursor: 6,
      messages: [developerMessage],
    }));
    const onMessagesSeen = vi.fn();

    render(
      <DevChatDialog
        onClose={vi.fn()}
        onMessagesSeen={onMessagesSeen}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );
    await act(async () => {
      await fetchMessages.mock.results[0]?.value;
    });

    expect(onMessagesSeen).toHaveBeenCalledWith(
      TEST_CONVERSATION_ID,
      [developerMessage],
      6,
    );
    expect(screen.getByText('A reply from the developer')).toBeInTheDocument();
  });

  it('passes known pending message IDs to later polls and removes delivered IDs', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    const fetchMessages = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: TEST_CONVERSATION_ID,
        cursor: 7,
        messages: [{
          createdAt: '2026-07-29T18:01:00.000Z',
          deliveryStatus: 'pending',
          id: 7,
          message: 'Waiting for confirmation',
          sender: 'user',
        }],
      })
      .mockResolvedValueOnce({
        conversationId: TEST_CONVERSATION_ID,
        cursor: 7,
        messages: [{
          createdAt: '2026-07-29T18:01:00.000Z',
          deliveryStatus: 'delivered',
          id: 7,
          message: 'Waiting for confirmation',
          sender: 'user',
        }],
      })
      .mockResolvedValue({
        conversationId: TEST_CONVERSATION_ID,
        cursor: 7,
        messages: [],
      });

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMessages.mock.calls[0]?.[3]).toEqual([]);
    expect(screen.getByText('Delivery pending…')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(fetchMessages.mock.calls[1]?.[3]).toEqual([7]);
    expect(screen.queryByText('Delivery pending…')).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(fetchMessages.mock.calls[2]?.[3]).toEqual([]);
  });

  it('rotates more than 50 pending message IDs across bounded poll requests', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    const pendingMessages = Array.from({ length: 60 }, (_, index) => ({
      createdAt: '2026-07-29T18:01:00.000Z',
      deliveryStatus: 'pending' as const,
      id: index + 1,
      message: `Pending message ${index + 1}`,
      sender: 'user' as const,
    }));
    const fetchMessages = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: TEST_CONVERSATION_ID,
        cursor: 60,
        messages: pendingMessages,
      })
      .mockResolvedValue({
        conversationId: TEST_CONVERSATION_ID,
        cursor: 60,
        messages: [],
      });

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    const firstPendingBatch = fetchMessages.mock.calls[1]?.[3] ?? [];
    expect(firstPendingBatch).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    const secondPendingBatch = fetchMessages.mock.calls[2]?.[3] ?? [];
    expect(secondPendingBatch).toHaveLength(50);
    expect(secondPendingBatch.slice(0, 10)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 51),
    );
    expect(new Set([...firstPendingBatch, ...secondPendingBatch])).toEqual(
      new Set(Array.from({ length: 60 }, (_, index) => index + 1)),
    );
    expect(fetchMessages.mock.calls.every((call) => (call[3]?.length ?? 0) <= 50)).toBe(true);
  });

  it('polls immediately and then every three seconds using the latest cursor', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    const fetchMessages = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: TEST_CONVERSATION_ID,
        messages: [{
          deliveryStatus: 'delivered',
          id: 7,
          sender: 'developer',
          message: 'First reply',
          createdAt: '2026-07-29T18:01:00.000Z',
        }],
        cursor: 7,
      })
      .mockResolvedValue({
        conversationId: TEST_CONVERSATION_ID,
        messages: [{
          deliveryStatus: 'delivered',
          id: 8,
          sender: 'developer',
          message: 'Second reply',
          createdAt: '2026-07-29T18:01:03.000Z',
        }],
        cursor: 8,
      });

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(1);
    expect(fetchMessages.mock.calls[0]?.slice(0, 2)).toEqual([TEST_CONVERSATION_ID, 0]);
    expect(screen.getByText('First reply')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2_999);
      await Promise.resolve();
    });
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(fetchMessages.mock.calls[1]?.slice(0, 2)).toEqual([TEST_CONVERSATION_ID, 7]);
    expect(screen.getByText('Second reply')).toBeInTheDocument();
  });

  it('does not overlap polls while the preceding request is still in flight', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    let resolvePoll: ((value: {
      conversationId: string;
      messages: never[];
      cursor: number;
    }) => void) | undefined;
    const fetchMessages = vi.fn(() => new Promise<{
      conversationId: string;
      messages: never[];
      cursor: number;
    }>((resolve) => {
      resolvePoll = resolve;
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );

    expect(fetchMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(9_000);
    });
    expect(fetchMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePoll?.({
        conversationId: TEST_CONVERSATION_ID,
        messages: [],
        cursor: 0,
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(fetchMessages).toHaveBeenCalledTimes(2);
  });

  it('aborts polling when the dialog closes', () => {
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    let observedSignal: AbortSignal | undefined;
    const fetchMessages = vi.fn((
      _conversationId: string,
      _after?: number,
      signal?: AbortSignal,
    ) => {
      observedSignal = signal;
      return new Promise<never>(() => undefined);
    });

    const { unmount } = render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );

    expect(observedSignal?.aborted).toBe(false);
    unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it('starts a new conversation without losing the old chat and ignores a late old poll', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'old-conversation');
    let resolveOldPoll: ((value: {
      conversationId: string;
      messages: Array<{
        deliveryStatus: 'delivered';
        id: number;
        sender: 'developer';
        message: string;
        createdAt: string;
      }>;
      cursor: number;
    }) => void) | undefined;
    const fetchMessages = vi.fn(() => new Promise<{
      conversationId: string;
      messages: Array<{
        deliveryStatus: 'delivered';
        id: number;
        sender: 'developer';
        message: string;
        createdAt: string;
      }>;
      cursor: number;
    }>((resolve) => {
      resolveOldPoll = resolve;
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByText('Start a conversation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New conversation' })).not.toBeInTheDocument();
    expect(
      [...screen.getByRole<HTMLSelectElement>('combobox', { name: 'Saved chats' }).options]
        .map((option) => option.value),
    ).toContain('old-conversation');

    await act(async () => {
      resolveOldPoll?.({
        conversationId: 'old-conversation',
        messages: [{
          deliveryStatus: 'delivered',
          id: 99,
          sender: 'developer',
          message: 'Late reply from the old conversation',
          createdAt: '2026-07-29T18:03:00.000Z',
        }],
        cursor: 99,
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('Late reply from the old conversation')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('switches between saved conversations in the same dialog', async () => {
    storeDevChatConversationId('first-conversation', {
      createdAt: '2026-07-29T18:00:00.000Z',
      preview: 'First topic',
    });
    storeDevChatConversationId('second-conversation', {
      createdAt: '2026-07-29T19:00:00.000Z',
      preview: 'Second topic',
    });
    const fetchMessages = vi.fn(async (conversationId: string) => ({
      conversationId,
      cursor: conversationId === 'first-conversation' ? 1 : 2,
      messages: [{
        createdAt: conversationId === 'first-conversation'
          ? '2026-07-29T18:00:00.000Z'
          : '2026-07-29T19:00:00.000Z',
        deliveryStatus: 'delivered' as const,
        id: conversationId === 'first-conversation' ? 1 : 2,
        message: conversationId === 'first-conversation'
          ? 'First topic'
          : 'Second topic',
        sender: 'user' as const,
      }],
    }));

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={vi.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Second topic', { selector: '.dev-chat-message p' }))
      .toBeInTheDocument();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Saved chats' }),
      { target: { value: 'first-conversation' } },
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('first-conversation');
    expect(fetchMessages).toHaveBeenLastCalledWith(
      'first-conversation',
      0,
      expect.any(AbortSignal),
      [],
    );
    expect(screen.getByText('First topic', { selector: '.dev-chat-message p' }))
      .toBeInTheDocument();
    expect(screen.queryByText('Second topic', { selector: '.dev-chat-message p' }))
      .not.toBeInTheDocument();
  });

  it('keeps a send error visible when an overlapping poll succeeds', async () => {
    window.localStorage.setItem(STORAGE_KEY, TEST_CONVERSATION_ID);
    let resolvePoll: ((value: {
      conversationId: string;
      messages: never[];
      cursor: number;
    }) => void) | undefined;
    const fetchMessages = vi.fn(() => new Promise<{
      conversationId: string;
      messages: never[];
      cursor: number;
    }>((resolve) => {
      resolvePoll = resolve;
    }));
    const sendMessage = vi.fn(async () => {
      throw new Error('Message delivery failed');
    });

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={fetchMessages}
        sendMessage={sendMessage}
      />,
    );

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Message to the developer' }),
      { target: { value: 'Please send this' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await act(async () => {
      await sendMessage.mock.results[0]?.value.catch(() => undefined);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Message delivery failed');

    await act(async () => {
      resolvePoll?.({
        conversationId: TEST_CONVERSATION_ID,
        messages: [],
        cursor: 0,
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Message delivery failed');
  });

  it('reuses the client message ID only while retrying an unchanged failed draft', async () => {
    const sendMessage = vi.fn(async (
      _message: string,
      _conversationId?: string,
      _clientMessageId?: string,
    ) => {
      throw new Error('Message delivery failed');
    });

    render(
      <DevChatDialog
        onClose={vi.fn()}
        fetchMessages={vi.fn()}
        sendMessage={sendMessage}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Message to the developer' });
    fireEvent.change(textarea, { target: { value: 'Please retry this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendMessage.mock.results[0]?.value.catch(() => undefined);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendMessage.mock.results[1]?.value.catch(() => undefined);
    });

    const firstClientMessageId = sendMessage.mock.calls[0]?.[2];
    const retryClientMessageId = sendMessage.mock.calls[1]?.[2];
    expect(firstClientMessageId).toEqual(expect.any(String));
    expect(retryClientMessageId).toBe(firstClientMessageId);

    fireEvent.change(textarea, { target: { value: 'Please retry this with more context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => {
      await sendMessage.mock.results[2]?.value.catch(() => undefined);
    });

    expect(sendMessage.mock.calls[2]?.[2]).not.toBe(firstClientMessageId);
  });
});
