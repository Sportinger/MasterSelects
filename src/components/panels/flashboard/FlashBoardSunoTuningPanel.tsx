interface FlashBoardSunoTuningPanelProps {
  audioReferenceActive: boolean;
  audioWeight: number;
  styleWeight: number;
  weirdnessConstraint: number;
  onAudioWeightChange: (value: number) => void;
  onResetTuning: () => void;
  onStyleWeightChange: (value: number) => void;
  onWeirdnessConstraintChange: (value: number) => void;
}

export function FlashBoardSunoTuningPanel({
  audioReferenceActive,
  audioWeight,
  styleWeight,
  weirdnessConstraint,
  onAudioWeightChange,
  onResetTuning,
  onStyleWeightChange,
  onWeirdnessConstraintChange,
}: FlashBoardSunoTuningPanelProps) {
  const controls = [
    { key: 'style', label: 'Style weight', value: styleWeight, onChange: onStyleWeightChange },
    { key: 'weirdness', label: 'Weirdness', value: weirdnessConstraint, onChange: onWeirdnessConstraintChange },
    ...(audioReferenceActive
      ? [{ key: 'audio', label: 'Audio weight', value: audioWeight, onChange: onAudioWeightChange }]
      : []),
  ];

  return (
    <div className="fb-suno-tuning-panel fb-suno-inline-tuning">
      {controls.map((control) => (
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
      <div className="fb-suno-tuning-footer">
        <button className="fb-popover-pill fb-suno-reset-pill" type="button" onClick={onResetTuning}>
          <span className="fb-popover-pill-label">Reset</span>
        </button>
      </div>
    </div>
  );
}
