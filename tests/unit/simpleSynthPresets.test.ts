import { describe, it, expect } from 'vitest';
import {
  SIMPLE_SYNTH_PRESETS,
  getSimpleSynthPreset,
} from '../../src/engine/audio/synth/simpleSynthPresets';
import { useTimelineStore } from '../../src/stores/timeline';
import type { TimelineTrack } from '../../src/types';

// Order-independent deep-equal (mirrors PresetSection.sameInstrument) — the store's
// merge orders keys differently from the preset literal.
function sameInstrument(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr || bArr) return aArr && bArr && a.length === b.length && a.every((v, i) => sameInstrument(v, b[i]));
  const ak = Object.keys(a as object), bk = Object.keys(b as object);
  return ak.length === bk.length && ak.every((k) => sameInstrument((a as any)[k], (b as any)[k]));
}

describe('SIMPLE_SYNTH_PRESETS', () => {
  it('ships the eight starter patches with unique ids', () => {
    expect(SIMPLE_SYNTH_PRESETS).toHaveLength(8);
    const ids = SIMPLE_SYNTH_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(8);
  });

  it('every preset is a complete, JSON-round-tripping simple-synth patch', () => {
    for (const preset of SIMPLE_SYNTH_PRESETS) {
      const inst = preset.instrument;
      expect(inst.kind).toBe('simple-synth');
      expect(inst.filter).toBeDefined();
      expect(inst.filterEnv).toBeDefined();
      expect(inst.pitchBendRange).toBeGreaterThan(0);
      expect(Array.isArray(inst.lfos)).toBe(true);
      expect(Array.isArray(inst.modMatrix)).toBe(true);
      // Durable serializable data: a save/load round-trip is lossless.
      expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
    }
  });

  it('every lfo-targeting mod route references an lfo that exists in the patch', () => {
    for (const preset of SIMPLE_SYNTH_PRESETS) {
      const ids = new Set((preset.instrument.lfos ?? []).map((l) => l.id));
      for (const route of preset.instrument.modMatrix ?? []) {
        if (route.destination.kind === 'lfoDepth' || route.destination.kind === 'lfoRate') {
          expect(ids.has(route.destination.lfoId)).toBe(true);
        }
      }
    }
  });

  it('looks up a preset by id', () => {
    expect(getSimpleSynthPreset('acid-bass')?.name).toBe('Acid Bass');
    expect(getSimpleSynthPreset('nope')).toBeUndefined();
  });

  it('loading a preset via setTrackMidiInstrument yields a preset-equal patch (dropdown shows its name)', () => {
    const track: TimelineTrack = {
      id: 'midi-1', name: 'MIDI 1', type: 'midi', height: 40,
      muted: false, visible: true, solo: false,
      midiInstrument: { kind: 'simple-synth', waveform: 'triangle', adsr: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 }, gain: 0.8 },
    };
    useTimelineStore.setState({ tracks: [track] });

    const preset = getSimpleSynthPreset('acid-bass')!;
    useTimelineStore.getState().setTrackMidiInstrument('midi-1', JSON.parse(JSON.stringify(preset.instrument)));

    const applied = useTimelineStore.getState().tracks[0].midiInstrument;
    expect(sameInstrument(applied, preset.instrument)).toBe(true);
  });
});
