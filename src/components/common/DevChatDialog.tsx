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
  sendDevChatMessage,
  storeDevChatConversationId,
  type DevChatMessage,
  type FetchDevChatMessagesResponse,
  type SendDevChatMessageResponse,
} from '../../services/devChatService';
import './DevChatDialog.css';

const POLL_INTERVAL_MS = 3_000;

interface DevChatDialogProps {
  onClose: () => void;
  fetchMessages?: (
    conversationId: string,
    after?: number,
    signal?: AbortSignal,
  ) => Promise<FetchDevChatMessagesResponse>;
  sendMessage?: (
    message: string,
    conversationId?: string,
  ) => Promise<SendDevChatMessageResponse>;
}

function mergeMessages(current: DevChatMessage[], incoming: DevChatMessage[]): DevChatMessage[] {
  if (incoming.length === 0) return current;

  const messagesById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messagesById.set(message.id, message);
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

export function DevChatDialog({
  onClose,
  fetchMessages = fetchDevChatMessages,
  sendMessage = sendDevChatMessage,
}: DevChatDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pollGenerationRef = useRef(0);
  const [conversationId, setConversationId] = useState(getStoredDevChatConversationId);
  const [messages, setMessages] = useState<DevChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pollError, setPollError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(conversationId));
  const [isSending, setIsSending] = useState(false);
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

    const poll = async () => {
      if (pollInFlight || !isActive) return;
      pollInFlight = true;

      try {
        const response = await fetchMessages(conversationId, cursor, controller.signal);
        if (!isActive || pollGenerationRef.current !== pollGeneration) return;

        cursor = Math.max(cursor, response.cursor);
        setMessages((current) => mergeMessages(current, response.messages));
        setPollError(null);

        if (response.conversationId !== conversationId) {
          storeDevChatConversationId(response.conversationId);
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
  }, [conversationId, fetchMessages]);

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
    clearStoredDevChatConversationId();
    setConversationId(undefined);
    setMessages([]);
    setDraft('');
    setPollError(null);
    setSendError(null);
    setIsLoading(false);
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
      const response = await sendMessage(message, conversationId);
      storeDevChatConversationId(response.conversationId);
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
    <div
      className="dev-chat-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dev-chat-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="dev-chat-accent" aria-hidden="true" />
        <div className="dev-chat-header">
          <div>
            <h2 id={titleId}>Chat with dev</h2>
            <p><span aria-hidden="true" /> Replies appear here automatically</p>
          </div>
          <div className="dev-chat-header-actions">
            {conversationId && (
              <button
                type="button"
                className="dev-chat-new"
                disabled={isSending}
                title="Forget this conversation on this device and start a new one"
                onClick={handleNewConversation}
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
              return (
                <div
                  key={chatMessage.id}
                  className={`dev-chat-message ${chatMessage.sender}`}
                >
                  <div className="dev-chat-message-meta">
                    <strong>{chatMessage.sender === 'developer' ? 'Dev' : 'You'}</strong>
                    {displayTime && (
                      <time dateTime={chatMessage.createdAt}>{displayTime}</time>
                    )}
                  </div>
                  <p>{chatMessage.message}</p>
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
