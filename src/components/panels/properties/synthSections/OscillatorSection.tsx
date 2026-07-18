// Oscillator + global controls (#298): waveform, master gain, pitch-bend range.

import { MIDI_WAVEFORM_OPTIONS } from '../../../../types/midiClip';
import { SynthSlider } from './SynthSlider';
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
      <SynthSlider
        label="Gain" value={instrument.gain} min={0} max={1} scale="power" paramId="gain"
        onChange={(gain) => onChange({ gain })}
      />
      <SynthSlider
        label="Pitch Bend Range" unit="semitones" step={1}
        value={instrument.pitchBendRange ?? 2} min={0} max={24}
        onChange={(pitchBendRange) => onChange({ pitchBendRange })}
      />
    </div>
  );
}
