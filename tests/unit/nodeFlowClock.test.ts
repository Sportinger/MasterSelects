import { describe, expect, it } from 'vitest';
import { NodeFlowClock } from '../../src/components/panels/nodes/canvas/rendering/NodeFlowClock';

const stopped = { playhead: 0, playing: false, active: false, visible: true, timestamp: 0 };
describe('flow follows transport speed', () => {
  it('scales slow/fast scrubbing proportionally and preserves signal direction when scrubbing backwards', () => {
    const clock = new NodeFlowClock(); clock.update(stopped, 0);
    clock.update({ ...stopped, active: true, playhead: 0.05, timestamp: 100 }, 100);
    expect(clock.rate).toBeCloseTo(0.5); expect(clock.advance(200)).toBeCloseTo(0.05);
    clock.update({ ...stopped, active: true, playhead: 0.25, timestamp: 200 }, 200);
    expect(clock.rate).toBeCloseTo(2); expect(clock.advance(300)).toBeCloseTo(0.25);
    clock.update({ ...stopped, active: true, playhead: 0.15, timestamp: 300 }, 300);
    expect(clock.rate).toBeCloseTo(1); expect(clock.advance(400)).toBeCloseTo(0.35);
  });
  it('holds phase across playback rate changes, doubles travel at 2x, and stops immediately on pause', () => {
    const clock = new NodeFlowClock(); clock.update({ ...stopped, playing: true, active: true, playbackSpeed: 1 }, 0);
    expect(clock.advance(1000)).toBe(1);
    clock.update({ ...stopped, playing: true, active: true, playbackSpeed: -2, playhead: 1 }, 1000);
    expect(clock.advance(2000)).toBe(3);
    clock.update({ ...stopped, playhead: 2, timestamp: 2000 }, 2000);
    expect(clock.advance(5000)).toBe(3);
  });
  it('settles a stationary scrub and resumes without counting hidden/idle time', () => {
    const clock = new NodeFlowClock(); clock.update(stopped, 0);
    clock.update({ ...stopped, active: true, playhead: 0.1, timestamp: 100 }, 100);
    expect(clock.advance(1000)).toBeCloseTo(0.18);
    expect(clock.advance(2000)).toBeCloseTo(0.18);
    clock.update({ ...stopped, playing: true, active: true, visible: false }, 2000);
    expect(clock.advance(4000)).toBeCloseTo(0.18);
  });
  it('uses sample time rather than worker delivery time, ignoring unrelated refreshes', () => {
    const clock = new NodeFlowClock(); clock.update(stopped, 0);
    clock.update({ ...stopped, timestamp: 90 }, 90);
    clock.update({ ...stopped, active: true, playhead: 0.1, timestamp: 100 }, 300);
    expect(clock.rate).toBeCloseTo(1);
  });
});
