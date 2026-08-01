import type { RefObject } from 'react';
import type {
  FlashBoardChatExecutionProfile,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider' | 'chatExecutionProfile';
type RenderedPopover = string | null;
type ExecutionProfileAvailabilityStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

interface FlashBoardChatControlsProps {
  activePopover: RenderedPopover;
  chatError: string | null;
  chatExecutionProfile: FlashBoardChatExecutionProfile;
  chatExecutionProfileAvailabilityStatus: ExecutionProfileAvailabilityStatus;
  chatPrompt: string;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  availableChatExecutionProfiles: readonly FlashBoardChatExecutionProfile[];
  hasChatMessages: boolean;
  isChatting: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  showChatExecutionProfile: boolean;
  onChatExecutionProfileSelect: (profile: FlashBoardChatExecutionProfile) => void;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: ChatControlsPopover) => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (popover: ChatControlsPopover) => void;
}

export function FlashBoardChatControls({
  activePopover,
  chatError,
  chatExecutionProfile,
  chatExecutionProfileAvailabilityStatus,
  chatPrompt,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  availableChatExecutionProfiles,
  hasChatMessages,
  isChatting,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  showChatExecutionProfile,
  onChatExecutionProfileSelect,
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
        {showChatExecutionProfile && (
          <button
            className={`fb-pill fb-chat-profile-pill ${activePopover === 'chatExecutionProfile' ? 'active' : ''}`}
            type="button"
            onClick={() => onOpenPopover('chatExecutionProfile')}
            title={`Execution profile: ${chatExecutionProfile === 'verified' ? 'Verified' : 'Fast'}`}
            aria-haspopup="menu"
            aria-expanded={activePopover === 'chatExecutionProfile'}
            disabled={isChatting}
          >
            <span className="fb-pill-label">
              {chatExecutionProfile === 'verified' ? 'Verified' : 'Fast'}
            </span>
          </button>
        )}
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

        {showChatExecutionProfile && renderedPopover === 'chatExecutionProfile' && (
          <div className="fb-popover" role="menu" aria-label="Execution profile">
            <div className="fb-popover-title">Execution profile</div>
            <div className="fb-popover-pills">
              {(['fast', 'verified'] as const).map((profile) => {
                const available = availableChatExecutionProfiles.includes(profile);
                const verifiedUnavailable = profile === 'verified' && !available;
                const title = profile === 'verified'
                  ? available
                    ? 'Verified: local Range Removal pilot; reload resume is unavailable.'
                    : chatExecutionProfileAvailabilityStatus === 'loading'
                      ? 'Checking whether the local Verified pilot is available.'
                      : 'Verified is unavailable in this local environment.'
                  : 'Fast: default hosted execution profile.';
                return (
                  <button
                    key={profile}
                    className={`fb-popover-pill ${chatExecutionProfile === profile ? 'active' : ''}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={chatExecutionProfile === profile}
                    aria-disabled={isChatting || verifiedUnavailable}
                    onClick={() => {
                      onChatExecutionProfileSelect(profile);
                      onClosePopover('chatExecutionProfile');
                    }}
                    disabled={isChatting || verifiedUnavailable}
                    title={title}
                  >
                    <span className="fb-popover-pill-label">
                      {profile === 'verified' ? 'Verified · local pilot' : 'Fast'}
                    </span>
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
