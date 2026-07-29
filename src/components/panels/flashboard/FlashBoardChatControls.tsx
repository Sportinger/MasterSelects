import type { RefObject } from 'react';
import type {
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider';
type RenderedPopover = string | null;

interface FlashBoardChatControlsProps {
  activePopover: RenderedPopover;
  chatError: string | null;
  chatPrompt: string;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  hasChatMessages: boolean;
  isChatting: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: ChatControlsPopover) => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (popover: ChatControlsPopover) => void;
}

export function FlashBoardChatControls({
  activePopover,
  chatError,
  chatPrompt,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  hasChatMessages,
  isChatting,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  onChatProviderSelect,
  onClearChatHistory,
  onClosePopover,
  onOpenPromptBook,
  onOpenPopover,
}: FlashBoardChatControlsProps) {
  return (
    <div className="fb-control-stack fb-chat-control-stack">
      <div className={popoverHostClassName} ref={popoverRef}>
        <button
          className={`fb-pill fb-chat-model-pill ${activePopover === 'chatProvider' ? 'active' : ''}`}
          type="button"
          onClick={() => onOpenPopover('chatProvider')}
          title={`Model: ${chatProviderLabel}`}
          aria-haspopup="menu"
          aria-expanded={activePopover === 'chatProvider'}
        >
          <span className="fb-pill-label">Model</span>
        </button>
        <button
          className="fb-pill fb-prompt-book-pill"
          type="button"
          onClick={onOpenPromptBook}
          title="Open chat Prompt Book"
        >
          <span className="fb-pill-label">Prompt Book</span>
        </button>
        <button
          className="fb-pill fb-chat-clear-pill"
          type="button"
          onClick={onClearChatHistory}
          disabled={!hasChatMessages && !chatPrompt && !chatError}
          title="Clear chat history and start a new chat"
        >
          <span className="fb-pill-label">New</span>
        </button>

        {renderedPopover === 'chatProvider' && (
          <div className="fb-popover" role="menu" aria-label="Chat model">
            <div className="fb-popover-title">Model</div>
            <div className="fb-popover-pills">
              {chatProviderOptions.map((provider) => (
                <button
                  key={provider.id}
                  className={`fb-popover-pill ${chatProvider === provider.id ? 'active' : ''}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chatProvider === provider.id}
                  onClick={() => {
                    onChatProviderSelect(provider.id);
                    onClosePopover('chatProvider');
                  }}
                  disabled={isChatting}
                >
                  <span className="fb-popover-pill-label">{provider.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
