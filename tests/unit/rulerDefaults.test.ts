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
import { PROJECT_TEMPO_EVENT_ID } from '../../src/timeline/tempo/tempoEdits';

describe('rulerDefaults', () => {
  it('default tempo map is a single 4/4 @ 60 BPM event at t=0', () => {
    const map = createDefaultTempoMap();
    expect(map.events).toEqual([
      {
        id: PROJECT_TEMPO_EVENT_ID,
        time: 0,
        bpm: DEFAULT_TEMPO_BPM,
        numerator: 4,
        denominator: 4,
        curve: 'jump',
      },
    ]);
  });

  // #299: the durable tier has optional ids, so load-time normalization is what
  // makes a pre-#299 project editable.
  it('backfills tempo-event ids for projects saved before #299', () => {
    const normalized = normalizeRulerLaneState({
      tempoMap: { events: [
        { time: 0, bpm: 60, numerator: 4, denominator: 4 },
        { time: 8, bpm: 120, numerator: 4, denominator: 4 },
      ] },
    });
    const ids = normalized.tempoMap.events.map(event => event.id);
    expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(2);
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

// Persistence round trip for tempo-event ids (issue #299, Packet 1).
//
// Save, load and composition-switch all funnel through normalizeRulerLaneState
// (projectSave.ts, loadTimelineHydration.ts, serializationUtils.ts), so the trip
// is exercised here at that single seam rather than through the whole IO stack.
describe('tempo events across save / load / composition switch', () => {
  it('keeps ids stable through repeated normalization', () => {
    const authored = normalizeRulerLaneState({
      tempoMap: { events: [
        { time: 0, bpm: 60, numerator: 4, denominator: 4 },
        { time: 8, bpm: 120, numerator: 3, denominator: 4 },
      ] },
    }).tempoMap;

    // save -> load -> switch away -> switch back
    let current = authored;
    for (let pass = 0; pass < 3; pass += 1) {
      current = normalizeRulerLaneState({ tempoMap: structuredClone(current) }).tempoMap;
    }

    expect(current.events).toEqual(authored.events);
  });

  it('survives the durable tier, where the id is optional', () => {
    const runtime = normalizeRulerLaneState({
      tempoMap: { events: [{ id: 'kept', time: 0, bpm: 96, numerator: 5, denominator: 8 }] },
    }).tempoMap;

    // ProjectTempoEvent is structurally the runtime event with an optional id.
    const durable: { events: Array<{ id?: string; time: number; bpm: number; numerator: number; denominator: number }> } =
      JSON.parse(JSON.stringify(runtime));
    const reloaded = normalizeRulerLaneState({ tempoMap: durable }).tempoMap;

    expect(reloaded.events).toEqual([
      { id: 'kept', time: 0, bpm: 96, numerator: 5, denominator: 8, curve: 'jump' },
    ]);
  });
});
