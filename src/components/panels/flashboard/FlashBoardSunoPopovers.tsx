type SunoPopover = 'sunoModel' | 'sunoMode' | 'sunoTuning';

interface SunoModelOption {
  id: string;
  label: string;
}

interface SunoVocalGenderOption {
  id: string;
  label: string;
}

interface FlashBoardSunoPopoversProps {
  activePopover: string | null;
  audioWeight: number;
  currentModelId: string;
  customMode: boolean;
  instrumental: boolean;
  isSunoMode: boolean;
  modelOptions: SunoModelOption[];
  styleWeight: number;
  vocalGender: string;
  vocalGenderOptions: SunoVocalGenderOption[];
  weirdnessConstraint: number;
  onAudioWeightChange: (value: number) => void;
  onClosePopover: (popover: SunoPopover) => void;
  onModeChange: (customMode: boolean, instrumental: boolean) => void;
  onModelChange: (modelId: string) => void;
  onResetTuning: () => void;
  onStyleWeightChange: (value: number) => void;
  onVocalGenderChange: (value: string) => void;
  onWeirdnessConstraintChange: (value: number) => void;
}

const SUNO_MODE_OPTIONS = [
  { label: 'Simple song', customMode: false, instrumental: false },
  { label: 'Simple inst.', customMode: false, instrumental: true },
  { label: 'Custom song', customMode: true, instrumental: false },
  { label: 'Custom inst.', customMode: true, instrumental: true },
];

export function FlashBoardSunoPopovers({
  activePopover,
  audioWeight,
  currentModelId,
  customMode,
  instrumental,
  isSunoMode,
  modelOptions,
  styleWeight,
  vocalGender,
  vocalGenderOptions,
  weirdnessConstraint,
  onAudioWeightChange,
  onClosePopover,
  onModeChange,
  onModelChange,
  onResetTuning,
  onStyleWeightChange,
  onVocalGenderChange,
  onWeirdnessConstraintChange,
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

      {activePopover === 'sunoTuning' && (
        <div className="fb-popover fb-popover-audio fb-popover-suno-tuning">
          <div className="fb-popover-title">Suno Tuning</div>
          <div className="fb-suno-tuning-panel">
            {[
              { key: 'style', label: 'Style weight', value: styleWeight, onChange: onStyleWeightChange },
              { key: 'weirdness', label: 'Weirdness', value: weirdnessConstraint, onChange: onWeirdnessConstraintChange },
              { key: 'audio', label: 'Audio weight', value: audioWeight, onChange: onAudioWeightChange },
            ].map((control) => (
              <label className="fb-suno-tuning-row" key={control.key}>
                <span>
                  <strong>{control.label}</strong>
                  <em>{control.value.toFixed(2)}</em>
                </span>
                <input
                  aria-label={control.label}
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={control.value}
                  onChange={(event) => control.onChange(Number(event.target.value))}
                />
              </label>
            ))}
            <div className="fb-suno-gender-row" aria-label="Singer gender">
              <button
                className={`fb-popover-pill ${vocalGender === '' ? 'active' : ''}`}
                type="button"
                onClick={() => onVocalGenderChange('')}
              >
                <span className="fb-popover-pill-label">Auto vocal</span>
              </button>
              {vocalGenderOptions.map((option) => (
                <button
                  key={option.id}
                  className={`fb-popover-pill ${vocalGender === option.id ? 'active' : ''}`}
                  type="button"
                  onClick={() => onVocalGenderChange(option.id)}
                >
                  <span className="fb-popover-pill-label">{option.label}</span>
                </button>
              ))}
            </div>
            <div className="fb-suno-tuning-actions">
              <button className="fb-popover-pill" type="button" onClick={onResetTuning}>
                <span className="fb-popover-pill-label">Reset</span>
              </button>
              <button className="fb-popover-pill active" type="button" onClick={() => onClosePopover('sunoTuning')}>
                <span className="fb-popover-pill-label">Done</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
