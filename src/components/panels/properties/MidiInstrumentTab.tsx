// MIDI track instrument controls (issue #182, Phase 4).
//
// Surfaces which synth/instrument renders a MIDI track and lets the user tweak it.
// Built around the `MidiInstrument` discriminator so future instruments (sampler,
// FM, …) slot in by extending INSTRUMENT_OPTIONS + the synth — no UI rework.

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack } from '../../../types';
import {
  createDefaultMidiInstrument,
  MIDI_INSTRUMENT_OPTIONS,
  MIDI_WAVEFORM_OPTIONS,
  type MidiInstrument,
} from '../../../types/midiClip';

interface MidiInstrumentTabProps {
  track: TimelineTrack;
}

export function MidiInstrumentTab({ track }: MidiInstrumentTabProps) {
  const setTrackMidiInstrument = useTimelineStore(state => state.setTrackMidiInstrument);
  const instrument: MidiInstrument = track.midiInstrument ?? createDefaultMidiInstrument();

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section">
        <h4>Instrument</h4>
        <label className="audio-bus-control-row audio-bus-control-row-compact">
          <span>Synth</span>
          <select
            value={instrument.kind}
            onChange={(event) => setTrackMidiInstrument(track.id, { kind: event.currentTarget.value as MidiInstrument['kind'] })}
          >
            {MIDI_INSTRUMENT_OPTIONS.map(option => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
        </label>
        {instrument.kind === 'simple-synth' && (
          <label className="audio-bus-control-row audio-bus-control-row-compact">
            <span>Waveform</span>
            <select
              value={instrument.waveform}
              onChange={(event) => setTrackMidiInstrument(track.id, { waveform: event.currentTarget.value as OscillatorType })}
            >
              {MIDI_WAVEFORM_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}
        <label className="audio-bus-control-row">
          <span>Gain</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={instrument.gain}
            onChange={(event) => setTrackMidiInstrument(track.id, { gain: Number(event.currentTarget.value) })}
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={instrument.gain}
            onChange={(event) => setTrackMidiInstrument(track.id, { gain: Number(event.currentTarget.value) })}
          />
        </label>
      </div>

      {instrument.kind === 'simple-synth' && (
        <div className="properties-section">
          <h4>Envelope (ADSR)</h4>
          {([
            { key: 'attack', label: 'Attack', max: 2 },
            { key: 'decay', label: 'Decay', max: 2 },
            { key: 'sustain', label: 'Sustain', max: 1 },
            { key: 'release', label: 'Release', max: 4 },
          ] as const).map(({ key, label, max }) => (
            <label className="audio-bus-control-row" key={key}>
              <span>{label}</span>
              <input
                type="range"
                min="0"
                max={max}
                step="0.01"
                value={instrument.adsr[key]}
                onChange={(event) => setTrackMidiInstrument(track.id, { adsr: { ...instrument.adsr, [key]: Number(event.currentTarget.value) } })}
              />
              <input
                type="number"
                min="0"
                max={max}
                step="0.01"
                value={instrument.adsr[key]}
                onChange={(event) => setTrackMidiInstrument(track.id, { adsr: { ...instrument.adsr, [key]: Number(event.currentTarget.value) } })}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
