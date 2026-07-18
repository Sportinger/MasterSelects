// Reusable ADSR envelope editor (#298). Mounted twice — once for the amp envelope
// and once for the filter envelope — so both read identically (plan §3 names
// EnvelopeSection as the reused component). Not a SynthSectionProps section: it
// edits a bare MidiAdsr so it can drive either envelope.
//
// The ADSR are knobs (compact, consistent with Oscillator/Filter) sitting under
// the live envelope-shape graph. Time knobs (A/D/R) use the power taper so the
// short end has resolution and reaches 0; sustain is a linear 0..1 level.

import type { MidiAdsr } from '../../../../types/midiClip';
import { Knob } from '../../../common/Knob';
import { EnvelopeGraph } from './EnvelopeGraph';

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
      <EnvelopeGraph attack={adsr.attack} decay={adsr.decay} sustain={adsr.sustain} release={adsr.release} />
      <div className="synth-knob-row">
        <Knob label="Attack" unit="s" value={adsr.attack} min={0} max={timeMax} scale="power"
          onChange={(attack) => set({ attack })} />
        <Knob label="Decay" unit="s" value={adsr.decay} min={0} max={timeMax} scale="power"
          onChange={(decay) => set({ decay })} />
        <Knob label="Sustain" value={adsr.sustain} min={0} max={1}
          onChange={(sustain) => set({ sustain })} />
        <Knob label="Release" unit="s" value={adsr.release} min={0} max={timeMax} scale="power"
          onChange={(release) => set({ release })} />
      </div>
    </div>
  );
}
