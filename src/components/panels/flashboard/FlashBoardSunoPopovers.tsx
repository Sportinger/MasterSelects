type SunoPopover = 'sunoModel' | 'sunoMode';

interface SunoModelOption {
  id: string;
  label: string;
}

interface FlashBoardSunoPopoversProps {
  activePopover: string | null;
  currentModelId: string;
  customMode: boolean;
  instrumental: boolean;
  isSunoMode: boolean;
  modelOptions: SunoModelOption[];
  onClosePopover: (popover: SunoPopover) => void;
  onModeChange: (customMode: boolean, instrumental: boolean) => void;
  onModelChange: (modelId: string) => void;
}

const SUNO_MODE_OPTIONS = [
  { label: 'Simple song', customMode: false, instrumental: false },
  { label: 'Simple inst.', customMode: false, instrumental: true },
  { label: 'Custom song', customMode: true, instrumental: false },
  { label: 'Custom inst.', customMode: true, instrumental: true },
];

export function FlashBoardSunoPopovers({
  activePopover,
  currentModelId,
  customMode,
  instrumental,
  isSunoMode,
  modelOptions,
  onClosePopover,
  onModeChange,
  onModelChange,
}: FlashBoardSunoPopoversProps) {
  if (!isSunoMode) {
    return null;
  }

  return (
    <>
      {activePopover === 'sunoModel' && (
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
      )}

      {activePopover === 'sunoMode' && (
        <div className="fb-popover fb-popover-audio">
          <div className="fb-popover-title">Suno Mode</div>
          <div className="fb-popover-pills">
            {SUNO_MODE_OPTIONS.map((option) => (
              <button
                key={`${option.customMode}-${option.instrumental}`}
                className={`fb-popover-pill ${customMode === option.customMode && instrumental === option.instrumental ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  onModeChange(option.customMode, option.instrumental);
                  onClosePopover('sunoMode');
                }}
              >
                <span className="fb-popover-pill-label">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

    </>
  );
}
