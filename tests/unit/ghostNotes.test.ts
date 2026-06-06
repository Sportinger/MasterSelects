import { describe, expect, it } from 'vitest';
import { computeGhostNotes } from '../../src/components/pianoRoll/ghostNotes';
import { createMockClip } from '../helpers/mockData';
import type { MidiNote } from '../../src/types/midiClip';

function note(overrides: Partial<MidiNote> & Pick<MidiNote, 'pitch' | 'start' | 'duration'>): MidiNote {
  return { id: `n-${overrides.pitch}-${overrides.start}`, velocity: 0.8, ...overrides };
}

function midiClip(id: string, startTime: number, duration: number, notes: MidiNote[]) {
  return createMockClip({
    id,
    trackId: `midi-${id}`,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'midi', naturalDuration: duration },
    midiData: { notes },
  });
}

describe('computeGhostNotes', () => {
  it('returns ghosts from another clip in active-clip-local time', () => {
    const active = midiClip('active', 4, 4, []); // window [4, 8]
    const other = midiClip('other', 2, 4, [note({ pitch: 60, start: 3, duration: 1 })]); // abs [5, 6]

    const ghosts = computeGhostNotes(active, [active, other]);

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ key: 'other:n-60-3', pitch: 60, start: 1, duration: 1 });
  });

  it('clamps ghosts to the active clip window', () => {
    const active = midiClip('active', 4, 4, []); // window [4, 8]
    // Note spans abs [3, 9] — pokes out both sides; visible part is [4, 8] => local [0, 4].
    const other = midiClip('other', 0, 12, [note({ pitch: 64, start: 3, duration: 6 })]);

    const ghosts = computeGhostNotes(active, [active, other]);

    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ pitch: 64, start: 0, duration: 4 });
  });

  it('excludes the active clip and non-overlapping / non-MIDI clips', () => {
    const active = midiClip('active', 4, 4, [note({ pitch: 72, start: 0, duration: 1 })]);
    const before = midiClip('before', 0, 3, [note({ pitch: 60, start: 0, duration: 1 })]); // abs [0,1] no overlap
    const audio = createMockClip({ id: 'audio', startTime: 4, duration: 4, source: { type: 'audio', naturalDuration: 4 } });

    const ghosts = computeGhostNotes(active, [active, before, audio]);

    expect(ghosts).toHaveLength(0);
  });
});
