// Oscillator + global controls (#298): waveform, master gain, pitch-bend range.
// Gain and bend range are knobs (compact, consistent with the Filter section);
// Gain shows its live automated value during playback via the `gain` paramId.

import { MIDI_WAVEFORM_OPTIONS, type SynthWaveform } from '../../../../types/midiClip';
import { SynthKnob } from './SynthKnob';
import type { SynthSectionProps } from './synthSectionTypes';

export function OscillatorSection({ instrument, onChange }: SynthSectionProps) {
  return (
    <div className="properties-section">
      <h4>Oscillator</h4>
      <label className="audio-bus-control-row audio-bus-control-row-compact">
        <span>Waveform</span>
        <select
          value={instrument.waveform}
          onChange={(e) => onChange({ waveform: e.currentTarget.value as SynthWaveform })}
        >
          {MIDI_WAVEFORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <div className="synth-knob-row">
        <SynthKnob
          label="Gain" value={instrument.gain} min={0} max={1} scale="power"
          step={0.01} defaultValue={0.8} paramId="gain"
          onChange={(gain) => onChange({ gain })}
        />
        <SynthKnob
          label="Bend Rng" unit="st" value={instrument.pitchBendRange ?? 2} min={0} max={24}
          step={1} defaultValue={2}
          onChange={(pitchBendRange) => onChange({ pitchBendRange })}
        />
        <SynthKnob
          label="Pitch Env" unit="st" value={instrument.pitchEnv?.amount ?? 0} min={-48} max={48}
          step={0.1} defaultValue={0}
          onChange={(amount) => onChange({ pitchEnv: { decay: instrument.pitchEnv?.decay ?? 0.1, amount } })}
        />
        <SynthKnob
          label="Pitch Dec" unit="s" value={instrument.pitchEnv?.decay ?? 0.1} min={0.001} max={4} scale="power"
          step={0.001} defaultValue={0.1}
          onChange={(decay) => onChange({ pitchEnv: { amount: instrument.pitchEnv?.amount ?? 0, decay } })}
        />
      </div>
    </div>
  );
}
