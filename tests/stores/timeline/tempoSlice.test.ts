import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { PROJECT_TEMPO_EVENT_ID } from '../../../src/timeline/tempo/tempoEdits';

const captureSnapshot = vi.hoisted(() => vi.fn());

// The slice must reach history; the real store pulls in the whole app graph, so
// only the capture entry point is stubbed. Ordering is asserted below.
vi.mock('../../../src/stores/historyStore', () => ({ captureSnapshot }));

describe('tempoSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    captureSnapshot.mockClear();
    store = createTestTimelineStore();
  });

  const events = () => store.getState().tempoMap.events;

  it('starts from the default single 4/4 @ 60 BPM project tempo', () => {
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ id: PROJECT_TEMPO_EVENT_ID, time: 0, bpm: 60 });
  });

  // ─── setProjectTempo ────────────────────────────────────────────────

  it('setProjectTempo: changes the pinned first event', () => {
    store.getState().setProjectTempo(128);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ time: 0, bpm: 128 });
  });

  it('setProjectTempo: keeps the event pinned at 0 with several events present', () => {
    store.getState().addTempoChange(8, 90);
    store.getState().setProjectTempo(100);
    expect(events()[0]).toMatchObject({ time: 0, bpm: 100 });
    expect(events()[1]).toMatchObject({ bpm: 90 });
  });

  it('setProjectTempo: later events keep their BAR, so their seconds move', () => {
    // Default 60 BPM 4/4 => 4 s bars, so 8 s is the bar-3 downbeat.
    store.getState().addTempoChange(8, 90);
    store.getState().setProjectTempo(100);

    // At 100 BPM a 4/4 bar is 2.4 s, so bar 3 now sits at 4.8 s. A tempo mark is
    // musical: it stays on its bar and its seconds follow.
    expect(events()[1].time).toBeCloseTo(4.8, 9);
  });

  // ─── addTempoChange ─────────────────────────────────────────────────

  it('addTempoChange: appends an event and returns its id', () => {
    const id = store.getState().addTempoChange(8, 120);
    expect(id).toBeTruthy();
    expect(events()).toHaveLength(2);
    expect(events()[1]).toMatchObject({ id, time: 8, bpm: 120 });
  });

  it('addTempoChange: inherits the meter in effect and accepts an override', () => {
    store.getState().updateTempoChange(PROJECT_TEMPO_EVENT_ID, { numerator: 3, denominator: 8 });
    store.getState().addTempoChange(4, 90);
    expect(events()[1]).toMatchObject({ numerator: 3, denominator: 8 });

    store.getState().addTempoChange(8, 90, { numerator: 5, denominator: 4 });
    expect(events()[2]).toMatchObject({ numerator: 5, denominator: 4 });
  });

  it('addTempoChange: writing onto an occupied position replaces it', () => {
    const id = store.getState().addTempoChange(8, 120);
    const second = store.getState().addTempoChange(8, 90);
    expect(second).toBe(id);
    expect(events()).toHaveLength(2);
    expect(events()[1].bpm).toBe(90);
  });

  // ─── updateTempoChange / removeTempoChange ──────────────────────────

  it('updateTempoChange: patches bpm and moves the event', () => {
    const id = store.getState().addTempoChange(8, 120)!;
    store.getState().updateTempoChange(id, { bpm: 140, time: 4 });
    expect(events()[1]).toMatchObject({ id, time: 4, bpm: 140 });
  });

  it('removeTempoChange: deletes a tempo change but never the project tempo', () => {
    const id = store.getState().addTempoChange(8, 120)!;
    store.getState().removeTempoChange(id);
    expect(events()).toHaveLength(1);

    store.getState().removeTempoChange(PROJECT_TEMPO_EVENT_ID);
    expect(events()).toHaveLength(1);
  });

  // ─── history ────────────────────────────────────────────────────────

  it('captures a labelled snapshot for every real edit', () => {
    const id = store.getState().addTempoChange(8, 120)!;
    store.getState().updateTempoChange(id, { bpm: 90 });
    store.getState().removeTempoChange(id);
    store.getState().setProjectTempo(96);

    expect(captureSnapshot.mock.calls.map(call => call[0])).toEqual([
      'Add tempo change',
      'Edit tempo change',
      'Remove tempo change',
      'Set project tempo',
    ]);
  });

  it('captures AFTER the mutation, so the snapshot sees the new tempo', () => {
    captureSnapshot.mockImplementationOnce(() => {
      expect(store.getState().tempoMap.events[0].bpm).toBe(128);
    });
    store.getState().setProjectTempo(128);
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not capture a snapshot when the edit changes nothing', () => {
    store.getState().setProjectTempo(60); // already the default
    store.getState().removeTempoChange('does-not-exist');
    store.getState().updateTempoChange('does-not-exist', { bpm: 200 });
    expect(captureSnapshot).not.toHaveBeenCalled();
  });
});

// Packet 2: a tempo edit moves MIDI content and leaves media alone, in ONE
// snapshot so a single undo reverts both.
describe('tempoSlice — content follows tempo', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  const midiTrack = {
    id: 'midi-1', name: 'MIDI 1', type: 'midi' as const, height: 40,
    muted: false, visible: true, solo: false,
  };

  const baseClip = {
    file: new File([], 'x.dat'),
    transform: {} as never,
    effects: [],
  };

  beforeEach(() => {
    captureSnapshot.mockClear();
    store = createTestTimelineStore();
    // Author the content AT 120 BPM: the store defaults to 60, and changing the
    // tempo first would remap the clips we are about to assert on.
    store.getState().setProjectTempo(120);
    store.setState({
      tracks: [midiTrack, { id: 'video-1', name: 'Video 1', type: 'video', height: 60, muted: false, visible: true, solo: false }],
      clips: [
        {
          ...baseClip,
          id: 'midi-clip', trackId: 'midi-1', name: 'MIDI',
          startTime: 0, duration: 4, inPoint: 0, outPoint: 4,
          source: { type: 'midi', naturalDuration: 4 },
          midiData: { notes: [{ id: 'n1', pitch: 60, start: 1, duration: 1, velocity: 0.8 }] },
        },
        {
          ...baseClip,
          id: 'video-clip', trackId: 'video-1', name: 'Video',
          startTime: 2, duration: 3, inPoint: 0, outPoint: 3,
          source: { type: 'video', naturalDuration: 3 },
        },
      ] as never,
    });
    captureSnapshot.mockClear();
  });

  const clipById = (id: string) => store.getState().clips.find(clip => clip.id === id)!;

  it('halving the project tempo doubles MIDI clip and note timing', () => {
    store.getState().setProjectTempo(60);

    const midi = clipById('midi-clip');
    expect(midi.duration).toBeCloseTo(8, 6);
    expect(midi.midiData!.notes[0].start).toBeCloseTo(2, 6);
    expect(midi.midiData!.notes[0].duration).toBeCloseTo(2, 6);
  });

  it('leaves video clips byte-identical', () => {
    const before = clipById('video-clip');
    store.getState().setProjectTempo(60);
    expect(clipById('video-clip')).toBe(before);
  });

  it('commits the tempo and the content under ONE snapshot', () => {
    store.getState().setProjectTempo(60);
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
    expect(captureSnapshot).toHaveBeenCalledWith('Set project tempo');
  });

  it('only moves content after a mid-timeline tempo change', () => {
    const before = clipById('midi-clip');
    // The clip lives in 0..4 s; the change starts at 16 s.
    store.getState().addTempoChange(16, 60);
    expect(clipById('midi-clip')).toBe(before);
  });
});
