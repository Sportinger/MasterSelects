// Tempo-grid snapping (issue #299, Packet 4).
//
// Two rules under test: the grid only snaps when a Bars+Beats ruler lane is
// ENABLED (§3.5), and grid candidates use a PIXEL-derived threshold so a dense
// subdivision does not capture every position at low zoom.

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { normalizeTempoMap } from '../../../src/timeline/tempo/tempoEdits';
import { rulerLaneIdForFormat } from '../../../src/timeline/tempo/rulerDefaults';
import type { TimelineClip } from '../../../src/types/timeline';

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 2,
    inPoint: 0,
    outPoint: 2,
    source: { type: 'video', naturalDuration: 2 },
    transform: {} as TimelineClip['transform'],
    effects: [],
    ...overrides,
  };
}

describe('tempo grid snapping', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
    store.setState({
      clips: [clip()],
      // 120 BPM 4/4 => beats 0.5 s, bars 2 s.
      tempoMap: normalizeTempoMap({
        events: [{ id: 'a', time: 0, bpm: 120, numerator: 4, denominator: 4 }],
      }),
      zoom: 100,
      playheadPosition: -1,
      timelineGridSubdivision: 'beat',
    });
  });

  const enableBarsLane = () => store.getState().addRulerLane('bars');
  const snap = (desired: number) => store.getState().getSnappedPosition('clip-1', desired, 'video-1');

  it('does not snap to the grid while no bars lane is enabled', () => {
    const result = snap(3.97);
    expect(result.snapped).toBe(false);
    expect(result.startTime).toBeCloseTo(3.97, 6);
  });

  it('snaps a clip start to the nearest bar once the bars lane is enabled', () => {
    enableBarsLane();
    const result = snap(3.97);
    expect(result.snapped).toBe(true);
    expect(result.startTime).toBeCloseTo(4, 6);
  });

  it('snaps to a beat between bars', () => {
    enableBarsLane();
    const result = snap(2.53);
    expect(result.startTime).toBeCloseTo(2.5, 6);
  });

  it('snaps the clip END to a grid line too', () => {
    enableBarsLane();
    // A 1.3 s clip breaks the 2 s bar period, so start and end are not
    // equidistant from their nearest lines: 2.72 is >0.1 s from any line, while
    // the end (4.02) is 0.02 s from bar 3, so the END wins the snap.
    store.setState({ clips: [clip({ duration: 1.3, outPoint: 1.3 })] });
    const result = snap(2.72);
    expect(result.snapped).toBe(true);
    expect(result.snapEdgeTime).toBeCloseTo(4, 6);
    expect(result.startTime).toBeCloseTo(2.7, 6);
  });

  it('leaves positions far from any line alone', () => {
    enableBarsLane();
    // At zoom 100 the pixel budget is 0.1 s; 3.7 is 0.2 s from the 3.5 beat.
    const result = snap(3.7);
    expect(result.snapped).toBe(false);
    expect(result.startTime).toBeCloseTo(3.7, 6);
  });

  it('shrinks the capture window with zoom instead of snapping everything', () => {
    enableBarsLane();
    store.setState({ timelineGridSubdivision: '1/16' });

    // Zoomed in: 1/16 lines are 0.125 s apart and 12.5 px — visible and snappable.
    store.setState({ zoom: 100 });
    expect(snap(3.13).startTime).toBeCloseTo(3.125, 6);

    // Zoomed out: the same lines are 1.25 px apart, below the draw floor, so
    // they are neither drawn nor snapped — the nearest bar is 0.87 s away.
    store.setState({ zoom: 10 });
    const zoomedOut = snap(3.13);
    expect(zoomedOut.snapped).toBe(false);
    expect(zoomedOut.startTime).toBeCloseTo(3.13, 6);
  });

  it('still snaps to clip edges and the playhead with the grid on', () => {
    enableBarsLane();
    store.setState({
      clips: [clip(), clip({ id: 'clip-2', startTime: 10.3, duration: 1 })],
      playheadPosition: 7.13,
    });

    expect(snap(10.28).startTime).toBeCloseTo(10.3, 6);
    expect(snap(7.1).startTime).toBeCloseTo(7.13, 6);
  });

  it('removing the bars lane turns grid snapping back off', () => {
    const laneId = enableBarsLane();
    expect(laneId).toBe(rulerLaneIdForFormat('bars'));
    expect(snap(3.97).snapped).toBe(true);

    store.getState().removeRulerLane(laneId);
    expect(snap(3.97).snapped).toBe(false);
  });
});
