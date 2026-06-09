type ParameterPopoverType = 'aspect' | 'duration' | 'imageSize' | 'mode';

interface ParameterPopoverOption {
  id: string;
  label: string;
  active: boolean;
  meta?: string;
}

interface DurationPopoverOption extends ParameterPopoverOption {
  value: number;
}

interface FlashBoardParameterPopoversProps {
  activePopover: string | null;
  aspectOptions: ParameterPopoverOption[];
  durationOptions: DurationPopoverOption[];
  imageSizeOptions: ParameterPopoverOption[];
  modeOptions: ParameterPopoverOption[];
  onAspectRatioChange: (value: string) => void;
  onClosePopover: (popover: ParameterPopoverType) => void;
  onDurationChange: (value: number) => void;
  onImageSizeChange: (value: string) => void;
  onModeChange: (value: string) => void;
}

function renderPopoverOption(
  option: ParameterPopoverOption,
  onClick: () => void,
) {
  return (
    <button
      key={option.id}
      className={`fb-popover-pill ${option.active ? 'active' : ''}`}
      type="button"
      onClick={onClick}
    >
      <span className="fb-popover-pill-label">{option.label}</span>
      {option.meta && <span className="fb-popover-pill-meta">{option.meta}</span>}
    </button>
  );
}

export function FlashBoardParameterPopovers({
  activePopover,
  aspectOptions,
  durationOptions,
  imageSizeOptions,
  modeOptions,
  onAspectRatioChange,
  onClosePopover,
  onDurationChange,
  onImageSizeChange,
  onModeChange,
}: FlashBoardParameterPopoversProps) {
  return (
    <>
      {activePopover === 'aspect' && aspectOptions.length > 0 && (
        <div className="fb-popover">
          <div className="fb-popover-title">Aspect Ratio</div>
          <div className="fb-popover-pills">
            {aspectOptions.map((option) => renderPopoverOption(option, () => {
              onAspectRatioChange(option.id);
              onClosePopover('aspect');
            }))}
          </div>
        </div>
      )}

      {activePopover === 'duration' && durationOptions.length > 0 && (
        <div className="fb-popover">
          <div className="fb-popover-title">Duration</div>
          <div className="fb-popover-pills">
            {durationOptions.map((option) => renderPopoverOption(option, () => {
              onDurationChange(option.value);
              onClosePopover('duration');
            }))}
          </div>
        </div>
      )}

      {activePopover === 'imageSize' && imageSizeOptions.length > 0 && (
        <div className="fb-popover">
          <div className="fb-popover-title">Image Size</div>
          <div className="fb-popover-pills">
            {imageSizeOptions.map((option) => renderPopoverOption(option, () => {
              onImageSizeChange(option.id);
              onClosePopover('imageSize');
            }))}
          </div>
        </div>
      )}

      {activePopover === 'mode' && modeOptions.length > 0 && (
        <div className="fb-popover">
          <div className="fb-popover-title">Mode</div>
          <div className="fb-popover-pills">
            {modeOptions.map((option) => renderPopoverOption(option, () => {
              onModeChange(option.id);
              onClosePopover('mode');
            }))}
          </div>
        </div>
      )}
    </>
  );
}
