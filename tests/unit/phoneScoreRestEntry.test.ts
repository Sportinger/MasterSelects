// Root fix found by the phone Notation journey: a rest entered at a beat that already holds a rest
// (the measure's filler) replaced nothing, so the measure held two rests at one beat, overflowed
// and VexFlow stopped drawing the following slots. The same path serves the desktop 'r' key.
import { describe, expect, it, vi } from 'vitest'

import { CollisionDetector } from '../../src/services/score/CollisionDetector'
import { NoteEntryCoordinator } from '../../src/services/score/NoteEntryCoordinator'
import { ScoreModel } from '../../src/services/score/ScoreModel'
import { durationToBeats } from '../../src/services/score/musicUtils'
import { fracCreate as frac, fracToNumber } from '../../src/services/score/fraction'

describe('NoteEntryCoordinator.addNoteAtBeat with a rest', () => {
  it('replaces the filler rest at that beat instead of stacking a second one', () => {
    const model = new ScoreModel('Test', 120)
    model.addMeasure()
    const coordinator = new NoteEntryCoordinator(() => model, new CollisionDetector(), vi.fn())
    for (const [step, beat] of [['C', 0], ['D', 1], ['E', 2]] as const) {
      coordinator.addNoteAtBeat({ step, alter: 0, octave: 4, duration: 'q', measure: 1, beat: frac(beat, 1) })
    }
    const rest = coordinator.addNoteAtBeat({ duration: 'q', measure: 1, beat: frac(3, 1), isRest: true })
    expect(rest?.isRest).toBe(true)

    const notes = model.getNotesInMeasure(1)
    const atBeat3 = notes.filter(note => fracToNumber(note.beat) === 3)
    expect(atBeat3).toHaveLength(1)
    const slotBeats = new Map<number, number>()
    for (const note of notes) slotBeats.set(fracToNumber(note.beat), durationToBeats(note.duration, note.dots ?? 0))
    expect([...slotBeats.values()].reduce((sum, beats) => sum + beats, 0)).toBe(4)
  })
})
