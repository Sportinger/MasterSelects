// An eraser swipe in the piano roll is one undo step: the note under the press is deleted inside
// the swipe's history batch together with every note the swipe passes over (mouse and touch).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const history = vi.hoisted(() => ({
  events: [] as string[],
  inRun: false,
}));

vi.mock('../../src/components/pianoRoll/pianoRollDragHistory', () => ({
  beginPianoRollDragHistory: vi.fn(() => {
    history.events.push('begin');
    return {
      run: <T,>(action: () => T): T => {
        history.inRun = true;
        try { return action(); } finally { history.inRun = false; }
      },
      commit: () => history.events.push('commit'),
      cancel: () => history.events.push('cancel'),
    };
  }),
}));

const { useTimelineStore } = await import('../../src/stores/timeline');
const { PianoRoll } = await import('../../src/components/pianoRoll/PianoRoll');
import type { TimelineClip } from '../../src/types';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }

const NOTES = [
  { id: 'n1', pitch: 60, start: 0, duration: 0.5, velocity: 0.8 },
  { id: 'n2', pitch: 60, start: 1, duration: 0.5, velocity: 0.8 },
  { id: 'n3', pitch: 62, start: 2, duration: 0.5, velocity: 0.8 },
];

function midiClip(): TimelineClip {
  return {
    id: 'clip-midi', trackId: 'midi-1', name: 'MIDI Clip',
    file: new File([], 'midi-clip.dat'),
    startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
    source: { type: 'midi', naturalDuration: 4 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    midiData: { notes: NOTES.map((note) => ({ ...note })) },
  } as TimelineClip;
}

// Default zoom: 120 px per second, 16 px rows, pitch 108 at y = 0. jsdom boxes sit at 0,0, so the
// client point is the grid point.
const pointOf = (note: { start: number; pitch: number }) => ({ clientX: note.start * 120 + 5, clientY: (108 - note.pitch) * 16 + 5 });

const realRemove = useTimelineStore.getState().removeMidiNote;

describe('piano roll eraser swipe history', () => {
  const removed: { id: string; inBatch: boolean }[] = [];

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    history.events.length = 0;
    removed.length = 0;
    useTimelineStore.setState({
      clips: [midiClip()],
      removeMidiNote: (clipId: string, noteId: string) => {
        removed.push({ id: noteId, inBatch: history.inRun });
        realRemove(clipId, noteId);
      },
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('deletes the pressed note inside the same batch as the swiped notes and commits once', () => {
    render(<PianoRoll clipId="clip-midi" embedded />);
    fireEvent.click(screen.getByTestId('piano-roll-tool-eraser'));
    const [first] = screen.getAllByTestId('piano-roll-note');
    fireEvent.mouseDown(first, { button: 0, ...pointOf(NOTES[0]) });
    fireEvent.mouseMove(document, pointOf(NOTES[1]));
    fireEvent.mouseMove(document, pointOf(NOTES[2]));
    fireEvent.mouseUp(document);

    expect(removed.map((entry) => entry.id)).toEqual(['n1', 'n2', 'n3']);
    expect(removed.filter((entry) => !entry.inBatch), 'deletions outside the swipe batch').toEqual([]);
    expect(history.events).toEqual(['begin', 'commit']);
    expect(useTimelineStore.getState().clips[0].midiData?.notes ?? []).toEqual([]);
  });

  it('a press on empty grid that swipes over a note still makes one batch', () => {
    render(<PianoRoll clipId="clip-midi" embedded />);
    fireEvent.click(screen.getByTestId('piano-roll-tool-eraser'));
    fireEvent.mouseDown(screen.getByTestId('piano-roll-grid'), { button: 0, clientX: 600, clientY: 5 });
    fireEvent.mouseMove(document, pointOf(NOTES[1]));
    fireEvent.mouseUp(document);

    expect(removed).toEqual([{ id: 'n2', inBatch: true }]);
    expect(history.events).toEqual(['begin', 'commit']);
  });
});
