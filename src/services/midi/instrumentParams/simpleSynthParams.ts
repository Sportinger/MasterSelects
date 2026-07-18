// Simple Synth parameter descriptors (plan §14).
//
// Maps the synth's panel controls to the performed CC lanes that ride on them, so
// the motorized-fader ghost shows the live value. The combine rules mirror the
// disposable DSP's bake exactly by reusing its mapping constants
// (CUTOFF_CC_RANGE_HZ, MOD_WHEEL_VIBRATO_CENTS) and clamps from synthVoiceMath —
// one source of truth means the ghost matches what is rendered.
//
// Tier 1 only (plan §14.2): the four clip-automation lanes. Per-voice modulation
// (filter env, LFO shape, velocity) is Tier 2 and needs a DSP meter tap — not here.

import type { MidiInstrument, SimpleSynthInstrument } from '../../../types/midiClip';
import {
  clampFilterHz,
  CUTOFF_CC_RANGE_HZ,
  MAX_FILTER_HZ,
  MIN_FILTER_HZ,
  MOD_WHEEL_VIBRATO_CENTS,
} from '../../../engine/audio/synth/synthVoiceMath';
import type { InstrumentParamDescriptor } from './instrumentParamTypes';

function asSimpleSynth(instrument: MidiInstrument): SimpleSynthInstrument | undefined {
  return instrument.kind === 'simple-synth' ? instrument : undefined;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Descriptors for a Simple Synth patch. Instance-dependent: one depth descriptor
 * is emitted per pitch-target LFO (the mod wheel adds vibrato to each pitch LFO in
 * the DSP), so the list reflects the actual LFOs on the patch.
 */
export function simpleSynthParamDescriptors(
  instrument: SimpleSynthInstrument,
): InstrumentParamDescriptor[] {
  const descriptors: InstrumentParamDescriptor[] = [];

  // Filter cutoff ← cutoff lane (CC74). Additive Hz on the base cutoff, clamped to
  // the filter's safe band — exactly the DSP's cutoff carrier.
  if (instrument.filter) {
    descriptors.push({
      id: 'filter.cutoff',
      label: 'Cutoff',
      min: MIN_FILTER_HZ,
      max: MAX_FILTER_HZ,
      unit: 'Hz',
      lane: 'cutoff',
      getBase: (inst) => asSimpleSynth(inst)?.filter?.cutoff,
      combine: (base, laneValue) => {
        if (base === undefined || laneValue === undefined) return undefined;
        return clampFilterHz(base + clamp01(laneValue) * CUTOFF_CC_RANGE_HZ);
      },
    });
  }

  // Amp gain ← expression lane (CC11). Expression rides the amp level 0..1; the
  // read-out shows the momentary output = base gain × expression.
  descriptors.push({
    id: 'gain',
    label: 'Gain',
    min: 0,
    max: 1,
    lane: 'expression',
    getBase: (inst) => asSimpleSynth(inst)?.gain,
    combine: (base, laneValue) => {
      if (laneValue === undefined) return undefined;
      return clamp01(base ?? 1) * clamp01(laneValue);
    },
  });

  // Pitch-LFO depth ← mod wheel (CC1). The mod curve adds up to MOD_WHEEL_VIBRATO_
  // CENTS on top of each pitch LFO's base depth (cents).
  for (const lfo of instrument.lfos ?? []) {
    if (lfo.target !== 'pitch') continue;
    const lfoId = lfo.id;
    descriptors.push({
      id: `lfo.${lfoId}.depth`,
      label: 'LFO Depth',
      min: 0,
      max: 100,
      unit: 'cents',
      lane: 'mod',
      getBase: (inst) => asSimpleSynth(inst)?.lfos?.find((l) => l.id === lfoId)?.depth,
      combine: (base, laneValue) => {
        if (base === undefined || laneValue === undefined) return undefined;
        return base + clamp01(laneValue) * MOD_WHEEL_VIBRATO_CENTS;
      },
    });
  }

  // NOTE: the pitch-bend lane has no natural panel slider (it modulates note pitch,
  // not a knob), so it is intentionally not a descriptor here — Tier-1 read-out is
  // for panel controls. A dedicated bend read-out is a later add (plan §14.3).

  return descriptors;
}
