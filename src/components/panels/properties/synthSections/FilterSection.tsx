// Resonant lowpass filter controls (#298): cutoff, resonance (Q), env amount, and
// key tracking. A toggle enables/disables the whole filter (absent `filter` =
// bypassed, the bare-oscillator path). envAmount may be negative (env closes the
// filter) per the schema, so its range is symmetric.
//
// Rendered as a compact KNOB row — knobs read better here and save vertical space
// (the general common/Knob via SynthKnob, so the cutoff knob still shows its live
// automated value during playback). Cutoff uses a log taper; env amount is bipolar
// (centered at 0). Right-click a knob to reset to the patch default.

import { DEFAULT_SIMPLE_SYNTH_FILTER, type SynthFilter } from '../../../../types/midiClip';
import { SynthKnob } from './SynthKnob';
import type { SynthSectionProps } from './synthSectionTypes';

export function FilterSection({ instrument, onChange }: SynthSectionProps) {
  const filter = instrument.filter;
  const set = (patch: Partial<SynthFilter>) => {
    const base: SynthFilter = filter ?? { ...DEFAULT_SIMPLE_SYNTH_FILTER };
    onChange({ filter: { ...base, ...patch } });
  };

  return (
    <div className="properties-section">
      <h4>Filter</h4>
      <label className="audio-bus-control-row audio-bus-control-row-compact">
        <span>Lowpass</span>
        <input
          type="checkbox"
          checked={!!filter}
          onChange={(e) => onChange({ filter: e.currentTarget.checked ? { ...DEFAULT_SIMPLE_SYNTH_FILTER } : undefined })}
        />
      </label>
      {filter && (
        <div className="synth-knob-row">
          <SynthKnob label="Cutoff" unit="Hz" value={filter.cutoff} min={20} max={18000}
            scale="log" step={1} defaultValue={DEFAULT_SIMPLE_SYNTH_FILTER.cutoff}
            paramId="filter.cutoff" onChange={(cutoff) => set({ cutoff })} />
          <SynthKnob label="Res" unit="Q" value={filter.resonance} min={0.1} max={24}
            step={0.1} defaultValue={DEFAULT_SIMPLE_SYNTH_FILTER.resonance}
            onChange={(resonance) => set({ resonance })} />
          <SynthKnob label="Env Amt" unit="Hz" value={filter.envAmount} min={-8000} max={8000}
            step={10} defaultValue={DEFAULT_SIMPLE_SYNTH_FILTER.envAmount}
            onChange={(envAmount) => set({ envAmount })} />
          <SynthKnob label="Key Trk" value={filter.keytrack} min={0} max={1}
            step={0.01} defaultValue={DEFAULT_SIMPLE_SYNTH_FILTER.keytrack}
            onChange={(keytrack) => set({ keytrack })} />
        </div>
      )}
    </div>
  );
}
