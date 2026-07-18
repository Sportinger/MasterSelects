// MIDI track instrument controls (issue #182; subtractive synth UI #298).
//
// Surfaces which synth renders a MIDI track and lets the user tweak it. The Simple
// Synth is now edited through layout-agnostic section components (Oscillator/
// Filter/Envelope/Lfo/ModMatrix) — each takes (instrument, onChange) and knows
// nothing about where it is mounted, so a future dedicated synth editor can
// re-host the SAME components in a signal-flow layout with no rewrite (plan §3/§6C).

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrack } from '../../../types';
import {
  createDefaultMidiInstrument,
  MIDI_INSTRUMENT_OPTIONS,
  type MidiInstrument,
  type SimpleSynthInstrument,
  type MidiAdsr,
} from '../../../types/midiClip';
import { GM_PICKER_FAMILIES, GM_PROGRAM_NAMES, GM_PICKER_DRUM_KITS } from '../../../types/gmPrograms';
import { useLiveInstrumentParams } from './synthSections/useLiveInstrumentParams';
import { PresetSection } from './synthSections/PresetSection';
import { OscillatorSection } from './synthSections/OscillatorSection';
import { FilterSection } from './synthSections/FilterSection';
import { EnvelopeSection } from './synthSections/EnvelopeSection';
import { LfoSection } from './synthSections/LfoSection';
import { ModMatrixSection } from './synthSections/ModMatrixSection';

interface MidiInstrumentTabProps {
  track: TimelineTrack;
}

export function MidiInstrumentTab({ track }: MidiInstrumentTabProps) {
  const setTrackMidiInstrument = useTimelineStore(state => state.setTrackMidiInstrument);
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const instrument: MidiInstrument = track.midiInstrument ?? createDefaultMidiInstrument();

  // Drive the motorized-fader read-out: publishes each param's live automated
  // value to the bus while playing; the animated SynthSliders subscribe (plan §14).
  useLiveInstrumentParams(track.id, instrument, isPlaying);

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
        {instrument.kind === 'gm' && (
          <label className="audio-bus-control-row audio-bus-control-row-compact">
            <span>Percussion</span>
            <input
              type="checkbox"
              checked={instrument.isDrum ?? false}
              // Reset to program 0 so the landing value is always a valid program/kit.
              onChange={(event) => setTrackMidiInstrument(track.id, { isDrum: event.currentTarget.checked, program: 0 })}
            />
          </label>
        )}
        {instrument.kind === 'gm' && !instrument.isDrum && (
          <label className="audio-bus-control-row audio-bus-control-row-compact">
            <span>Program</span>
            <select
              value={instrument.program}
              onChange={(event) => setTrackMidiInstrument(track.id, { program: Number(event.currentTarget.value) })}
            >
              {GM_PICKER_FAMILIES.map(family => (
                <optgroup key={family.name} label={family.name}>
                  {family.programs.map(program => (
                    <option key={program} value={program}>{GM_PROGRAM_NAMES[program]}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {instrument.kind === 'gm' && instrument.isDrum && (
          <label className="audio-bus-control-row audio-bus-control-row-compact">
            <span>Drum Kit</span>
            <select
              value={instrument.program}
              onChange={(event) => setTrackMidiInstrument(track.id, { program: Number(event.currentTarget.value) })}
            >
              {GM_PICKER_DRUM_KITS.map(kit => (
                <option key={kit.program} value={kit.program}>{kit.name}</option>
              ))}
            </select>
          </label>
        )}
        {instrument.kind === 'gm' && (
          <label className="audio-bus-control-row">
            <span>Gain</span>
            <input
              type="range" min="0" max="1" step="0.01" value={instrument.gain}
              onChange={(event) => setTrackMidiInstrument(track.id, { gain: Number(event.currentTarget.value) })}
            />
            <input
              type="number" min="0" max="1" step="0.01" value={instrument.gain}
              onChange={(event) => setTrackMidiInstrument(track.id, { gain: Number(event.currentTarget.value) })}
            />
          </label>
        )}
      </div>

      {instrument.kind === 'simple-synth' && (
        <SimpleSynthSections
          instrument={instrument}
          onChange={(patch) => setTrackMidiInstrument(track.id, patch)}
        />
      )}
    </div>
  );
}

/** The Simple Synth's section stack. Split out so the tab body stays readable and
 *  the exact same set can be re-hosted by a future dedicated editor. */
function SimpleSynthSections({
  instrument,
  onChange,
}: {
  instrument: SimpleSynthInstrument;
  onChange: (patch: Partial<SimpleSynthInstrument>) => void;
}) {
  const ampAdsr = instrument.adsr;
  const filterEnv: MidiAdsr = instrument.filterEnv ?? { attack: 0.01, decay: 0.25, sustain: 0.5, release: 0.25 };
  return (
    <>
      <PresetSection instrument={instrument} onChange={onChange} />
      <div className="synth-section-row">
        <OscillatorSection instrument={instrument} onChange={onChange} />
        <EnvelopeSection title="Amp Envelope" adsr={ampAdsr} onChange={(adsr) => onChange({ adsr })} />
      </div>
      <div className="synth-section-row">
        <FilterSection instrument={instrument} onChange={onChange} />
        <EnvelopeSection title="Filter Envelope" adsr={filterEnv} onChange={(env) => onChange({ filterEnv: env })} />
      </div>
      <LfoSection instrument={instrument} onChange={onChange} />
      <ModMatrixSection instrument={instrument} onChange={onChange} />
    </>
  );
}
