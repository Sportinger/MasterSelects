import type { RefObject } from 'react';
import type { FlashBoardChatMessage as StoredFlashBoardChatMessage } from '../../../stores/flashboardStore';
import type { AgentActivityEvent } from '../../../services/flashboard/FlashBoardChatTypes';
import type { StoryboardDecisionSelection } from '../../../services/storyboard/decisions';
import { KernelRunCard, KernelRunProgress } from './KernelRunCard';
import { StoryboardDecisionCard } from './storyboard';
import { canCopyFlashBoardChatMessage } from './FlashBoardChatMessageCopy';
import './KernelRunCard.css';

export type FlashBoardChatMessage = StoredFlashBoardChatMessage;

interface FlashBoardChatOutputProps {
  chatError: string | null;
  chatHistoryRef: RefObject<HTMLDivElement | null>;
  copiedChatMessageId: string | null;
  messages: FlashBoardChatMessage[];
  isChatting?: boolean;
  showChatCloudActions: boolean;
  onAuthClick: () => void;
  onMessageDoubleClick: (message: FlashBoardChatMessage) => void;
  onPricingClick: () => void;
  onDecisionSubmit?: (selection: StoryboardDecisionSelection) => void;
}

function activityText(event: AgentActivityEvent): string {
  if (event.kind === 'narration') return event.text;
  if (event.kind === 'progress') {
    return event.current !== undefined && event.total !== undefined
      ? `${event.label} (${event.current}/${event.total})`
      : event.label;
  }
  if (event.phase === 'completed') return `${event.safeLabel} completed`;
  if (event.phase === 'failed') return `${event.safeLabel} failed`;
  return event.safeLabel;
}

function activityMeta(event: AgentActivityEvent): string {
  if (event.kind === 'narration') return event.phase;
  if (event.kind === 'operation') return event.phase;
  return 'progress';
}

function ActivityEntries({ events }: { events: AgentActivityEvent[] }) {
  return (
    <ol className="fb-chat-activity-entries">
      {events.map((event) => (
        <li className={`is-${event.kind} is-${activityMeta(event)}`} key={event.id}>
          <span className="fb-chat-activity-meta">{activityMeta(event)}</span>
          <span>{activityText(event)}</span>
        </li>
      ))}
    </ol>
  );
}

function ChatActivity({ message }: { message: FlashBoardChatMessage }) {
  const events = message.activityEvents ?? [];
  if (events.length === 0) return null;

  // The latest chronological event owns the live headline. This keeps
  // model-authored narration useful without letting it mask a later,
  // authoritative runtime completion or failure.
  const latest = events[events.length - 1]!;

  if (message.isPending) {
    return (
      <section className="fb-chat-activity is-active" aria-label="AI work log">
        <div className="fb-chat-activity-latest" aria-atomic="true" aria-live="polite">
          <span className="fb-chat-activity-spinner" aria-hidden="true" />
          <span>{activityText(latest)}</span>
        </div>
        <div className="fb-chat-activity-log">
          <div className="fb-chat-activity-title">Work log</div>
          <ActivityEntries events={events} />
        </div>
      </section>
    );
  }

  return (
    <details className="fb-chat-activity is-settled">
      <summary>Work log <span>{events.length}</span></summary>
      <ActivityEntries events={events} />
    </details>
  );
}

export function FlashBoardChatOutput({
  chatError,
  chatHistoryRef,
  copiedChatMessageId,
  messages,
  isChatting = false,
  showChatCloudActions,
  onAuthClick,
  onMessageDoubleClick,
  onPricingClick,
  onDecisionSubmit,
}: FlashBoardChatOutputProps) {
  if (messages.length === 0 && !chatError) {
    return null;
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="fb-chat-output" ref={chatHistoryRef} aria-label="Chat history">
      {messages.map((message, index) => {
        // A kernel turn carries structured evidence, so it renders as a run
        // card rather than a prose bubble.
        if (message.role === 'assistant' && message.kernelReport) {
          return (
            <div className="fb-chat-message assistant is-kernel" key={message.id}>
              <KernelRunCard isLatest={index === lastIndex} report={message.kernelReport} />
              <ChatActivity message={message} />
            </div>
          );
        }

        if (message.isPending && message.kernelProgress) {
          return (
            <div className="fb-chat-message assistant is-pending is-kernel" key={message.id}>
              <KernelRunProgress progress={message.kernelProgress} />
              <ChatActivity message={message} />
            </div>
          );
        }

        const canCopy = canCopyFlashBoardChatMessage(message);
        const copied = copiedChatMessageId === message.id;

        return (
          <div
            key={message.id}
            className={`fb-chat-message ${message.role} ${message.isPending ? 'is-pending' : ''} ${message.isError ? 'is-error' : ''} ${canCopy ? 'is-copyable' : ''} ${copied ? 'is-copied' : ''}`}
            onDoubleClick={() => onMessageDoubleClick(message)}
            title={canCopy
              ? `Double-click to copy ${message.role === 'user' ? 'prompt' : 'response'}`
              : undefined}
          >
            <div className="fb-chat-output-label">
              {copied ? 'Copied' : message.role === 'user' ? 'You' : message.isError ? 'Error' : 'AI'}
            </div>
            {(!message.isPending || !message.activityEvents?.length) && (
              <div className="fb-chat-output-message">{message.text}</div>
            )}
            <ChatActivity message={message} />
            {message.decisionId && onDecisionSubmit && (
              <StoryboardDecisionCard
                decisionId={message.decisionId}
                isBusy={isChatting}
                onSubmit={onDecisionSubmit}
              />
            )}
          </div>
        );
      })}
      {chatError && (
        <div className={`fb-chat-message assistant is-error ${showChatCloudActions ? 'has-cloud-actions' : ''}`}>
          <div className="fb-chat-output-label">Error</div>
          <div className="fb-chat-output-message">{chatError}</div>
          {showChatCloudActions && (
            <div className="fb-chat-error-actions">
              <button type="button" onClick={onPricingClick}>
                Prices
              </button>
              <button type="button" onClick={onAuthClick}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
