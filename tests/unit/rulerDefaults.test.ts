import { describe, expect, it } from 'vitest';

import type { RulerLane } from '../../src/types/timeline';
import {
  createDefaultRulerLaneState,
  createDefaultRulerLanes,
  createDefaultTempoMap,
  DEFAULT_TEMPO_BPM,
  normalizeRulerLaneState,
  TIME_RULER_LANE_ID,
} from '../../src/timeline/tempo/rulerDefaults';

describe('rulerDefaults', () => {
  it('default tempo map is a single 4/4 @ 60 BPM event at t=0', () => {
    const map = createDefaultTempoMap();
    expect(map.events).toEqual([
      { time: 0, bpm: DEFAULT_TEMPO_BPM, numerator: 4, denominator: 4 },
    ]);
  });

  it('default lanes are a single Time lane with the stable id', () => {
    expect(createDefaultRulerLanes()).toEqual([
      { id: TIME_RULER_LANE_ID, format: 'time' },
    ]);
  });

  it('default state points the active lane at the Time lane', () => {
    const state = createDefaultRulerLaneState();
    expect(state.activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
    expect(state.rulerLanes).toHaveLength(1);
  });

  describe('normalizeRulerLaneState (the migration)', () => {
    it('fills defaults for an old composition with no ruler fields', () => {
      const normalized = normalizeRulerLaneState();
      expect(normalized).toEqual(createDefaultRulerLaneState());
    });

    it('fills defaults when arrays are present but empty', () => {
      const normalized = normalizeRulerLaneState({
        tempoMap: { events: [] },
        rulerLanes: [],
        activeRulerLaneId: null,
      });
      expect(normalized.tempoMap.events).toHaveLength(1);
      expect(normalized.rulerLanes).toEqual(createDefaultRulerLanes());
      expect(normalized.activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
    });

    it('preserves a valid custom lane stack and active id', () => {
      const lanes: RulerLane[] = [
        { id: 'lane-a', format: 'bars' },
        { id: 'lane-b', format: 'frames' },
      ];
      const normalized = normalizeRulerLaneState({
        tempoMap: { events: [{ time: 0, bpm: 120, numerator: 3, denominator: 4 }] },
        rulerLanes: lanes,
        activeRulerLaneId: 'lane-b',
      });
      expect(normalized.rulerLanes).toEqual(lanes);
      expect(normalized.activeRulerLaneId).toBe('lane-b');
      expect(normalized.tempoMap.events[0].bpm).toBe(120);
    });

    it('drops duplicate-format lanes, keeping the first', () => {
      const normalized = normalizeRulerLaneState({
        rulerLanes: [
          { id: 'lane-1', format: 'time' },
          { id: 'lane-2', format: 'bars' },
          { id: 'lane-3', format: 'time' },
        ],
      });
      expect(normalized.rulerLanes).toEqual([
        { id: 'lane-1', format: 'time' },
        { id: 'lane-2', format: 'bars' },
      ]);
    });

    it('resets an active id that does not reference any lane to the first lane', () => {
      const normalized = normalizeRulerLaneState({
        rulerLanes: [{ id: 'lane-x', format: 'bars' }],
        activeRulerLaneId: 'ghost-lane',
      });
      expect(normalized.activeRulerLaneId).toBe('lane-x');
    });
  });
});
