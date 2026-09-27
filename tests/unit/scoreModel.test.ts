import { describe, it, expect, beforeEach } from 'vitest'
import { ScoreModel } from '../../src/services/score/ScoreModel'
import { createTuplet, getNotesInTuplet, refillTupletRemainder, deleteTuplet, getTupletAtBeat, getTuplet } from '../../src/services/score/tupletOps'
import type { NoteParams } from '../../src/types/scoreClip'
import { fracCreate as frac, fracCompare } from '../../src/services/score/fraction'

describe('ScoreModel', () => {
  let model: ScoreModel

  beforeEach(() => {
    model = new ScoreModel('Test Score', 120)
  })

  describe('initialization', () => {
    it('should create a score with default values', () => {
      const score = model.getScore()
      expect(score.title).toBe('Test Score')
      expect(score.tempo).toBe(120)
      expect(score.measures).toHaveLength(1)
    })

    it('should create score with default title and tempo', () => {
      const defaultModel = new ScoreModel()
      const score = defaultModel.getScore()
      expect(score.title).toBe('Untitled Score')
      expect(score.tempo).toBe(120)
    })
  })

  describe('setTitle', () => {
    it('should update the score title', () => {
      model.setTitle('New Title')
      expect(model.getScore().title).toBe('New Title')
    })
  })

  describe('setTempo', () => {
    it('should update the tempo', () => {
      model.setTempo(90)
      expect(model.getScore().tempo).toBe(90)
    })

    it('should throw error for tempo below 20', () => {
      expect(() => model.setTempo(10)).toThrow('Tempo must be between 20 and 300 BPM')
    })

    it('should throw error for tempo above 300', () => {
      expect(() => model.setTempo(400)).toThrow('Tempo must be between 20 and 300 BPM')
    })
  })

  describe('measure operations', () => {
    it('should add a new measure', () => {
      const measure = model.addMeasure()
      expect(model.getScore().measures).toHaveLength(2)
      expect(measure.number).toBe(2)
    })

    it('should get a measure by number', () => {
      const measure = model.getMeasure(1)
      expect(measure).toBeDefined()
      expect(measure?.number).toBe(1)
    })

    it('should return undefined for non-existent measure', () => {
      const measure = model.getMeasure(999)
      expect(measure).toBeUndefined()
    })

    it('should remove a measure and renumber subsequent measures', () => {
      model.addMeasure()
      model.addMeasure()
      model.removeMeasure(2)

      expect(model.getScore().measures).toHaveLength(2)
      expect(model.getMeasure(2)?.number).toBe(2)
      expect(model.getMeasure(3)).toBeUndefined()
    })

    it('should return false when removing non-existent measure', () => {
      expect(model.removeMeasure(999)).toBe(false)
    })
  })

  describe('note operations', () => {
    const noteParams: NoteParams = {
      step: 'C',
      alter: 0,
      octave: 4,
      duration: 'q',
      measure: 1,
      beat: frac(0, 1),
    }

    it('should add a note to a measure', () => {
      const note = model.addNote(noteParams)
      expect(note.step).toBe('C')
      expect(note.alter).toBe(0)
      expect(note.octave).toBe(4)
      expect(note.duration).toBe('q')
      expect(note.measure).toBe(1)
      expect(note.beat).toEqual(frac(0, 1))
      expect(note.id).toBeDefined()
    })

    it('should throw error when adding note to non-existent measure', () => {
      expect(() =>
        model.addNote({ ...noteParams, measure: 999 })
      ).toThrow('Measure 999 does not exist')
    })

    it('should throw error for note without step', () => {
      expect(() =>
        model.addNote({ duration: 'q', measure: 1, beat: frac(0, 1) })
      ).toThrow('Non-rest notes must have a step')
    })

    it('should sort notes by beat position', () => {
      model.addNote({ ...noteParams, beat: frac(2, 1) })
      model.addNote({ ...noteParams, beat: frac(0, 1) })
      model.addNote({ ...noteParams, beat: frac(1, 1) })

      const notes = model.getNotesInMeasure(1)
      expect(notes[0].beat).toEqual(frac(0, 1))
      expect(notes[1].beat).toEqual(frac(1, 1))
      expect(notes[2].beat).toEqual(frac(2, 1))
    })

    it('should get a note by ID', () => {
      const addedNote = model.addNote(noteParams)
      const foundNote = model.getNote(addedNote.id)
      expect(foundNote).toEqual(addedNote)
    })

    it('should return undefined for non-existent note', () => {
      const note = model.getNote('non-existent-id')
      expect(note).toBeUndefined()
    })

    it('should get all notes in a measure', () => {
      model.addNote(noteParams)
      model.addNote({ ...noteParams, beat: frac(1, 1) })

      const notes = model.getNotesInMeasure(1)
      const actualNotes = notes.filter(n => !n.isRest)
      expect(actualNotes).toHaveLength(2)
    })

    it('should update a note', () => {
      const note = model.addNote(noteParams)
      model.updateNote(note.id, { step: 'E', alter: 0, octave: 4, duration: 'h' })

      const updated = model.getNote(note.id)
      expect(updated?.step).toBe('E')
      expect(updated?.octave).toBe(4)
      expect(updated?.duration).toBe('h')
    })

    it('should move note to different measure when updating', () => {
      model.addMeasure()
      const note = model.addNote(noteParams)
      model.updateNote(note.id, { measure: 2 })

      const measure1Notes = model.getNotesInMeasure(1).filter(n => !n.isRest)
      const measure2Notes = model.getNotesInMeasure(2).filter(n => !n.isRest)
      expect(measure1Notes).toHaveLength(0)
      expect(measure2Notes).toHaveLength(1)
      expect(model.getNote(note.id)?.measure).toBe(2)
    })

    it('should throw error when updating to non-existent measure', () => {
      const note = model.addNote(noteParams)
      expect(() =>
        model.updateNote(note.id, { measure: 999 })
      ).toThrow('Target measure 999 does not exist')
    })

    it('should delete a note', () => {
      const note = model.addNote(noteParams)
      const deleted = model.deleteNote(note.id)

      expect(deleted).toBe(true)
      expect(model.getNote(note.id)).toBeUndefined()
      const remainingNotes = model.getNotesInMeasure(1).filter(n => !n.isRest)
      expect(remainingNotes).toHaveLength(0)
    })

    it('should return false when deleting non-existent note', () => {
      expect(model.deleteNote('non-existent-id')).toBe(false)
    })

    it('should get all notes in the score', () => {
      model.addMeasure()
      model.addNote(noteParams)
      model.addNote({ ...noteParams, measure: 2 })

      const allNotes = model.getAllNotes()
      const actualNotes = allNotes.filter(n => !n.isRest)
      expect(actualNotes).toHaveLength(2)
    })

    it('should clear all notes', () => {
      model.addNote(noteParams)
      model.addNote({ ...noteParams, beat: frac(1, 1) })
      model.clearAllNotes()

      const remainingNotes = model.getAllNotes().filter(n => !n.isRest)
      expect(remainingNotes).toHaveLength(0)
    })
  })

  describe('serialization', () => {
    it('should snapshot the score as ScoreData', () => {
      model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) })
      const data = model.toScoreData()

      expect(data.title).toBe('Test Score')
      expect(data.tempo).toBe(120)
      expect(data.schemaVersion).toBe(1)
      const chord = data.measures[0].slots.find(s => s.type === 'chord')
      expect(chord).toBeDefined()
      expect(chord!.type === 'chord' && chord!.notes[0].step).toBe('C')
      expect(chord!.type === 'chord' && chord!.notes[0].alter).toBe(0)
      expect(chord!.type === 'chord' && chord!.notes[0].octave).toBe(4)
      // Snapshot must not alias the live score object
      expect(data.measures[0]).not.toBe(model.getScore().measures[0])
    })

    it('should load a model back from ScoreData', () => {
      model.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) })
      const data = model.toScoreData()

      const loaded = ScoreModel.fromScoreData(data)
      expect(loaded.getScore().title).toBe('Test Score')
      expect(loaded.getScore().tempo).toBe(120)
      const actualNotes = loaded.getAllNotes().filter(n => !n.isRest)
      expect(actualNotes).toHaveLength(1)
    })
  })

  // ==================== Tuplet Tests ====================

  describe('createTuplet', () => {
    it('starts empty — no initial rests placed', () => {
      model.addMeasure()
      // Fill measure 1 with a whole rest first
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      const tupletNotes = getNotesInTuplet(model, tuplet.id)
      expect(tupletNotes).toHaveLength(0)
    })

    it('removes overlapping slots when creating a tuplet', () => {
      // There should be a whole rest covering the measure before creating the tuplet
      const before = model.getNotesInMeasure(1)
      expect(before.some(n => n.isRest)).toBe(true)

      createTuplet(model, 1, frac(0, 1), '8', 3, 2)

      // The whole rest should be gone — tuplet cleared it
      const after = model.getNotesInMeasure(1).filter(n => !n.tupletId)
      expect(after.every(n => !n.isRest || frac(0, 1) !== n.beat)).toBe(true)
    })
  })

  describe('refillTupletRemainder', () => {
    it('places filler rests spanning the full tuplet when empty', () => {
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      // Remaining written = 1 × 3/2 = 1.5 beats → splitBeatsIntoDurations(1.5) = ['q', '8']
      expect(notes).toHaveLength(2)
      expect(notes.every(n => n.isRest)).toBe(true)
      expect(notes[0].duration).toBe('q')
      expect(notes[1].duration).toBe('8')
    })

    it('total actual duration of filler rests equals tuplet span when empty', () => {
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      // Sum of actualDurations should equal 1 beat (the tuplet span)
      const totalActual = notes.reduce((sum, n) => {
        const ad = n.actualDuration
        return sum + (ad ? ad.num / ad.den : 0)
      }, 0)
      expect(totalActual).toBeCloseTo(1, 10)
    })

    it('places correct filler after one full-slot note (8th in 3:2 triplet)', () => {
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      // Add C4 8th — actual = 1/3 beat
      model.addNote({ step: 'C', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(0, 1), tupletId: tuplet.id, actualDuration: frac(1, 3) })
      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      const realNotes = notes.filter(n => !n.isRest)
      const rests = notes.filter(n => n.isRest)

      expect(realNotes).toHaveLength(1)
      // Remaining actual = 2/3 beat. Written = 2/3 × 3/2 = 1 beat = quarter
      // splitBeatsIntoDurations(1) = ['q']
      expect(rests).toHaveLength(1)
      expect(rests[0].duration).toBe('q')

      // Total actual = 1/3 + 2/3 = 1 beat
      const totalActual = notes.reduce((sum, n) => {
        const ad = n.actualDuration
        return sum + (ad ? ad.num / ad.den : 0)
      }, 0)
      expect(totalActual).toBeCloseTo(1, 10)
    })

    it('places correct filler for the bug scenario: 8th + 16th + 8th in triplet', () => {
      // This is the exact bug: C4(8th) + D4(16th) + E4(8th) → should leave 16th filler
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      const ratio = { num: 2, den: 3 }

      // C4 8th: actual = 1/2 × 2/3 = 1/3
      model.addNote({ step: 'C', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(0, 1), tupletId: tuplet.id, actualDuration: frac(1, 3) })
      // D4 16th: actual = 1/4 × 2/3 = 1/6
      model.addNote({ step: 'D', alter: 0, octave: 4, duration: '16', measure: 1, beat: frac(1, 3), tupletId: tuplet.id, actualDuration: frac(1, 6) })
      // E4 8th at beat 1/2 (mid-slot, the bug position): actual = 1/3
      model.addNote({ step: 'E', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(1, 2), tupletId: tuplet.id, actualDuration: frac(1, 3) })

      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      const rests = notes.filter(n => n.isRest)

      // Fill pointer = 1/2 + 1/3 = 5/6. Remaining actual = 1/6. Written = 1/6 × 3/2 = 1/4 → '16'
      expect(rests).toHaveLength(1)
      expect(rests[0].duration).toBe('16')

      // Total actual must equal 1 beat for the voice to be complete
      const totalActual = notes.reduce((sum, n) => {
        const ad = n.actualDuration
        return sum + (ad ? ad.num / ad.den : 0)
      }, 0)
      expect(totalActual).toBeCloseTo(1, 10)
      void ratio // suppress unused warning
    })

    it('does nothing when tuplet is full', () => {
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      // Fill with 3 eighth notes (each actual = 1/3, total = 1)
      model.addNote({ step: 'C', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(0, 1), tupletId: tuplet.id, actualDuration: frac(1, 3) })
      model.addNote({ step: 'D', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(1, 3), tupletId: tuplet.id, actualDuration: frac(1, 3) })
      model.addNote({ step: 'E', alter: 0, octave: 4, duration: '8', measure: 1, beat: frac(2, 3), tupletId: tuplet.id, actualDuration: frac(1, 3) })

      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      expect(notes.filter(n => n.isRest)).toHaveLength(0)
      expect(notes.filter(n => !n.isRest)).toHaveLength(3)
    })

    it('preserves existing rests and only fills empty gaps', () => {
      // Setup: triplet with a 16th rest at beat 0 and an 8th rest at beat 1/3
      // There is a gap at [1/6, 1/3) that must be filled
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      model.addNote({ duration: '16', measure: 1, beat: frac(0, 1), isRest: true, tupletId: tuplet.id, actualDuration: frac(1, 6) })
      model.addNote({ duration: '8',  measure: 1, beat: frac(1, 3), isRest: true, tupletId: tuplet.id, actualDuration: frac(1, 3) })
      model.addNote({ duration: '8',  measure: 1, beat: frac(2, 3), isRest: true, tupletId: tuplet.id, actualDuration: frac(1, 3) })

      refillTupletRemainder(model, 1, tuplet)

      const notes = getNotesInTuplet(model, tuplet.id)
      expect(notes).toHaveLength(4)
      expect(notes.every(n => n.isRest)).toBe(true)

      // Verify total actual duration still equals 1 beat
      const totalActual = notes.reduce((sum, n) => sum + (n.actualDuration ? n.actualDuration.num / n.actualDuration.den : 0), 0)
      expect(totalActual).toBeCloseTo(1, 10)

      // The gap at [1/6, 1/3) = 1/6 actual → should be filled with a 16th rest
      const sorted = [...notes].sort((a, b) => fracCompare(a.beat, b.beat))
      expect(sorted[0].duration).toBe('16') // original 16th rest preserved
      expect(sorted[1].duration).toBe('16') // new filler rest in the gap
      expect(sorted[2].duration).toBe('8')  // original 8th rest preserved
      expect(sorted[3].duration).toBe('8')  // original 8th rest preserved
    })

    it('does not duplicate rests when called multiple times', () => {
      const tuplet = createTuplet(model, 1, frac(0, 1), '8', 3, 2)
      refillTupletRemainder(model, 1, tuplet)
      refillTupletRemainder(model, 1, tuplet) // second call must be idempotent

      const notes = getNotesInTuplet(model, tuplet.id)
      const totalActual = notes.reduce((sum, n) => sum + (n.actualDuration ? n.actualDuration.num / n.actualDuration.den : 0), 0)
      expect(totalActual).toBeCloseTo(1, 10)
    })
  })
})
