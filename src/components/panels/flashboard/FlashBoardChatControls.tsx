import type { RefObject } from 'react';
import type {
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider';
type RenderedPopover = string | null;

interface FlashBoardChatControlsProps {
  activePopover: RenderedPopover;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  isChatting: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onClosePopover: (popover: ChatControlsPopover) => void;
  onOpenPopover: (popover: ChatControlsPopover) => void;
}

export function FlashBoardChatControls({
  activePopover,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  isChatting,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  onChatProviderSelect,
  onClosePopover,
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
