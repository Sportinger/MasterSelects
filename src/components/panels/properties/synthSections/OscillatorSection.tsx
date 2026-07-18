// Oscillator + global controls (#298): waveform, master gain, pitch-bend range.
// Gain and bend range are knobs (compact, consistent with the Filter section);
// Gain shows its live automated value during playback via the `gain` paramId.

import { MIDI_WAVEFORM_OPTIONS } from '../../../../types/midiClip';
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
          onChange={(e) => onChange({ waveform: e.currentTarget.value as OscillatorType })}
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
      </div>
    </div>
  );
}
