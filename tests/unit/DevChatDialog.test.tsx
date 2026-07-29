import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevChatDialog } from '../../src/components/common/DevChatDialog';

const STORAGE_KEY = 'masterselects.devChat.conversationId';

describe('DevChatDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a trimmed message and persists the returned conversation', async () => {
    const sendMessage = vi.fn(async () => ({
      conversationId: 'conversation-123',
      message: {
        id: 1,
        sender: 'user' as const,
        message: 'Hello developer',
        createdAt: '2026-07-29T18:00:00.000Z',
      },
    }));
    const fetchMessages = vi.fn(async () => ({
      conversationId: 'conversation-123',
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

    expect(sendMessage).toHaveBeenCalledWith('Hello developer', undefined);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('conversation-123');
    expect(screen.getByText('Hello developer')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(textarea).toHaveValue('');
  });

  it('polls immediately and then every three seconds using the latest cursor', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, 'conversation-123');
    const fetchMessages = vi
      .fn()
      .mockResolvedValueOnce({
        conversationId: 'conversation-123',
        messages: [{
          id: 7,
          sender: 'developer',
          message: 'First reply',
          createdAt: '2026-07-29T18:01:00.000Z',
        }],
        cursor: 7,
      })
      .mockResolvedValue({
        conversationId: 'conversation-123',
        messages: [{
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
    expect(fetchMessages.mock.calls[0]?.slice(0, 2)).toEqual(['conversation-123', 0]);
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
    expect(fetchMessages.mock.calls[1]?.slice(0, 2)).toEqual(['conversation-123', 7]);
    expect(screen.getByText('Second reply')).toBeInTheDocument();
  });

  it('does not overlap polls while the preceding request is still in flight', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(STORAGE_KEY, 'conversation-123');
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
        conversationId: 'conversation-123',
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
    window.localStorage.setItem(STORAGE_KEY, 'conversation-123');
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

  it('starts a new conversation, clears storage, and ignores a late old poll', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'old-conversation');
    let resolveOldPoll: ((value: {
      conversationId: string;
      messages: Array<{
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

    await act(async () => {
      resolveOldPoll?.({
        conversationId: 'old-conversation',
        messages: [{
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

  it('keeps a send error visible when an overlapping poll succeeds', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'conversation-123');
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
        conversationId: 'conversation-123',
        messages: [],
        cursor: 0,
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Message delivery failed');
  });
});
