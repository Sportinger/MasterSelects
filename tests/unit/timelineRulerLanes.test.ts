import { describe, expect, it } from 'vitest';

import type { TempoMap } from '../../src/types/timeline';
import {
  createBarsLaneTicks,
  createLinearLaneTicks,
} from '../../src/components/timeline/utils/timelineGrid';

const FOUR_FOUR_60: TempoMap = {
  events: [{ time: 0, bpm: 60, numerator: 4, denominator: 4 }],
};

// The component multiplies time * zoom for the pixel position, so these tests
// assert tick times and derive pixels the same way.
const ZOOM = 50;
const pixelOf = (time: number) => time * ZOOM;

describe('createLinearLaneTicks — time lane', () => {
  it('emits ticks with second-based density and labels on majors', () => {
    const ticks = createLinearLaneTicks({
      format: 'time',
      zoom: ZOOM,
      frameRate: 30,
      startTime: 0,
      endTime: 10,
      duration: 60,
      formatTime: (s) => `${s}s`,
    });

    expect(ticks.length).toBeGreaterThan(0);
    // every tick sits on its time; first is the origin
    expect(ticks[0].time).toBe(0);
    // majors carry a label, minors do not
    expect(ticks.every(t => (t.kind === 'major') === (t.label !== null))).toBe(true);
    expect(ticks.some(t => t.kind === 'major')).toBe(true);
  });

  it('keeps a fixed format — never produces frame/timecode labels', () => {
    const ticks = createLinearLaneTicks({
      format: 'time',
      zoom: ZOOM,
      frameRate: 30,
      startTime: 0,
      endTime: 4,
      duration: 60,
      formatTime: (s) => `T${s}`,
    });
    const labels = ticks.filter(t => t.label !== null).map(t => t.label);
    expect(labels.every(l => l!.startsWith('T'))).toBe(true);
  });
});

describe('createLinearLaneTicks — frames lane', () => {
  it('ticks every frame and labels frame numbers when frames resolve', () => {
    // zoom 480 @ 30fps => 16px/frame (resolvable)
    const ticks = createLinearLaneTicks({
      format: 'frames',
      zoom: 480,
      frameRate: 30,
      startTime: 0,
      endTime: 1,
      duration: 60,
      formatTime: (s) => `${s}`,
    });
    // first frame at t=0 labelled "0"
    expect(ticks[0]).toMatchObject({ time: 0, kind: 'major', label: '0' });
    // a minor frame tick exists between labels
    expect(ticks.some(t => t.kind === 'minor')).toBe(true);
  });
});

describe('createBarsLaneTicks — 4/4 @ 60 BPM', () => {
  it('emits bar majors and beat minors at the right pixels', () => {
    const ticks = createBarsLaneTicks({
      tempoMap: FOUR_FOUR_60,
      zoom: ZOOM,
      startTime: 0,
      endTime: 8,
      duration: 60,
    });

    const bars = ticks.filter(t => t.kind === 'major');
    const beats = ticks.filter(t => t.kind === 'minor');

    // Bars land on (N-1)*4s -> pixels 0, 200, 400 ...
    expect(bars.map(t => pixelOf(t.time))).toEqual(expect.arrayContaining([0, 200, 400]));
    // Bar labels are the 1-based bar numbers.
    expect(bars.find(t => t.time === 0)?.label).toBe('1');
    expect(bars.find(t => t.time === 4)?.label).toBe('2');
    // Beats fall on integer seconds (50px apart) and carry no label.
    expect(beats.map(t => pixelOf(t.time))).toEqual(expect.arrayContaining([50, 100, 150]));
    expect(beats.every(t => t.label === null)).toBe(true);
  });

  it('drops beat sub-ticks when zoomed too far out', () => {
    // zoom 2 px/s => beats 2px apart (< MIN_BEAT_TICK_PX) -> bars only
    const ticks = createBarsLaneTicks({
      tempoMap: FOUR_FOUR_60,
      zoom: 2,
      startTime: 0,
      endTime: 40,
      duration: 60,
    });
    expect(ticks.every(t => t.kind === 'major')).toBe(true);
  });
});

describe('time + bars stack', () => {
  it('produces two independent, non-empty tick sets over the same window', () => {
    const window = { startTime: 0, endTime: 8, duration: 60 };
    const time = createLinearLaneTicks({
      format: 'time', zoom: ZOOM, frameRate: 30, formatTime: (s) => `${s}`, ...window,
    });
    const bars = createBarsLaneTicks({ tempoMap: FOUR_FOUR_60, zoom: ZOOM, ...window });
    expect(time.length).toBeGreaterThan(0);
    expect(bars.length).toBeGreaterThan(0);
    // the two formats are independent: bars carry bar-number labels, time does not
    expect(bars.some(t => t.label === '2')).toBe(true);
    expect(time.some(t => t.label === '2')).toBe(false);
  });
});
