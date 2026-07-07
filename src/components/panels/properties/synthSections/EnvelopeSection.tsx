// Reusable ADSR envelope editor (#298). Mounted twice — once for the amp envelope
// and once for the filter envelope — so both read identically (plan §3 names
// EnvelopeSection as the reused component). Not a SynthSectionProps section: it
// edits a bare MidiAdsr so it can drive either envelope.

import type { MidiAdsr } from '../../../../types/midiClip';
import { SynthSlider } from './SynthSlider';

interface EnvelopeSectionProps {
  title: string;
  adsr: MidiAdsr;
  onChange: (adsr: MidiAdsr) => void;
  /** Attack/decay/release upper bounds (seconds); sustain is always 0–1. */
  timeMax?: number;
}

export function EnvelopeSection({ title, adsr, onChange, timeMax = 4 }: EnvelopeSectionProps) {
  const set = (patch: Partial<MidiAdsr>) => onChange({ ...adsr, ...patch });
  return (
    <div className="properties-section">
      <h4>{title}</h4>
      <SynthSlider label="Attack" unit="s" value={adsr.attack} min={0} max={timeMax}
        onChange={(attack) => set({ attack })} />
      <SynthSlider label="Decay" unit="s" value={adsr.decay} min={0} max={timeMax}
        onChange={(decay) => set({ decay })} />
      <SynthSlider label="Sustain" value={adsr.sustain} min={0} max={1}
        onChange={(sustain) => set({ sustain })} />
      <SynthSlider label="Release" unit="s" value={adsr.release} min={0} max={timeMax}
        onChange={(release) => set({ release })} />
    </div>
  );
}
