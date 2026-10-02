import { describe, it, expect } from 'vitest'
import {
  durationToBeats,
  getMeasureDuration,
  noteCanFitInMeasure,
  midiToNoteName,
  noteNameToMidi,
  getNextAvailableBeat,
  calculateTotalDuration,
} from '../../src/services/score/musicUtils'
import type { TimeSignature, NoteDuration } from '../../src/types/scoreClip'

describe('musicUtils', () => {
  describe('durationToBeats', () => {
    it('should convert whole note to 4 beats', () => {
      expect(durationToBeats('w')).toBe(4)
    })

    it('should convert half note to 2 beats', () => {
      expect(durationToBeats('h')).toBe(2)
    })

    it('should convert quarter note to 1 beat', () => {
      expect(durationToBeats('q')).toBe(1)
    })

    it('should convert eighth note to 0.5 beats', () => {
      expect(durationToBeats('8')).toBe(0.5)
    })

    it('should convert sixteenth note to 0.25 beats', () => {
      expect(durationToBeats('16')).toBe(0.25)
    })

    it('should convert thirty-second note to 0.125 beats', () => {
      expect(durationToBeats('32')).toBe(0.125)
    })
  })

  describe('getMeasureDuration', () => {
    it('should calculate 4/4 time signature as 4 beats', () => {
      const ts: TimeSignature = { numerator: 4, denominator: 4 }
      expect(getMeasureDuration(ts)).toBe(4)
    })

    it('should calculate 3/4 time signature as 3 beats', () => {
      const ts: TimeSignature = { numerator: 3, denominator: 4 }
      expect(getMeasureDuration(ts)).toBe(3)
    })

    it('should calculate 6/8 time signature as 3 beats', () => {
      const ts: TimeSignature = { numerator: 6, denominator: 8 }
      expect(getMeasureDuration(ts)).toBe(3)
    })

    it('should calculate 2/2 time signature as 4 beats', () => {
      const ts: TimeSignature = { numerator: 2, denominator: 2 }
      expect(getMeasureDuration(ts)).toBe(4)
    })
  })

  describe('noteCanFitInMeasure', () => {
    const ts44: TimeSignature = { numerator: 4, denominator: 4 }

    it('should return true when note fits', () => {
      expect(noteCanFitInMeasure(0, 'q', ts44)).toBe(true)
      expect(noteCanFitInMeasure(3, 'q', ts44)).toBe(true)
    })

    it('should return false when note does not fit', () => {
      expect(noteCanFitInMeasure(3.5, 'q', ts44)).toBe(false)
      expect(noteCanFitInMeasure(3, 'h', ts44)).toBe(false)
    })

    it('should return true for exact fit', () => {
      expect(noteCanFitInMeasure(0, 'w', ts44)).toBe(true)
      expect(noteCanFitInMeasure(2, 'h', ts44)).toBe(true)
    })
  })

  describe('midiToNoteName', () => {
    it('should convert MIDI 60 to C4', () => {
      expect(midiToNoteName(60)).toBe('C4')
    })

    it('should convert MIDI 69 to A4', () => {
      expect(midiToNoteName(69)).toBe('A4')
    })

    it('should convert MIDI 21 to A0', () => {
      expect(midiToNoteName(21)).toBe('A0')
    })

    it('should convert MIDI 108 to C8', () => {
      expect(midiToNoteName(108)).toBe('C8')
    })

    it('should handle sharps correctly', () => {
      expect(midiToNoteName(61)).toBe('C#4')
      expect(midiToNoteName(66)).toBe('F#4')
    })
  })

  describe('noteNameToMidi', () => {
    it('should convert C4 to MIDI 60', () => {
      expect(noteNameToMidi('C4')).toBe(60)
    })

    it('should convert A4 to MIDI 69', () => {
      expect(noteNameToMidi('A4')).toBe(69)
    })

    it('should handle sharps', () => {
      expect(noteNameToMidi('C#4')).toBe(61)
      expect(noteNameToMidi('F#4')).toBe(66)
    })

    it('should handle flats', () => {
      expect(noteNameToMidi('Db4')).toBe(61)
      expect(noteNameToMidi('Bb3')).toBe(58)
    })

    it('should handle negative octaves', () => {
      expect(noteNameToMidi('C-1')).toBe(0)
    })

    it('should throw error for invalid note name', () => {
      expect(() => noteNameToMidi('Invalid')).toThrow()
      expect(() => noteNameToMidi('H4')).toThrow()
    })
  })

  describe('getNextAvailableBeat', () => {
    const ts44: TimeSignature = { numerator: 4, denominator: 4 }

    it('should return 0 for empty measure', () => {
      expect(getNextAvailableBeat([], 'q', ts44)).toBe(0)
    })

    it('should find space between notes', () => {
      const occupied = [
        { beat: 0, duration: 'q' as NoteDuration },
        { beat: 2, duration: 'q' as NoteDuration },
      ]
      expect(getNextAvailableBeat(occupied, 'q', ts44)).toBe(1)
    })

    it('should find space at the end', () => {
      const occupied = [
        { beat: 0, duration: 'h' as NoteDuration },
      ]
      expect(getNextAvailableBeat(occupied, 'q', ts44)).toBe(2)
    })

    it('should return -1 when measure is full', () => {
      const occupied = [
        { beat: 0, duration: 'w' as NoteDuration },
      ]
      expect(getNextAvailableBeat(occupied, 'q', ts44)).toBe(-1)
    })
  })

  describe('calculateTotalDuration', () => {
    it('should calculate total duration of notes', () => {
      const notes = [
        { duration: 'q' as NoteDuration },
        { duration: 'q' as NoteDuration },
        { duration: 'h' as NoteDuration },
      ]
      expect(calculateTotalDuration(notes)).toBe(4)
    })

    it('should return 0 for empty array', () => {
      expect(calculateTotalDuration([])).toBe(0)
    })
  })
})
