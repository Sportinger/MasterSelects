import type { RefObject } from 'react';
import type {
  FlashBoardChatAgentMode,
} from '../../../services/flashboard/FlashBoardChatService';
import { FLASHBOARD_CHAT_AGENT_OPTIONS, flashBoardChatAgentModeLabel } from './flashBoardChatAgentOptions';

type ChatControlsPopover = 'chatModelClass';
type RenderedPopover = string | null;

interface FlashBoardChatControlsProps {
  activePopover: RenderedPopover;
  chatAgentMode: FlashBoardChatAgentMode;
  chatError: string | null;
  chatPrompt: string;
  hasChatMessages: boolean;
  isChatting: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  onChatAgentModeSelect: (agentMode: FlashBoardChatAgentMode) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: ChatControlsPopover) => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (popover: ChatControlsPopover) => void;
}

export function FlashBoardChatControls({
  activePopover,
  chatAgentMode,
  chatError,
  chatPrompt,
  hasChatMessages,
  isChatting,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  onChatAgentModeSelect,
  onClearChatHistory,
  onClosePopover,
  onOpenPromptBook,
  onOpenPopover,
}: FlashBoardChatControlsProps) {
  return (
    <div className="fb-control-stack fb-chat-control-stack">
      <div className={popoverHostClassName} ref={popoverRef}>
        <button
          className={`fb-pill fb-chat-model-pill ${activePopover === 'chatModelClass' ? 'active' : ''}`}
          type="button"
          onClick={() => onOpenPopover('chatModelClass')}
          title={`Model: ${flashBoardChatAgentModeLabel(chatAgentMode)}`}
          aria-haspopup="menu"
          aria-expanded={activePopover === 'chatModelClass'}
          disabled={isChatting}
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

        {renderedPopover === 'chatModelClass' && (
          <div className="fb-popover" role="menu" aria-label="Chat model route">
            <div className="fb-popover-title">Model</div>
            <div className="fb-popover-pills">
              {FLASHBOARD_CHAT_AGENT_OPTIONS.map((option) => {
                return (
                  <button
                    key={option.id}
                    className={`fb-popover-pill ${chatAgentMode === option.id ? 'active' : ''}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chatAgentMode === option.id}
                    onClick={() => {
                      onChatAgentModeSelect(option.id);
                      onClosePopover('chatModelClass');
                    }}
                    disabled={isChatting}
                    title={option.title}
                  >
                    <span className="fb-popover-pill-label">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
