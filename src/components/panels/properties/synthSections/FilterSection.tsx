// Resonant lowpass filter controls (#298): cutoff, resonance (Q), env amount, and
// key tracking. A toggle enables/disables the whole filter (absent `filter` =
// bypassed, the bare-oscillator path). envAmount may be negative (env closes the
// filter) per the schema, so its range is symmetric.

import { DEFAULT_SIMPLE_SYNTH_FILTER, type SynthFilter } from '../../../../types/midiClip';
import { SynthSlider } from './SynthSlider';
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
        <>
          <SynthSlider label="Cutoff" unit="Hz" step={1} value={filter.cutoff} min={20} max={18000}
            paramId="filter.cutoff" onChange={(cutoff) => set({ cutoff })} />
          <SynthSlider label="Resonance" unit="Q" value={filter.resonance} min={0.1} max={24}
            onChange={(resonance) => set({ resonance })} />
          <SynthSlider label="Env Amount" unit="Hz" step={10} value={filter.envAmount} min={-8000} max={8000}
            onChange={(envAmount) => set({ envAmount })} />
          <SynthSlider label="Key Track" value={filter.keytrack} min={0} max={1}
            onChange={(keytrack) => set({ keytrack })} />
        </>
      )}
    </div>
  );
}
