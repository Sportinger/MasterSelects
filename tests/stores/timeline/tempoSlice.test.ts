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
    expect(events()[1]).toMatchObject({ time: 8, bpm: 90 });
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
