import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  clearStoredDevChatConversationId,
  fetchDevChatMessages,
  getStoredDevChatConversationId,
  getStoredDevChatConversations,
  MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST,
  sendDevChatMessage,
  storeDevChatConversationId,
  type DevChatMessage,
  type FetchDevChatMessagesResponse,
  type SendDevChatMessageResponse,
  type StoredDevChatConversation,
} from '../../services/devChatService';
import { useDraggableDialog } from './settings/useDraggableDialog';
import './DevChatDialog.css';

const POLL_INTERVAL_MS = 3_000;

interface DevChatDialogProps {
  onClose: () => void;
  onMessagesSeen?: (
    conversationId: string,
    messages: DevChatMessage[],
    cursor: number,
  ) => void;
  fetchMessages?: (
    conversationId: string,
    after?: number,
    signal?: AbortSignal,
    pendingIds?: number[],
  ) => Promise<FetchDevChatMessagesResponse>;
  sendMessage?: (
    message: string,
    conversationId?: string,
    clientMessageId?: string,
  ) => Promise<SendDevChatMessageResponse>;
}

interface PendingClientMessage {
  clientMessageId: string;
  draft: string;
}

function getPendingMessageBatch(
  pendingMessageIds: Set<number>,
  offset: number,
): { ids: number[]; nextOffset: number } {
  const sortedIds = [...pendingMessageIds].sort((a, b) => a - b);
  if (sortedIds.length <= MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST) {
    return { ids: sortedIds, nextOffset: 0 };
  }

  const start = offset % sortedIds.length;
  const ids = Array.from(
    { length: MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST },
    (_, index) => sortedIds[(start + index) % sortedIds.length],
  );
  return {
    ids,
    nextOffset: (start + MAX_DEV_CHAT_PENDING_IDS_PER_REQUEST) % sortedIds.length,
  };
}

function mergeMessages(current: DevChatMessage[], incoming: DevChatMessage[]): DevChatMessage[] {
  if (incoming.length === 0) return current;

  const messagesById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = messagesById.get(message.id);
    const incomingStatus = message.deliveryStatus === 'pending' ? 'pending' : 'delivered';
    messagesById.set(message.id, {
      ...message,
      deliveryStatus: existing?.deliveryStatus === 'delivered'
        ? 'delivered'
        : incomingStatus,
    });
  }
  return [...messagesById.values()].sort((a, b) => a.id - b.id);
}

function getReadableError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function formatMessageTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatConversationLabel(conversation: StoredDevChatConversation): string {
  const createdAt = new Date(conversation.createdAt);
  const dateLabel = Number.isNaN(createdAt.getTime())
    ? 'Saved chat'
    : new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    }).format(createdAt);
  return conversation.preview
    ? `${dateLabel} — ${conversation.preview}`
    : dateLabel;
}

export function DevChatDialog({
  onClose,
  onMessagesSeen,
  fetchMessages = fetchDevChatMessages,
  sendMessage = sendDevChatMessage,
}: DevChatDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollGenerationRef = useRef(0);
  const pendingClientMessageRef = useRef<PendingClientMessage | null>(null);
  const [conversationId, setConversationId] = useState(getStoredDevChatConversationId);
  const [storedConversations, setStoredConversations] = useState(
    getStoredDevChatConversations,
  );
  const [messages, setMessages] = useState<DevChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(conversationId));
  const [isSending, setIsSending] = useState(false);
  const { position, isDragging, handleMouseDown } = useDraggableDialog(dialogRef);
  const visibleError = sendError ?? pollError;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSending) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isSending, onClose]);

  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!conversationId) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const pollGeneration = ++pollGenerationRef.current;
    let cursor = 0;
    let isActive = true;
    let pollInFlight = false;
    const pendingMessageIds = new Set<number>();
    let pendingMessageOffset = 0;

    const poll = async () => {
      if (pollInFlight || !isActive) return;
      pollInFlight = true;

      try {
        const pendingBatch = getPendingMessageBatch(
          pendingMessageIds,
          pendingMessageOffset,
        );
        pendingMessageOffset = pendingBatch.nextOffset;
        const response = await fetchMessages(
          conversationId,
          cursor,
          controller.signal,
          pendingBatch.ids,
        );
        if (!isActive || pollGenerationRef.current !== pollGeneration) return;

        cursor = Math.max(cursor, response.cursor);
        onMessagesSeen?.(
          response.conversationId,
          response.messages,
          response.cursor,
        );
        for (const message of response.messages) {
          if (message.deliveryStatus === 'pending') {
            pendingMessageIds.add(message.id);
          } else {
            pendingMessageIds.delete(message.id);
          }
        }
        setMessages((current) => mergeMessages(current, response.messages));
        setPollError(null);

        if (response.messages.length > 0) {
          const firstMessage = response.messages[0];
          const firstUserMessage = response.messages.find(
            (message) => message.sender === 'user',
          );
          storeDevChatConversationId(response.conversationId, {
            createdAt: firstMessage.createdAt,
            preview: firstUserMessage?.message,
          });
          setStoredConversations(getStoredDevChatConversations());
        }

        if (response.conversationId !== conversationId) {
          setConversationId(response.conversationId);
        }
      } catch (pollError) {
        if (
          !controller.signal.aborted
          && isActive
          && pollGenerationRef.current === pollGeneration
        ) {
          setPollError(getReadableError(
            pollError,
            'Could not load the conversation. Please check your connection and try again.',
          ));
        }
      } finally {
        if (isActive && pollGenerationRef.current === pollGeneration) {
          setIsLoading(false);
        }
        pollInFlight = false;
      }
    };

    void poll();
    const pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      controller.abort();
      window.clearInterval(pollTimer);
    };
  }, [conversationId, fetchMessages, onMessagesSeen]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleNewConversation = () => {
    pollGenerationRef.current += 1;
    pendingClientMessageRef.current = null;
    clearStoredDevChatConversationId();
    setStoredConversations(getStoredDevChatConversations());
    setConversationId(undefined);
    setMessages([]);
    setDraft('');
    setPollError(null);
    setSendError(null);
    setIsLoading(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSelectConversation = (nextConversationId: string) => {
    if (!nextConversationId) {
      handleNewConversation();
      return;
    }
    if (nextConversationId === conversationId) return;

    pollGenerationRef.current += 1;
    pendingClientMessageRef.current = null;
    storeDevChatConversationId(nextConversationId);
    setStoredConversations(getStoredDevChatConversations());
    setConversationId(nextConversationId);
    setMessages([]);
    setDraft('');
    setPollError(null);
    setSendError(null);
    setIsLoading(true);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSending) return;

    const message = draft.trim();
    if (!message) {
      textareaRef.current?.focus();
      return;
    }

    setSendError(null);
    setIsSending(true);

    try {
      const pendingClientMessage = pendingClientMessageRef.current;
      const clientMessageId = pendingClientMessage?.draft === draft
        ? pendingClientMessage.clientMessageId
        : crypto.randomUUID();
      pendingClientMessageRef.current = { clientMessageId, draft };
      const response = await sendMessage(message, conversationId, clientMessageId);
      pendingClientMessageRef.current = null;
      storeDevChatConversationId(response.conversationId, {
        createdAt: response.message.createdAt,
        preview: message,
      });
      setStoredConversations(getStoredDevChatConversations());
      setMessages((current) => mergeMessages(current, [response.message]));
      setDraft('');

      if (response.conversationId !== conversationId) {
        setConversationId(response.conversationId);
      }
    } catch (sendError) {
      setSendError(getReadableError(
        sendError,
        'Could not send your message. Please check your connection and try again.',
      ));
    } finally {
      setIsSending(false);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  return (
    <div className="dev-chat-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className={`dev-chat-dialog${isDragging ? ' is-dragging' : ''}`}
        style={{
          left: position.x,
          top: position.y,
        }}
        role="dialog"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="dev-chat-accent" aria-hidden="true" />
        <div className="dev-chat-header" onMouseDown={handleMouseDown}>
          <div>
            <h2 id={titleId}>Chat with dev</h2>
            <p><span aria-hidden="true" /> Replies appear here automatically</p>
          </div>
          <div className="dev-chat-header-actions">
            {storedConversations.length > 0 && (
              <label className="dev-chat-history">
                <span className="sr-only">Saved chats</span>
                <select
                  aria-label="Saved chats"
                  value={conversationId ?? ''}
                  disabled={isSending}
                  title="Open an earlier conversation"
                  onChange={(event) => handleSelectConversation(event.target.value)}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <option value="">New chat</option>
                  {storedConversations.map((storedConversation) => (
                    <option
                      key={storedConversation.id}
                      value={storedConversation.id}
                    >
                      {formatConversationLabel(storedConversation)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {conversationId && (
              <button
                type="button"
                className="dev-chat-new"
                disabled={isSending}
                title="Forget this conversation on this device and start a new one"
                onClick={handleNewConversation}
                onMouseDown={(event) => event.stopPropagation()}
              >
                New conversation
              </button>
            )}
            <button
              type="button"
              className="dev-chat-close"
              aria-label="Close developer chat"
              disabled={isSending}
              onClick={onClose}
              onMouseDown={(event) => event.stopPropagation()}
            >
              ×
            </button>
          </div>
        </div>

        <div
          ref={messagesRef}
          className="dev-chat-messages"
          role="log"
          aria-busy={isLoading}
          aria-live="polite"
          aria-relevant="additions"
        >
          {isLoading && messages.length === 0 ? (
            <div className="dev-chat-placeholder" role="status">
              <span className="dev-chat-spinner" aria-hidden="true" />
              Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="dev-chat-empty">
              <strong>Start a conversation</strong>
              <span>Send a message and the developer can reply here.</span>
            </div>
          ) : (
            messages.map((chatMessage) => {
              const displayTime = formatMessageTime(chatMessage.createdAt);
              const isDeliveryPending = (
                chatMessage.sender === 'user'
                && chatMessage.deliveryStatus === 'pending'
              );
              return (
                <div
                  key={chatMessage.id}
                  className={`dev-chat-message ${chatMessage.sender}${isDeliveryPending ? ' pending' : ''}`}
                >
                  <div className="dev-chat-message-meta">
                    <strong>{chatMessage.sender === 'developer' ? 'Dev' : 'You'}</strong>
                    {displayTime && (
                      <time dateTime={chatMessage.createdAt}>{displayTime}</time>
                    )}
                  </div>
                  <p>{chatMessage.message}</p>
                  {isDeliveryPending && (
                    <span className="dev-chat-delivery-status" role="status">
                      Delivery pending…
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {visibleError && (
            <div id={`${titleId}-error`} className="dev-chat-error" role="alert">
              {visibleError}
            </div>
          )}

          <label className="dev-chat-field">
            <span className="sr-only">Message to the developer</span>
            <textarea
              ref={textareaRef}
              value={draft}
              maxLength={2000}
              rows={3}
              placeholder="Write a message…"
              disabled={isSending}
              aria-invalid={sendError ? 'true' : undefined}
              aria-describedby={visibleError ? `${titleId}-error` : undefined}
              onChange={(event) => {
                pendingClientMessageRef.current = null;
                setDraft(event.target.value);
                if (sendError) setSendError(null);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter'
                  && !event.shiftKey
                  && !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>

          <div className="dev-chat-actions">
            <span>{draft.length}/2000</span>
            <button
              type="submit"
              className="dev-chat-send"
              disabled={isSending || !draft.trim()}
            >
              {isSending ? (
                <>
                  <span className="dev-chat-spinner" aria-hidden="true" />
                  Sending…
                </>
              ) : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
