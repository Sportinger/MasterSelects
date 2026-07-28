interface SunoModelOption {
  id: string;
  label: string;
}

interface FlashBoardSunoPopoversProps {
  activePopover: string | null;
  currentModelId: string;
  isSunoMode: boolean;
  modelOptions: SunoModelOption[];
  onClosePopover: (popover: 'sunoModel') => void;
  onModelChange: (modelId: string) => void;
}

export function FlashBoardSunoPopovers({
  activePopover,
  currentModelId,
  isSunoMode,
  modelOptions,
  onClosePopover,
  onModelChange,
}: FlashBoardSunoPopoversProps) {
  if (!isSunoMode) {
    return null;
  }

  return activePopover === 'sunoModel' ? (
    <div className="fb-popover fb-popover-audio">
      <div className="fb-popover-title">Suno Model</div>
      <div className="fb-popover-pills">
        {modelOptions.map((model) => (
          <button
            key={model.id}
            className={`fb-popover-pill ${currentModelId === model.id ? 'active' : ''}`}
            type="button"
            onClick={() => {
              onModelChange(model.id);
              onClosePopover('sunoModel');
            }}
          >
            <span className="fb-popover-pill-label">{model.label}</span>
          </button>
        ))}
      </div>
    </div>
  ) : null;
}
