import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { TIME_RULER_LANE_ID, rulerLaneIdForFormat } from '../../../src/timeline/tempo/rulerDefaults';

describe('rulerSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

  it('starts with a single default Time lane that is active', () => {
    const state = store.getState();
    expect(state.rulerLanes).toEqual([{ id: TIME_RULER_LANE_ID, format: 'time' }]);
    expect(state.activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
  });

  // ─── addRulerLane ────────────────────────────────────────────────────

  it('addRulerLane: enables a new format and returns its id', () => {
    const id = store.getState().addRulerLane('bars');
    expect(id).toBe(rulerLaneIdForFormat('bars'));
    expect(store.getState().rulerLanes.map(l => l.format)).toContain('bars');
  });

  it('addRulerLane: is a no-op for a format already present (uniqueness)', () => {
    const id = store.getState().addRulerLane('time'); // already present
    expect(id).toBe(TIME_RULER_LANE_ID);
    expect(store.getState().rulerLanes.filter(l => l.format === 'time')).toHaveLength(1);
  });

  it('addRulerLane: keeps lanes in canonical stacking order', () => {
    store.getState().addRulerLane('bars');
    store.getState().addRulerLane('frames');
    store.getState().addRulerLane('timecode');
    expect(store.getState().rulerLanes.map(l => l.format)).toEqual([
      'time', 'timecode', 'frames', 'bars',
    ]);
  });

  // ─── removeRulerLane ─────────────────────────────────────────────────

  it('removeRulerLane: removes the lane', () => {
    store.getState().addRulerLane('bars');
    const barsId = rulerLaneIdForFormat('bars');
    store.getState().removeRulerLane(barsId);
    expect(store.getState().rulerLanes.some(l => l.id === barsId)).toBe(false);
  });

  it('removeRulerLane: repoints the active lane when the active one is removed', () => {
    store.getState().addRulerLane('bars');
    store.getState().setActiveRulerLane(rulerLaneIdForFormat('bars'));
    store.getState().removeRulerLane(rulerLaneIdForFormat('bars'));
    // Falls back to the first remaining lane (Time).
    expect(store.getState().activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
  });

  it('removeRulerLane: leaves a non-active removal untouched', () => {
    store.getState().addRulerLane('bars');
    store.getState().setActiveRulerLane(TIME_RULER_LANE_ID);
    store.getState().removeRulerLane(rulerLaneIdForFormat('bars'));
    expect(store.getState().activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
  });

  it('removeRulerLane: active becomes null when the last lane is removed', () => {
    store.getState().removeRulerLane(TIME_RULER_LANE_ID);
    expect(store.getState().rulerLanes).toHaveLength(0);
    expect(store.getState().activeRulerLaneId).toBeNull();
  });

  // ─── setActiveRulerLane ──────────────────────────────────────────────

  it('setActiveRulerLane: selects an existing lane', () => {
    store.getState().addRulerLane('frames');
    store.getState().setActiveRulerLane(rulerLaneIdForFormat('frames'));
    expect(store.getState().activeRulerLaneId).toBe(rulerLaneIdForFormat('frames'));
  });

  it('setActiveRulerLane: ignores an id that references no lane', () => {
    store.getState().setActiveRulerLane('ghost-lane');
    expect(store.getState().activeRulerLaneId).toBe(TIME_RULER_LANE_ID);
  });

  it('setActiveRulerLane: accepts null to clear the active lane', () => {
    store.getState().setActiveRulerLane(null);
    expect(store.getState().activeRulerLaneId).toBeNull();
  });

  // ─── reorderRulerLanes ───────────────────────────────────────────────

  it('reorderRulerLanes: applies an explicit order', () => {
    store.getState().addRulerLane('bars');
    store.getState().addRulerLane('frames');
    const ids = store.getState().rulerLanes.map(l => l.id);
    const reversed = [...ids].reverse();
    store.getState().reorderRulerLanes(reversed);
    expect(store.getState().rulerLanes.map(l => l.id)).toEqual(reversed);
  });

  it('reorderRulerLanes: keeps unmentioned lanes appended', () => {
    store.getState().addRulerLane('bars');
    store.getState().reorderRulerLanes([rulerLaneIdForFormat('bars')]);
    const ids = store.getState().rulerLanes.map(l => l.id);
    expect(ids[0]).toBe(rulerLaneIdForFormat('bars'));
    expect(ids).toContain(TIME_RULER_LANE_ID);
  });
});
