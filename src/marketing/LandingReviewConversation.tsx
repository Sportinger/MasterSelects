import type { FlashBoardChatMessage } from '../stores/flashboardStore';

interface LandingReviewConversationProps {
  disabled?: boolean;
  messages: FlashBoardChatMessage[];
  onSelectInputOption?: (prompt: string) => void;
}

export function LandingReviewConversation({
  disabled = false,
  messages,
  onSelectInputOption,
}: LandingReviewConversationProps) {
  if (messages.length === 0) return null;

  return (
    <section className="landing-review-conversation" aria-label="Chat about this edit version">
      {messages.map(message => (
        <article
          className={`landing-review-message is-${message.role} ${message.isError ? 'is-error' : ''}`}
          key={message.id}
        >
          <span>{message.role === 'user' ? 'You' : message.isError ? 'Error' : 'AI'}</span>
          <p aria-live={message.isPending ? 'polite' : undefined}>
            {message.text}
            {message.isPending && <i className="landing-review-message-caret" aria-hidden="true" />}
          </p>
          {message.inputRequest && (
            <div className="landing-review-input-options" aria-label={message.inputRequest.question}>
              {message.inputRequest.options.map(option => (
                <button
                  disabled={disabled || !onSelectInputOption}
                  key={option.id}
                  type="button"
                  onClick={() => onSelectInputOption?.(
                    `For “${message.inputRequest!.question}”, I choose “${option.title}” (${option.id}). ${option.description}`,
                  )}
                >
                  <strong>{option.title}</strong>
                  {option.description && <span>{option.description}</span>}
                </button>
              ))}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
