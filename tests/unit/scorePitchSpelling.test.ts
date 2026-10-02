import { describe, it, expect } from 'vitest'
import {
  spellingToMidi,
  spellingToVexflowKey,
  spellingDiatonicPos,
  alterToAccidental,
  midiToSpelling,
  spellingEquals,
  spellingEnharmonic,
} from '../../src/services/score/pitchSpelling'

describe('pitchSpelling', () => {

  // -------------------------------------------------------------------------
  describe('spellingToMidi', () => {
    it('converts middle C (C4) to MIDI 60', () => {
      expect(spellingToMidi('C', 0, 4)).toBe(60)
    })

    it('converts concert A (A4) to MIDI 69', () => {
      expect(spellingToMidi('A', 0, 4)).toBe(69)
    })

    it('converts C#4 to MIDI 61', () => {
      expect(spellingToMidi('C', 1, 4)).toBe(61)
    })

    it('converts Db4 to MIDI 61 (same as C#4)', () => {
      expect(spellingToMidi('D', -1, 4)).toBe(61)
    })

    it('converts B3 to MIDI 59', () => {
      expect(spellingToMidi('B', 0, 3)).toBe(59)
    })

    it('converts C5 to MIDI 72', () => {
      expect(spellingToMidi('C', 0, 5)).toBe(72)
    })

    it('converts Bb4 to MIDI 70', () => {
      expect(spellingToMidi('B', -1, 4)).toBe(70)
    })

    it('converts A#4 to MIDI 70 (same as Bb4)', () => {
      expect(spellingToMidi('A', 1, 4)).toBe(70)
    })

    it('converts G##4 (double-sharp) to MIDI 69', () => {
      expect(spellingToMidi('G', 2, 4)).toBe(69)
    })

    it('converts Abb4 (double-flat) to MIDI 67', () => {
      expect(spellingToMidi('A', -2, 4)).toBe(67)
    })

    it('converts C0 to MIDI 12', () => {
      expect(spellingToMidi('C', 0, 0)).toBe(12)
    })

    it('converts all natural notes in octave 4 correctly', () => {
      expect(spellingToMidi('C', 0, 4)).toBe(60)
      expect(spellingToMidi('D', 0, 4)).toBe(62)
      expect(spellingToMidi('E', 0, 4)).toBe(64)
      expect(spellingToMidi('F', 0, 4)).toBe(65)
      expect(spellingToMidi('G', 0, 4)).toBe(67)
      expect(spellingToMidi('A', 0, 4)).toBe(69)
      expect(spellingToMidi('B', 0, 4)).toBe(71)
    })
  })

  // -------------------------------------------------------------------------
  describe('spellingToVexflowKey', () => {
    it('converts C4 to "c/4"', () => {
      expect(spellingToVexflowKey('C', 0, 4)).toBe('c/4')
    })

    it('converts C#4 to "c#/4"', () => {
      expect(spellingToVexflowKey('C', 1, 4)).toBe('c#/4')
    })

    it('converts Db4 to "db/4"', () => {
      expect(spellingToVexflowKey('D', -1, 4)).toBe('db/4')
    })

    it('converts G##3 to "g##/3"', () => {
      expect(spellingToVexflowKey('G', 2, 3)).toBe('g##/3')
    })

    it('converts Abb5 to "abb/5"', () => {
      expect(spellingToVexflowKey('A', -2, 5)).toBe('abb/5')
    })

    it('converts B3 to "b/3"', () => {
      expect(spellingToVexflowKey('B', 0, 3)).toBe('b/3')
    })

    it('uses lowercase step letter', () => {
      const result = spellingToVexflowKey('F', 1, 4)
      expect(result[0]).toBe('f')
    })
  })

  // -------------------------------------------------------------------------
  describe('spellingDiatonicPos', () => {
    it('C4=28, D4=29, E4=30, F4=31, G4=32, A4=33, B4=34', () => {
      expect(spellingDiatonicPos('C', 4)).toBe(28)
      expect(spellingDiatonicPos('D', 4)).toBe(29)
      expect(spellingDiatonicPos('E', 4)).toBe(30)
      expect(spellingDiatonicPos('F', 4)).toBe(31)
      expect(spellingDiatonicPos('G', 4)).toBe(32)
      expect(spellingDiatonicPos('A', 4)).toBe(33)
      expect(spellingDiatonicPos('B', 4)).toBe(34)
    })

    it('C5=35 is one step above B4=34', () => {
      expect(spellingDiatonicPos('C', 5)).toBe(35)
      expect(spellingDiatonicPos('C', 5) - spellingDiatonicPos('B', 4)).toBe(1)
    })

    it('C# and C natural have the same diatonic position (accidentals do not shift staff lines)', () => {
      expect(spellingDiatonicPos('C', 4)).toBe(spellingDiatonicPos('C', 4))
      // C# is still on the C line/space — alter does not affect diatonic pos
    })

    it('octave change shifts position by 7', () => {
      expect(spellingDiatonicPos('A', 5) - spellingDiatonicPos('A', 4)).toBe(7)
    })

    it('treble clef middle line B4 = 34', () => {
      expect(spellingDiatonicPos('B', 4)).toBe(34)
    })
  })

  // -------------------------------------------------------------------------
  describe('alterToAccidental', () => {
    it('returns "#" for alter 1 (sharp)', () => {
      expect(alterToAccidental(1)).toBe('#')
    })

    it('returns "#" for alter 2 (double-sharp, falls back to #)', () => {
      expect(alterToAccidental(2)).toBe('#')
    })

    it('returns "b" for alter -1 (flat)', () => {
      expect(alterToAccidental(-1)).toBe('b')
    })

    it('returns "b" for alter -2 (double-flat, falls back to b)', () => {
      expect(alterToAccidental(-2)).toBe('b')
    })

    it('returns undefined for alter 0 (natural — no sign needed)', () => {
      expect(alterToAccidental(0)).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  describe('midiToSpelling', () => {
    it('converts middle C (MIDI 60) to C4', () => {
      expect(midiToSpelling(60)).toEqual({ step: 'C', alter: 0, octave: 4 })
    })

    it('converts concert A (MIDI 69) to A4', () => {
      expect(midiToSpelling(69)).toEqual({ step: 'A', alter: 0, octave: 4 })
    })

    it('converts MIDI 59 to B3', () => {
      expect(midiToSpelling(59)).toEqual({ step: 'B', alter: 0, octave: 3 })
    })

    it('converts MIDI 72 to C5', () => {
      expect(midiToSpelling(72)).toEqual({ step: 'C', alter: 0, octave: 5 })
    })

    // Black key — default (no hint) → sharp
    it('converts MIDI 61 with no hint to C#4', () => {
      expect(midiToSpelling(61)).toEqual({ step: 'C', alter: 1, octave: 4 })
    })

    it('converts MIDI 61 with hint "#" to C#4', () => {
      expect(midiToSpelling(61, '#')).toEqual({ step: 'C', alter: 1, octave: 4 })
    })

    it('converts MIDI 61 with hint "b" to Db4', () => {
      expect(midiToSpelling(61, 'b')).toEqual({ step: 'D', alter: -1, octave: 4 })
    })

    it('converts MIDI 70 with no hint to A#4', () => {
      expect(midiToSpelling(70)).toEqual({ step: 'A', alter: 1, octave: 4 })
    })

    it('converts MIDI 70 with hint "b" to Bb4', () => {
      expect(midiToSpelling(70, 'b')).toEqual({ step: 'B', alter: -1, octave: 4 })
    })

    it('hint "n" on white key has no effect (still natural)', () => {
      expect(midiToSpelling(60, 'n')).toEqual({ step: 'C', alter: 0, octave: 4 })
    })

    it('hint "n" on black key defaults to sharp (n means no alter on the key)', () => {
      expect(midiToSpelling(61, 'n')).toEqual({ step: 'C', alter: 1, octave: 4 })
    })

    it('round-trips with spellingToMidi for all white keys in octave 4', () => {
      const whiteMidis = [60, 62, 64, 65, 67, 69, 71]
      for (const midi of whiteMidis) {
        const s = midiToSpelling(midi)
        expect(spellingToMidi(s.step, s.alter, s.octave)).toBe(midi)
      }
    })

    it('round-trips with spellingToMidi for sharp black keys in octave 4', () => {
      const blackMidis = [61, 63, 66, 68, 70]
      for (const midi of blackMidis) {
        const s = midiToSpelling(midi, '#')
        expect(spellingToMidi(s.step, s.alter, s.octave)).toBe(midi)
      }
    })

    it('round-trips with spellingToMidi for flat black keys in octave 4', () => {
      const blackMidis = [61, 63, 66, 68, 70]
      for (const midi of blackMidis) {
        const s = midiToSpelling(midi, 'b')
        expect(spellingToMidi(s.step, s.alter, s.octave)).toBe(midi)
      }
    })
  })

  // -------------------------------------------------------------------------
  describe('spellingEquals', () => {
    it('returns true for identical spellings', () => {
      expect(spellingEquals(
        { step: 'C', alter: 1, octave: 4 },
        { step: 'C', alter: 1, octave: 4 }
      )).toBe(true)
    })

    it('returns false for enharmonic equivalents (C# ≠ Db)', () => {
      expect(spellingEquals(
        { step: 'C', alter: 1, octave: 4 },
        { step: 'D', alter: -1, octave: 4 }
      )).toBe(false)
    })

    it('returns false for same step/alter in different octaves', () => {
      expect(spellingEquals(
        { step: 'A', alter: 0, octave: 4 },
        { step: 'A', alter: 0, octave: 5 }
      )).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  describe('spellingEnharmonic', () => {
    it('C#4 and Db4 are enharmonic', () => {
      expect(spellingEnharmonic(
        { step: 'C', alter: 1, octave: 4 },
        { step: 'D', alter: -1, octave: 4 }
      )).toBe(true)
    })

    it('A#4 and Bb4 are enharmonic', () => {
      expect(spellingEnharmonic(
        { step: 'A', alter: 1, octave: 4 },
        { step: 'B', alter: -1, octave: 4 }
      )).toBe(true)
    })

    it('C4 and C5 are not enharmonic', () => {
      expect(spellingEnharmonic(
        { step: 'C', alter: 0, octave: 4 },
        { step: 'C', alter: 0, octave: 5 }
      )).toBe(false)
    })

    it('C#4 and D4 are not enharmonic', () => {
      expect(spellingEnharmonic(
        { step: 'C', alter: 1, octave: 4 },
        { step: 'D', alter: 0, octave: 4 }
      )).toBe(false)
    })

    it('G##4 and A4 are enharmonic (double-sharp)', () => {
      expect(spellingEnharmonic(
        { step: 'G', alter: 2, octave: 4 },
        { step: 'A', alter: 0, octave: 4 }
      )).toBe(true)
    })
  })

})
