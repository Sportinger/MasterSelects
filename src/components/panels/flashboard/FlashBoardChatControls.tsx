import type { RefObject } from 'react';
import type {
  FlashBoardChatModelOption,
  FlashBoardChatProvider,
  FlashBoardChatProviderOption,
  FlashBoardOpenAiReasoningEffort,
} from '../../../services/flashboard/FlashBoardChatService';

type ChatControlsPopover = 'chatProvider' | 'chatModel' | 'chatTemperature' | 'chatReasoning' | null;
type RenderedPopover = string | null;
type ChatApprovalMode = 'auto' | 'confirm-destructive' | 'confirm-all-mutating';
type LemonadeStatus = 'idle' | 'checking' | 'online' | 'offline';

interface ChatReasoningOption {
  id: FlashBoardOpenAiReasoningEffort;
  label: string;
}

interface FlashBoardChatControlsProps {
  activeChatModel?: FlashBoardChatModelOption;
  activeChatModelId: string;
  activePopover: RenderedPopover;
  aiApprovalMode: ChatApprovalMode;
  chatError: string | null;
  chatModelOptions: FlashBoardChatModelOption[];
  chatPrompt: string;
  chatProvider: FlashBoardChatProvider;
  chatProviderLabel: string;
  chatProviderOptions: FlashBoardChatProviderOption[];
  chatReasoningEffortOptions: ChatReasoningOption[];
  chatReasoningSupported: boolean;
  chatTemperature: number;
  chatTemperatureSupported: boolean;
  hasChatMessages: boolean;
  isChatting: boolean;
  lemonadeStatus: LemonadeStatus;
  openAiReasoningEffort: FlashBoardOpenAiReasoningEffort;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  renderedPopover: RenderedPopover;
  onAiApprovalModeChange: (mode: ChatApprovalMode) => void;
  onChatErrorClear: () => void;
  onChatModelChange: (modelId: string) => void;
  onChatProviderSelect: (provider: FlashBoardChatProvider) => void;
  onChatTemperatureChange: (temperature: number) => void;
  onClearChatHistory: () => void;
  onClosePopover: (popover: NonNullable<ChatControlsPopover>) => void;
  onOpenPopover: (popover: NonNullable<ChatControlsPopover>) => void;
  onReasoningEffortChange: (effort: FlashBoardOpenAiReasoningEffort) => void;
}

export function FlashBoardChatControls({
  activeChatModel,
  activeChatModelId,
  activePopover,
  aiApprovalMode,
  chatError,
  chatModelOptions,
  chatPrompt,
  chatProvider,
  chatProviderLabel,
  chatProviderOptions,
  chatReasoningEffortOptions,
  chatReasoningSupported,
  chatTemperature,
  chatTemperatureSupported,
  hasChatMessages,
  isChatting,
  lemonadeStatus,
  openAiReasoningEffort,
  popoverHostClassName,
  popoverRef,
  renderedPopover,
  onAiApprovalModeChange,
  onChatErrorClear,
  onChatModelChange,
  onChatProviderSelect,
  onChatTemperatureChange,
  onClearChatHistory,
  onClosePopover,
  onOpenPopover,
  onReasoningEffortChange,
}: FlashBoardChatControlsProps) {
  return (
    <div className="fb-control-stack">
      <div className={popoverHostClassName} ref={popoverRef}>
        <button
          className={`fb-pill ${activePopover === 'chatProvider' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatProvider')}
          title={`Provider: ${chatProviderLabel}`}
        >
          {chatProviderLabel}
        </button>
        <button
          className={`fb-pill ${activePopover === 'chatModel' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatModel')}
          title={`Model: ${activeChatModel?.label ?? activeChatModelId}`}
        >
          {activeChatModel?.label ?? activeChatModelId}
        </button>
        {chatReasoningSupported && (
          <button
            className={`fb-pill ${activePopover === 'chatReasoning' ? 'active' : ''}`}
            onClick={() => onOpenPopover('chatReasoning')}
            title={`Reasoning effort: ${openAiReasoningEffort}`}
          >
            {openAiReasoningEffort}
          </button>
        )}
        <button
          className={`fb-pill ${activePopover === 'chatTemperature' ? 'active' : ''}`}
          onClick={() => onOpenPopover('chatTemperature')}
          title={chatTemperatureSupported ? `Temperature: ${chatTemperature.toFixed(1)}` : 'Temperature fixed for this model'}
        >
          {chatTemperatureSupported ? `Temp ${chatTemperature.toFixed(1)}` : 'Fixed temp'}
        </button>
        <button
          className={`fb-pill fb-chat-approval-pill ${aiApprovalMode === 'auto' ? 'active' : ''}`}
          type="button"
          onClick={() => onAiApprovalModeChange(aiApprovalMode === 'auto' ? 'confirm-destructive' : 'auto')}
          title={aiApprovalMode === 'auto'
            ? 'Auto-approve ON - the chat runs edits (incl. executeBatch and imports) without asking. Click to require confirmation.'
            : 'Auto-approve OFF - edits that need confirmation (executeBatch, local imports) are blocked in chat. Click to let the chat run them automatically.'}
        >
          {aiApprovalMode === 'auto' ? 'Auto on' : 'Auto off'}
        </button>
        <button
          className="fb-pill fb-chat-clear-pill"
          type="button"
          onClick={onClearChatHistory}
          disabled={!hasChatMessages && !chatPrompt && !chatError}
          title="Clear chat history and start a new chat"
        >
          New
        </button>

        {renderedPopover === 'chatProvider' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Provider</div>
            <div className="fb-popover-pills">
              {chatProviderOptions.map((provider) => (
                <button
                  key={provider.id}
                  className={`fb-popover-pill ${chatProvider === provider.id ? 'active' : ''}`}
                  type="button"
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
            {chatProvider === 'lemonade' && (
              <div className={`fb-chat-status ${lemonadeStatus}`}>
                {lemonadeStatus === 'idle' ? 'Local' : lemonadeStatus}
              </div>
            )}
          </div>
        )}

        {renderedPopover === 'chatModel' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Model</div>
            <div className="fb-popover-pills">
              {chatModelOptions.map((model) => (
                <button
                  key={model.id}
                  className={`fb-popover-pill ${activeChatModelId === model.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    onChatModelChange(model.id);
                    onChatErrorClear();
                    onClosePopover('chatModel');
                  }}
                  disabled={isChatting}
                  title={model.id}
                >
                  <span className="fb-popover-pill-label">{model.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderedPopover === 'chatReasoning' && (
          <div className="fb-popover">
            <div className="fb-popover-title">Reasoning</div>
            <div className="fb-popover-pills">
              {chatReasoningEffortOptions.map((option) => (
                <button
                  key={option.id}
                  className={`fb-popover-pill ${openAiReasoningEffort === option.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => {
                    onReasoningEffortChange(option.id);
                    onChatErrorClear();
                    onClosePopover('chatReasoning');
                  }}
                  disabled={isChatting}
                >
                  <span className="fb-popover-pill-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {renderedPopover === 'chatTemperature' && (
          <div className="fb-popover fb-chat-temperature-popover">
            <div className="fb-popover-title">Temperature</div>
            <label className={`fb-chat-temperature ${chatTemperatureSupported ? '' : 'disabled'}`}>
              <span>Temp</span>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={chatTemperature}
                onChange={(event) => onChatTemperatureChange(Number(event.target.value))}
                disabled={isChatting || !chatTemperatureSupported}
              />
              <strong>{chatTemperatureSupported ? chatTemperature.toFixed(1) : 'fixed'}</strong>
            </label>
          </div>
        )}
      </div>
      <div
        className="fb-selected-model-label fb-chat-selected-model-label"
        title={`${chatProviderLabel} / ${activeChatModel?.label ?? activeChatModelId}`}
      >
        Chat
      </div>
    </div>
  );
}
