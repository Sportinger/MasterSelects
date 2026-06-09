interface FlashBoardActionStackProps {
  canGenerate: boolean;
  chatButtonLabel: string;
  chatButtonTitle: string;
  chatPanelOpen: boolean;
  generateButtonLabel: string;
  generateButtonTitle: string;
  onChatButtonClick: () => void | Promise<void>;
  onGenerate: () => void;
}

export function FlashBoardActionStack({
  canGenerate,
  chatButtonLabel,
  chatButtonTitle,
  chatPanelOpen,
  generateButtonLabel,
  generateButtonTitle,
  onChatButtonClick,
  onGenerate,
}: FlashBoardActionStackProps) {
  return (
    <div className="fb-action-stack">
      {chatPanelOpen ? (
        <button
          className="fb-generate fb-chat-button active"
          onClick={onChatButtonClick}
          title={chatButtonTitle}
        >
          <svg
            className="fb-generate-icon"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M3.4 3.5h9.2a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H7.2L3.6 14v-2.5h-.2a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8Z" />
            <path d="M5 6.5h6M5 8.9h4" />
          </svg>
          <span>{chatButtonLabel}</span>
        </button>
      ) : (
        <button
          className="fb-generate"
          disabled={!canGenerate}
          onClick={onGenerate}
          title={generateButtonTitle}
        >
          <svg
            className="fb-generate-icon"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
            <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
          </svg>
          <span>{generateButtonLabel}</span>
        </button>
      )}
    </div>
  );
}
