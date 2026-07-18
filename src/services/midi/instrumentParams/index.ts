// Instrument parameter model — registry + live-value evaluator (plan §14).
//
// The instrument-agnostic entry point: given an instrument, list its animatable
// parameter descriptors; given a descriptor + the clip's automation + a time,
// re-derive the live value the UI should display. Pure and DSP-independent so it
// works identically live and offline and survives the DSP swap (plan §3a).

import type { MidiClipAutomation, MidiInstrument } from '../../../types/midiClip';
import { sampleLaneAt } from '../midiAutomationWindow';
import type { InstrumentParamDescriptor } from './instrumentParamTypes';
import { simpleSynthParamDescriptors } from './simpleSynthParams';

export type { InstrumentParamDescriptor, AutomationLaneId } from './instrumentParamTypes';

/**
 * The animatable parameters of an instrument. Instance-dependent (e.g. one entry
 * per LFO), so it takes the instrument, not just its kind. Unknown/handle-free
 * kinds return an empty list — the UI simply shows no ghosts.
 */
export function getInstrumentParamModel(
  instrument: MidiInstrument | undefined | null,
): InstrumentParamDescriptor[] {
  if (!instrument) return [];
  switch (instrument.kind) {
    case 'simple-synth':
      return simpleSynthParamDescriptors(instrument);
    case 'gm':
      // The wavetable synth has no performed CC lanes yet, so nothing animates;
      // it participates in the model (gain) so future automation plugs in here.
      return [
        {
          id: 'gain',
          label: 'Gain',
          min: 0,
          max: 1,
          getBase: (inst) => (inst.kind === 'gm' ? inst.gain : undefined),
          combine: () => undefined,
        },
      ];
    default:
      return [];
  }
}

/**
 * The live value of one parameter at `time` (content-time seconds, same base as
 * the automation lanes). Returns `undefined` when the parameter has no active
 * automation at this time — the control then shows only its static base value.
 */
export function evaluateParamAt(
  descriptor: InstrumentParamDescriptor,
  instrument: MidiInstrument,
  automation: MidiClipAutomation | undefined,
  time: number,
): number | undefined {
  const base = descriptor.getBase(instrument);
  const laneValue = descriptor.lane ? sampleLaneAt(automation?.[descriptor.lane], time) : undefined;
  return descriptor.combine(base, laneValue);
}
