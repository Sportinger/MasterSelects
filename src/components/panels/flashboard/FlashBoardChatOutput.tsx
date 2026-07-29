import type { RefObject } from 'react';
import type { FlashBoardChatMessage as StoredFlashBoardChatMessage } from '../../../stores/flashboardStore';
import { KernelRunCard, KernelRunProgress } from './KernelRunCard';
import './KernelRunCard.css';

export type FlashBoardChatMessage = StoredFlashBoardChatMessage;

interface FlashBoardChatOutputProps {
  chatError: string | null;
  chatHistoryRef: RefObject<HTMLDivElement | null>;
  copiedChatMessageId: string | null;
  messages: FlashBoardChatMessage[];
  showChatCloudActions: boolean;
  onAuthClick: () => void;
  onMessageDoubleClick: (message: FlashBoardChatMessage) => void;
  onPricingClick: () => void;
}

export function FlashBoardChatOutput({
  chatError,
  chatHistoryRef,
  copiedChatMessageId,
  messages,
  showChatCloudActions,
  onAuthClick,
  onMessageDoubleClick,
  onPricingClick,
}: FlashBoardChatOutputProps) {
  if (messages.length === 0 && !chatError) {
    return null;
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="fb-chat-output" ref={chatHistoryRef} role="log" aria-live="polite">
      {messages.map((message, index) => {
        // A kernel turn carries structured evidence, so it renders as a run
        // card rather than a prose bubble.
        if (message.role === 'assistant' && message.kernelReport) {
          return (
            <div className="fb-chat-message assistant is-kernel" key={message.id}>
              <KernelRunCard isLatest={index === lastIndex} report={message.kernelReport} />
            </div>
          );
        }

        if (message.isPending && message.kernelProgress) {
          return (
            <div className="fb-chat-message assistant is-pending is-kernel" key={message.id}>
              <KernelRunProgress progress={message.kernelProgress} />
            </div>
          );
        }

        const canCopy = message.role === 'assistant'
          && !message.isPending
          && !message.isError
          && Boolean(message.text.trim());
        const copied = copiedChatMessageId === message.id;

        return (
          <div
            key={message.id}
            className={`fb-chat-message ${message.role} ${message.isPending ? 'is-pending' : ''} ${message.isError ? 'is-error' : ''} ${canCopy ? 'is-copyable' : ''} ${copied ? 'is-copied' : ''}`}
            onDoubleClick={() => onMessageDoubleClick(message)}
            title={canCopy ? 'Double-click to copy response' : undefined}
          >
            <div className="fb-chat-output-label">
              {message.role === 'user' ? 'You' : copied ? 'Copied' : message.isError ? 'Error' : 'AI'}
            </div>
            <div className="fb-chat-output-message">{message.text}</div>
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
