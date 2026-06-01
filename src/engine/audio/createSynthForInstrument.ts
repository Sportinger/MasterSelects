// Synth factory (issue #193) — the single place that maps a MIDI track's
// instrument to a concrete IMidiSynth. All three note producers route through it
// (live per-track bus + preview in midiPlaybackScheduler, offline export in
// MidiClipRenderer), so adding an instrument kind means adding a branch here and
// nowhere else. Pass the whole `instrument` (not just `kind`) so callers can build
// the synth that matches the track and follow live instrument edits.

import type { MidiInstrument } from '../../types/midiClip';
import type { IMidiSynth } from './IMidiSynth';
import { MidiSynth } from './MidiSynth';
import { WavetableSynth } from './WavetableSynth';

export function createSynthForInstrument(
  instrument: MidiInstrument,
  ctx: BaseAudioContext,
  destination: AudioNode,
): IMidiSynth {
  switch (instrument.kind) {
    case 'gm':
      return new WavetableSynth(ctx, destination);
    case 'simple-synth':
      return new MidiSynth(ctx, destination);
  }
}
