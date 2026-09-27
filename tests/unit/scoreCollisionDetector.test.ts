import { describe, it, expect, beforeEach } from 'vitest'
import { CollisionDetector } from '../../src/services/score/CollisionDetector'
import type { Note, NoteParams, Measure } from '../../src/types/scoreClip'
import { fracCreate as frac } from '../../src/services/score/fraction'

// Helpers for common note pitches used throughout
const C4: Pick<NoteParams, 'step' | 'alter' | 'octave'> = { step: 'C', alter: 0, octave: 4 }
const E4: Pick<NoteParams, 'step' | 'alter' | 'octave'> = { step: 'E', alter: 0, octave: 4 }
const G4: Pick<NoteParams, 'step' | 'alter' | 'octave'> = { step: 'G', alter: 0, octave: 4 }

describe('CollisionDetector', () => {
  let detector: CollisionDetector
  let measure: Measure

  beforeEach(() => {
    detector = new CollisionDetector()
    measure = {
      id: '1',
      number: 1,
      slots: [],
      timeSignature: { numerator: 4, denominator: 4 },
      tuplets: [],
    }
  })

  describe('checkNoteCollision', () => {
    it('should not detect collision with empty notes list', () => {
      const newNote: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const result = detector.checkNoteCollision(newNote, [])
      expect(result.hasCollision).toBe(false)
    })

    it('should detect collision with same pitch and overlapping time', () => {
      const existingNote: Note = {
        id: '1',
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const newNote: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(1, 2), // Overlaps with existing note
      }

      const result = detector.checkNoteCollision(newNote, [existingNote])
      expect(result.hasCollision).toBe(true)
      expect(result.collidingNotes).toContain('1')
    })

    it('should not detect collision with different pitch', () => {
      const existingNote: Note = {
        id: '1',
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const newNote: NoteParams = {
        ...E4, // Different pitch
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const result = detector.checkNoteCollision(newNote, [existingNote])
      expect(result.hasCollision).toBe(false)
    })

    it('should not detect collision with non-overlapping time', () => {
      const existingNote: Note = {
        id: '1',
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const newNote: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(1, 1), // Starts after existing note ends
      }

      const result = detector.checkNoteCollision(newNote, [existingNote])
      expect(result.hasCollision).toBe(false)
    })

    it('should detect collision when new note encompasses existing note', () => {
      const existingNote: Note = {
        id: '1',
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(1, 1),
      }

      const newNote: NoteParams = {
        ...C4,
        duration: 'w', // Whole note encompasses the quarter note
        measure: 1,
        beat: frac(0, 1),
      }

      const result = detector.checkNoteCollision(newNote, [existingNote])
      expect(result.hasCollision).toBe(true)
    })

    it('should not detect collision in different measures', () => {
      const existingNote: Note = {
        id: '1',
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const newNote: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 2, // Different measure
        beat: frac(0, 1),
      }

      const result = detector.checkNoteCollision(newNote, [existingNote])
      expect(result.hasCollision).toBe(false)
    })
  })

  describe('checkMeasureOverflow', () => {
    it('should not detect overflow for note that fits', () => {
      const note: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(0, 1),
      }

      const result = detector.checkMeasureOverflow(note, measure, [])
      expect(result.willOverflow).toBe(false)
    })

    it('should detect overflow for note extending beyond measure', () => {
      const note: NoteParams = {
        ...C4,
        duration: 'w',
        measure: 1,
        beat: frac(2, 1), // Whole note starting at beat 2 will overflow
      }

      const result = detector.checkMeasureOverflow(note, measure, [])
      expect(result.willOverflow).toBe(true)
      expect(result.overflowAmount).toBe(2) // 4 beats - 2 beats available
      expect(result.suggestedMeasure).toBe(2)
    })

    it('should allow note at exact end of measure', () => {
      const note: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(3, 1), // Quarter note at beat 3 ends exactly at 4
      }

      const result = detector.checkMeasureOverflow(note, measure, [])
      expect(result.willOverflow).toBe(false)
    })
  })

  describe('findNextAvailablePosition', () => {
    it('should return 0 for empty measure', () => {
      const position = detector.findNextAvailablePosition('q', measure, [])
      expect(position).toBe(0)
    })

    it('should return position after existing note', () => {
      const existingNotes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
      ]

      const position = detector.findNextAvailablePosition('q', measure, existingNotes)
      expect(position).toBe(1)
    })

    it('should find gap between notes', () => {
      const existingNotes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
        {
          id: '2',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(2, 1),
        },
      ]

      const position = detector.findNextAvailablePosition('q', measure, existingNotes)
      expect(position).toBe(1)
    })

    it('should return null when measure is full', () => {
      const existingNotes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'w',
          measure: 1,
          beat: frac(0, 1),
        },
      ]

      const position = detector.findNextAvailablePosition('q', measure, existingNotes)
      expect(position).toBeNull()
    })

    it('should respect startFromBeat parameter', () => {
      const position = detector.findNextAvailablePosition('q', measure, [], 2)
      expect(position).toBe(2)
    })
  })

  describe('getAffectedNotes', () => {
    it('should return empty array for non-overlapping note', () => {
      const existingNotes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
      ]

      const newNote: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(2, 1),
      }

      const affected = detector.getAffectedNotes(newNote, existingNotes)
      expect(affected).toHaveLength(0)
    })

    it('should return affected notes for overlapping position', () => {
      const existingNotes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
        {
          id: '2',
          ...E4,
          duration: 'q',
          measure: 1,
          beat: frac(1, 2),
        },
      ]

      const newNote: NoteParams = {
        ...G4,
        duration: 'h',
        measure: 1,
        beat: frac(0, 1),
      }

      const affected = detector.getAffectedNotes(newNote, existingNotes)
      expect(affected).toHaveLength(2)
    })
  })

  describe('getMeasureUsage', () => {
    it('should return zero usage for empty measure', () => {
      const usage = detector.getMeasureUsage(measure, [])
      expect(usage.used).toBe(0)
      expect(usage.available).toBe(4)
      expect(usage.percentage).toBe(0)
    })

    it('should calculate usage correctly', () => {
      const notes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'h',
          measure: 1,
          beat: frac(0, 1),
        },
      ]

      const usage = detector.getMeasureUsage(measure, notes)
      expect(usage.used).toBe(2)
      expect(usage.available).toBe(2)
      expect(usage.percentage).toBe(50)
    })

    it('should use maximum end position', () => {
      const notes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
        {
          id: '2',
          ...E4,
          duration: 'q',
          measure: 1,
          beat: frac(3, 1),
        },
      ]

      const usage = detector.getMeasureUsage(measure, notes)
      expect(usage.used).toBe(4) // Second note ends at beat 4
    })
  })

  describe('validateMeasure', () => {
    it('should validate empty measure', () => {
      const result = detector.validateMeasure(measure, [])
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate measure with valid notes', () => {
      const notes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(0, 1),
        },
      ]

      const result = detector.validateMeasure(measure, notes)
      expect(result.isValid).toBe(true)
    })

    it('should detect overflow error', () => {
      const notes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'w',
          measure: 1,
          beat: frac(2, 1),
        },
      ]

      const result = detector.validateMeasure(measure, notes)
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should detect negative beat position', () => {
      const notes: Note[] = [
        {
          id: '1',
          ...C4,
          duration: 'q',
          measure: 1,
          beat: frac(-1, 1),
        },
      ]

      const result = detector.validateMeasure(measure, notes)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.includes('negative'))).toBe(true)
    })
  })

  describe('quantizeNote', () => {
    it('should quantize note to nearest subdivision', () => {
      const note: NoteParams = {
        ...C4,
        duration: 'q',
        measure: 1,
        beat: frac(3, 5),
      }

      const quantized = detector.quantizeNote(note, measure.timeSignature, 4)
      expect(quantized.beat).toEqual(frac(1, 1)) // Snapped to 1 (0.6 rounds to 1)
    })

    it('should clamp to measure boundaries', () => {
      const note: NoteParams = {
        ...C4,
        duration: 'h',
        measure: 1,
        beat: frac(7, 2),
      }

      const quantized = detector.quantizeNote(note, measure.timeSignature, 4)
      expect(quantized.beat.num / quantized.beat.den).toBeLessThanOrEqual(2) // Can't start past beat 2 with half note
    })
  })
})
