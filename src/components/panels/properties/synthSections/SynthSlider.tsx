// Labeled range + number control shared by the synth panel sections (#298).
//
// A tiny presentational control so every section reads the same and the range/
// number pair (with clamping) is written once. Layout-agnostic: it renders one
// `.audio-bus-control-row`, matching the rest of the properties panel.

interface SynthSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional unit shown after the label (e.g. "Hz", "s", "cents"). */
  unit?: string;
  onChange: (value: number) => void;
}

export function SynthSlider({ label, value, min, max, step = 0.01, unit, onChange }: SynthSliderProps) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  return (
    <label className="audio-bus-control-row">
      <span>{unit ? `${label} (${unit})` : label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.currentTarget.value)))}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(clamp(Number(e.currentTarget.value)))}
      />
    </label>
  );
}
