import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NoteEntryCoordinator } from '../../src/services/score/NoteEntryCoordinator'
import { ScoreModel } from '../../src/services/score/ScoreModel'
import { CollisionDetector } from '../../src/services/score/CollisionDetector'
import { fracCreate as frac, fracToNumber } from '../../src/services/score/fraction'

function makeCoordinator(scoreModel: ScoreModel) {
  const collisionDetector = new CollisionDetector()
  const onCommit = vi.fn()
  return new NoteEntryCoordinator(
    () => scoreModel,
    collisionDetector,
    onCommit,
  )
}

describe('NoteEntryCoordinator.splitExistingNoteWithTie', () => {
  let scoreModel: ScoreModel
  let coordinator: NoteEntryCoordinator

  beforeEach(() => {
    scoreModel = new ScoreModel('Test', 120)
    // Ensure we have 2 measures
    scoreModel.addMeasure()
    coordinator = makeCoordinator(scoreModel)
  })

  it('splits a note at beat 0 into the next measure (basic case)', () => {
    // Add a quarter note at beat 0 in measure 1
    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) })

    // Request a whole note (4 beats) — only 4 available but note is at beat 0, so no overflow...
    // Let's put it at beat 2 so 2 beats remain, then request a whole note (4 beats) → overflow 2 beats
    scoreModel.deleteNote(note.id)
    const note2 = scoreModel.addNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })

    coordinator.splitExistingNoteWithTie(note2, 'w', 2) // whole = 4b, available = 2b, overflow = 2b

    const m1Notes = scoreModel.getNotesInMeasure(1).filter(n => !n.isRest)
    const m2Notes = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)

    // Current measure: 2 beats remaining → half note
    expect(m1Notes).toHaveLength(1)
    expect(m1Notes[0].duration).toBe('h')
    expect(m1Notes[0].step).toBe('E')

    // Next measure: 2 beats → half note
    expect(m2Notes).toHaveLength(1)
    expect(m2Notes[0].duration).toBe('h')
    expect(m2Notes[0].step).toBe('E')

    // Tied together
    expect(m1Notes[0].tiedTo).toBe(m2Notes[0].id)
    expect(m2Notes[0].tiedFrom).toBe(m1Notes[0].id)
  })

  it('handles multi-duration split in the current measure (bug fix: 3 beats remaining)', () => {
    // Note at beat 1 in 4/4 → 3 beats remain. Request whole (4 beats) → overflow = 1 beat
    // currentMeasureDurations(3) = ['h', 'q'], nextMeasureDurations(1) = ['q']
    const note = scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) })

    coordinator.splitExistingNoteWithTie(note, 'w', 1) // overflow = 1 beat

    const m1Notes = scoreModel.getNotesInMeasure(1).filter(n => !n.isRest && n.step === 'G')
    const m2Notes = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest && n.step === 'G')

    // 3 beats in current measure: half (2b) + quarter (1b)
    expect(m1Notes).toHaveLength(2)
    expect(m1Notes[0].duration).toBe('h')
    expect(m1Notes[1].duration).toBe('q')

    // 1 beat in next measure: quarter
    expect(m2Notes).toHaveLength(1)
    expect(m2Notes[0].duration).toBe('q')

    // Full tie chain: half → quarter (same measure) → quarter (next measure)
    expect(m1Notes[0].tiedTo).toBe(m1Notes[1].id)
    expect(m1Notes[1].tiedFrom).toBe(m1Notes[0].id)
    expect(m1Notes[1].tiedTo).toBe(m2Notes[0].id)
    expect(m2Notes[0].tiedFrom).toBe(m1Notes[1].id)
  })

  it('creates the next measure automatically if it does not exist', () => {
    // ScoreModel starts with 1 measure; remove the extra one we added
    const freshModel = new ScoreModel('Test', 120)
    const freshCoord = makeCoordinator(freshModel)
    expect(freshModel.getScore().measures).toHaveLength(1)

    const note = freshModel.addNote({ step: 'A', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })
    freshCoord.splitExistingNoteWithTie(note, 'w', 2)

    expect(freshModel.getScore().measures).toHaveLength(2)
    const m2Notes = freshModel.getNotesInMeasure(2).filter(n => !n.isRest)
    expect(m2Notes).toHaveLength(1)
  })

  it('displaces existing content in the next measure (MuseScore-style)', () => {
    // Pre-fill measure 2 with a quarter note
    scoreModel.addNote({ step: 'D', alter: 0, octave: 4, duration: 'q', measure: 2, beat: frac(0, 1) })

    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })
    coordinator.splitExistingNoteWithTie(note, 'w', 2) // overflow 2 beats into m2

    // The D in measure 2 should be gone; the tied C continuation should be there instead
    const m2Notes = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    expect(m2Notes.every(n => n.step !== 'D')).toBe(true)
    expect(m2Notes.some(n => n.step === 'C')).toBe(true)
  })
})

describe('NoteEntryCoordinator — Sibelius-style erosion', () => {
  let scoreModel: ScoreModel
  let coordinator: NoteEntryCoordinator

  beforeEach(() => {
    scoreModel = new ScoreModel('Test', 120)
    scoreModel.addMeasure()
    coordinator = makeCoordinator(scoreModel)
  })

  it('trims a straddling note instead of deleting it (headline case)', () => {
    // 4/4: E4q at beat 2 → dotted half (3 beats). Overflow = 1 beat.
    // G4h at beat 0 in M2 straddles: remainder = 2 - 1 = 1 beat → G4q at beat 1
    scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) })
    scoreModel.addNote({ step: 'A', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(2, 1) })
    const note = scoreModel.addNote({ step: 'E', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })

    coordinator.splitExistingNoteWithTie(note, 'h', 1) // 2b available, overflow = 1b → M2 gets E4q

    const m2NonRest = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    const g4 = m2NonRest.find(n => n.step === 'G')
    const a4 = m2NonRest.find(n => n.step === 'A')

    // G4 must survive, trimmed to quarter, moved to beat 1
    expect(g4).toBeDefined()
    expect(g4!.duration).toBe('q')
    expect(fracToNumber(g4!.beat)).toBeCloseTo(1)

    // A4 untouched
    expect(a4).toBeDefined()
    expect(a4!.duration).toBe('h')
    expect(fracToNumber(a4!.beat)).toBeCloseTo(2)
  })

  it('deletes a note fully consumed by the overflow zone', () => {
    // G4q at beat 0 in M2, overflow = 2 beats → G4q entirely within [0,2), deleted
    scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 2, beat: frac(0, 1) })
    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })

    coordinator.splitExistingNoteWithTie(note, 'w', 2) // overflow = 2 beats

    const m2NonRest = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    expect(m2NonRest.every(n => n.step !== 'G')).toBe(true)
  })

  it('builds a tie chain when the trimmed remainder needs multiple durations', () => {
    // G4 whole at beat 0 in M2, overflow = 1 beat → remainder = 3 beats → h + q tied
    scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'w', measure: 2, beat: frac(0, 1) })
    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(3, 1) })

    coordinator.splitExistingNoteWithTie(note, 'h', 1) // 1b available, overflow = 1b

    const m2G = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest && n.step === 'G')
    // Remainder = 3 beats → h (2b) at beat 1 + q (1b) at beat 3
    expect(m2G).toHaveLength(2)
    expect(m2G[0].duration).toBe('h')
    expect(fracToNumber(m2G[0].beat)).toBeCloseTo(1)
    expect(m2G[1].duration).toBe('q')
    expect(fracToNumber(m2G[1].beat)).toBeCloseTo(3)
    // Tied together
    expect(m2G[0].tiedTo).toBe(m2G[1].id)
    expect(m2G[1].tiedFrom).toBe(m2G[0].id)
  })

  it('breaks the upstream tiedFrom pointer when eroding a note that has tiedFrom', () => {
    // G4h in M2 is the tied continuation of G4h in M1
    const g4m1 = scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'h', measure: 1, beat: frac(0, 1) })
    const g4m2 = scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) })
    scoreModel.updateNote(g4m1.id, { tiedTo: g4m2.id })
    scoreModel.updateNote(g4m2.id, { tiedFrom: g4m1.id })

    // Now enter C4 at beat 2 M1 extended to whole → overflow 2 beats, erodes G4m2
    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })
    coordinator.splitExistingNoteWithTie(note, 'w', 2) // overflow = 2 beats, G4h fully consumed

    // Upstream tie pointer on G4m1 should be cleared
    const updated = scoreModel.getNote(g4m1.id)
    expect(updated?.tiedTo).toBeUndefined()
  })

  it('falls back to deletion when the note to erode has a downstream tiedTo', () => {
    // G4h in M2 is itself tied forward to G4q in M2
    const g4head = scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) })
    const g4tail = scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 2, beat: frac(2, 1) })
    scoreModel.updateNote(g4head.id, { tiedTo: g4tail.id })
    scoreModel.updateNote(g4tail.id, { tiedFrom: g4head.id })

    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })
    coordinator.splitExistingNoteWithTie(note, 'h', 1) // overflow = 1 beat, G4h straddles

    // G4head must be deleted (punt case), not trimmed
    const m2NonRest = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    expect(m2NonRest.every(n => n.step !== 'G' || n.id === g4tail.id)).toBe(true)
  })

  it('erodes via addNoteAtBeat (addSplitNoteWithTie path)', () => {
    // Same headline scenario but triggered via addNoteAtBeat (new note entry)
    scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(0, 1) })
    scoreModel.addNote({ step: 'A', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(2, 1) })

    // Fill M1 so beat 2 is a rest: add notes at 0 and 1
    scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(0, 1) })
    scoreModel.addNote({ step: 'D', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(1, 1) })

    // Enter E4 dotted-half (3 beats) at beat 2 — overflow 1 beat, should erode G4h → G4q
    coordinator.addNoteAtBeat({
      step: 'E', alter: 0, octave: 4, duration: 'h', dots: 1, measure: 1, beat: frac(2, 1),
    })

    const m2NonRest = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    const g4 = m2NonRest.find(n => n.step === 'G')
    expect(g4).toBeDefined()
    expect(g4!.duration).toBe('q')
    expect(fracToNumber(g4!.beat)).toBeCloseTo(1)
  })

  it('handles mixed overflow zone: fully-consumed note deleted, straddling note trimmed', () => {
    // M2: G4q at beat 0 (fully consumed), A4h at beat 1 (straddles). Overflow = 2 beats.
    // A4h: start=1, end=3, overflow=2 → remainder = 3-2 = 1b → A4q at beat 2
    scoreModel.addNote({ step: 'G', alter: 0, octave: 4, duration: 'q', measure: 2, beat: frac(0, 1) })
    scoreModel.addNote({ step: 'A', alter: 0, octave: 4, duration: 'h', measure: 2, beat: frac(1, 1) })
    const note = scoreModel.addNote({ step: 'C', alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(2, 1) })

    coordinator.splitExistingNoteWithTie(note, 'w', 2) // overflow = 2 beats

    const m2NonRest = scoreModel.getNotesInMeasure(2).filter(n => !n.isRest)
    expect(m2NonRest.every(n => n.step !== 'G')).toBe(true) // G4q deleted
    const a4 = m2NonRest.find(n => n.step === 'A')
    expect(a4).toBeDefined()
    expect(a4!.duration).toBe('q')
    expect(fracToNumber(a4!.beat)).toBeCloseTo(2)
  })
})
