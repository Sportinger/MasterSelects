import { describe, expect, it } from 'vitest';
import {
  binAnalysisOverviewEvents,
  coalesceAnalysisOverviewEvents,
  findAnalysisOverviewEventAtTime,
  getAnalysisOverviewCanvasSize,
} from '../../src/components/panels/properties/analysisWorkspace/analysisOverviewTypes';
import {
  binAnalysisOverviewSeries,
  buildAnalysisOverviewBandRuns,
  buildAnalysisOverviewLayout,
  buildAnalysisOverviewRenderModel,
  computeAnalysisOverviewTicks,
} from '../../src/components/panels/properties/analysisWorkspace/analysisOverviewBins';

function fullLanes() {
  return {
    scenes: [{ id: 'scene', start: 0, end: 10, label: 'Scene 1' }],
    cuts: [{ id: 'cut', start: 5 }],
    speech: [{ id: 'speech', start: 1, end: 2 }],
    people: [{ id: 'person', start: 1, end: 3 }],
    motion: [{ id: 'motion', start: 0, end: 4, score: 0.5 }],
    focus: [{ id: 'focus', start: 0, end: 10, score: 0.9 }],
    quality: [{ id: 'quality', start: 0, end: 10, score: 0.4 }],
    audio: [{ id: 'audio', start: 2, end: 8, score: 0.7 }],
    markers: [{ id: 'marker', start: 3, score: 0.8 }],
    text: [{ id: 'text', start: 4, end: 6 }],
  };
}

describe('analysis overview model', () => {
  it('bins ranges half-open while preserving point events', () => {
    const bins = binAnalysisOverviewEvents([
      { id: 'range', start: 101, end: 104, score: 0.5 },
      { id: 'point', start: 102, score: 1 },
      { id: 'ignored', start: Number.NaN },
    ], 8, 8, 100);

    expect(bins).toHaveLength(8);
    expect(bins[1]).toMatchObject({ eventCount: 1, averageScore: 0.5 });
    expect(bins[2]).toMatchObject({ eventCount: 2, averageScore: 0.75 });
    expect(bins[3]).toMatchObject({ eventCount: 1, averageScore: 0.5 });
    expect(bins[4]).toMatchObject({ eventCount: 0, averageScore: null });
  });

  it('clips events to a non-zero source window and excludes its half-open end', () => {
    const bins = binAnalysisOverviewEvents([
      { id: 'before', start: 9 },
      { id: 'first', start: 10 },
      { id: 'last-range', start: 13, end: 14 },
      { id: 'at-end', start: 14 },
    ], 4, 4, 10);

    expect(bins.map((bin) => bin.eventCount)).toEqual([1, 0, 0, 1]);
  });

  it('finds point events separately and treats range ends as exclusive', () => {
    const events = [
      { id: 'range', start: 10, end: 12 },
      { id: 'cut', start: 12 },
    ];

    expect(findAnalysisOverviewEventAtTime(events, 11.999)?.id).toBe('range');
    expect(findAnalysisOverviewEventAtTime(events, 12)?.id).toBe('cut');
    expect(findAnalysisOverviewEventAtTime([events[0]], 12)).toBeUndefined();
    expect(findAnalysisOverviewEventAtTime([events[1]], 12.02, 0.03)?.id).toBe('cut');
  });

  it('coalesces dense scene targets and retains selection identities', () => {
    const scenes = Array.from({ length: 100 }, (_, index) => ({
      id: `scene-${index}`,
      start: 101 + index / 1000,
      label: `Scene ${index}`,
    }));
    const result = coalesceAnalysisOverviewEvents(scenes, 10, 20, 100);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ eventCount: 100, sourceEvent: scenes[0] });
    expect(result[0]?.sourceEventIds).toContain('scene-99');
  });

  it('clamps high-DPR backing stores and bin widths to the Mesa-safe maximum', () => {
    const size = getAnalysisOverviewCanvasSize(9000, 3000, 3);
    const bins = binAnalysisOverviewEvents([], 10, 50_000);

    expect(size.backingWidth).toBeLessThanOrEqual(8192);
    expect(size.backingHeight).toBeLessThanOrEqual(8192);
    expect(size.devicePixelRatio).toBeLessThanOrEqual(8192 / 9000);
    expect(bins).toHaveLength(8192);
  });
});

describe('binAnalysisOverviewSeries', () => {
  it('tracks exact averages plus per-pixel extremes as events start and end', () => {
    const bins = binAnalysisOverviewSeries([
      { id: 'low', start: 100, end: 104, score: 0.2 },
      { id: 'high', start: 102, end: 103, score: 0.8 },
      { id: 'point', start: 106, score: 0.5 },
      { id: 'unscored', start: 108, end: 110 },
    ], 10, 10, 100);

    expect(bins).toHaveLength(10);
    expect(bins[0]).toMatchObject({ count: 1, average: 0.2, min: 0.2, max: 0.2 });
    expect(bins[2]).toMatchObject({ count: 2, average: 0.5, min: 0.2, max: 0.8 });
    // The high event expires: max must fall back without a rescan of all events.
    expect(bins[3]).toMatchObject({ count: 1, max: 0.2 });
    expect(bins[3]?.average).toBeCloseTo(0.2, 10);
    expect(bins[4]).toMatchObject({ count: 0, average: null, min: null, max: null });
    expect(bins[6]?.count).toBe(1);
    expect(bins[6]?.average).toBeCloseTo(0.5, 2);
    expect(bins[6]?.min).toBeCloseTo(0.5, 2);
    expect(bins[9]).toMatchObject({ count: 1, average: null, min: null, max: null });
  });

  it('fills every interior pixel of a broad interval from its two boundaries', () => {
    const bins = binAnalysisOverviewSeries([{ id: 'wide', start: 0, end: 50, score: 1 }], 50, 50);

    expect(bins[0]).toMatchObject({ count: 1, average: 1, min: 1, max: 1 });
    expect(bins[25]).toMatchObject({ count: 1, average: 1, min: 1, max: 1 });
    expect(bins[49]).toMatchObject({ count: 1, average: 1, min: 1, max: 1 });
  });

  it('normalises reversed ranges, invalid events, and unusable durations', () => {
    const reversed = binAnalysisOverviewSeries([
      { id: 'reversed', start: 4, end: 1, score: 0.4 },
      { id: 'nan', start: Number.NaN, score: 1 },
    ], 8, 8);
    const unusable = binAnalysisOverviewSeries([{ id: 'x', start: 0, score: 1 }], 0, 5);

    expect(reversed[0]?.count).toBe(0);
    expect(reversed[1]).toMatchObject({ count: 1, average: 0.4 });
    expect(reversed[3]).toMatchObject({ count: 1, average: 0.4 });
    expect(reversed[4]?.count).toBe(0);
    expect(unusable).toHaveLength(5);
    expect(unusable[0]).toMatchObject({ count: 0, average: null, min: null, max: null });
  });
});

describe('buildAnalysisOverviewBandRuns', () => {
  it('merges covered pixels into runs with peak counts and mean scores', () => {
    const runs = buildAnalysisOverviewBandRuns(binAnalysisOverviewEvents([
      { id: 'x', start: 0, end: 3, score: 0.5 },
      { id: 'y', start: 1, end: 3 },
      { id: 'z', start: 6, end: 7, score: 1 },
    ], 8, 8));

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ startPixel: 0, endPixel: 2, peakCount: 2, meanScore: 0.5 });
    expect(runs[1]).toMatchObject({ startPixel: 6, endPixel: 6, peakCount: 1, meanScore: 1 });
  });

  it('returns nothing for empty coverage', () => {
    expect(buildAnalysisOverviewBandRuns(binAnalysisOverviewEvents([], 8, 8))).toEqual([]);
  });
});

describe('computeAnalysisOverviewTicks', () => {
  it('picks round steps near one tick per 72px', () => {
    expect(computeAnalysisOverviewTicks(0, 225, 400).map((tick) => tick.time))
      .toEqual([60, 120, 180]);
  });

  it('aligns ticks to absolute source time, not the window origin', () => {
    expect(computeAnalysisOverviewTicks(100, 10, 400).map((tick) => tick.time))
      .toEqual([102, 104, 106, 108]);
    expect(computeAnalysisOverviewTicks(95, 10, 400).map((tick) => tick.time))
      .toEqual([96, 98, 100, 102, 104]);
  });

  it('keeps ticks strictly inside the window with ascending fractions', () => {
    const ticks = computeAnalysisOverviewTicks(0, 10, 400);

    expect(ticks.map((tick) => tick.time)).toEqual([2, 4, 6, 8]);
    ticks.forEach((tick, index) => {
      expect(tick.fraction).toBeGreaterThan(0);
      expect(tick.fraction).toBeLessThan(1);
      if (index > 0) expect(tick.fraction).toBeGreaterThan(ticks[index - 1].fraction);
    });
  });

  it('extends to hour multiples and rejects unusable inputs', () => {
    expect(computeAnalysisOverviewTicks(0, 36_000, 300).map((tick) => tick.time))
      .toEqual([10_800, 21_600, 32_400]);
    expect(computeAnalysisOverviewTicks(0, 0, 400)).toEqual([]);
    expect(computeAnalysisOverviewTicks(0, 10, 0)).toEqual([]);
    expect(computeAnalysisOverviewTicks(0, Number.NaN, 400)).toEqual([]);
  });
});

describe('buildAnalysisOverviewLayout', () => {
  it('stacks structure, the shared metrics plot, and presence rows in order', () => {
    const layout = buildAnalysisOverviewLayout(fullLanes());

    expect(layout.scenes).toEqual({ top: 0, height: 20 });
    expect(layout.cuts).toEqual({ top: 20, height: 11 });
    expect(layout.metrics).toMatchObject({ top: 38, height: 62 });
    expect(layout.metrics?.lanes).toEqual(['motion', 'focus', 'quality']);
    expect(layout.presence.map((row) => row.lane)).toEqual(['speech', 'people', 'audio', 'markers', 'text']);
    const tops = layout.presence.map((row) => row.top);
    expect(tops).toEqual([...tops].sort((left, right) => left - right));
    expect(layout.height).toBe(193);
    expect(layout.present).toHaveLength(10);
    expect(layout.missing).toEqual([]);
  });

  it('lets the metrics plot absorb an explicit graph-height target', () => {
    const layout = buildAnalysisOverviewLayout(fullLanes(), { graphHeight: 180 });

    expect(layout.height).toBe(180);
    expect(layout.metrics?.height).toBe(49);
    expect(layout.presence.at(-1)!.top + layout.presence.at(-1)!.height).toBe(180);
  });

  it('drops empty lanes and reports them as missing instead of faking rows', () => {
    const lanes = { ...fullLanes(), motion: [], audio: [], text: undefined };
    const layout = buildAnalysisOverviewLayout(lanes);

    expect(layout.metrics?.lanes).toEqual(['focus', 'quality']);
    expect(layout.presence.map((row) => row.lane)).toEqual(['speech', 'people', 'markers']);
    expect(layout.missing).toEqual(['motion', 'audio', 'text']);
  });

  it('handles structure-only and fully empty inputs honestly', () => {
    const structureOnly = buildAnalysisOverviewLayout({
      scenes: fullLanes().scenes,
      cuts: fullLanes().cuts,
    }, { graphHeight: 180 });
    const empty = buildAnalysisOverviewLayout({});

    expect(structureOnly.height).toBe(31);
    expect(structureOnly.metrics).toBeUndefined();
    expect(empty.height).toBe(24);
    expect(empty.present).toEqual([]);
    expect(empty.missing).toHaveLength(10);
  });

  it('compacts row heights for narrow panels', () => {
    const layout = buildAnalysisOverviewLayout(fullLanes(), { compact: true });

    expect(layout.compact).toBe(true);
    expect(layout.scenes).toEqual({ top: 0, height: 16 });
    expect(layout.height).toBe(153);
  });
});

describe('buildAnalysisOverviewRenderModel', () => {
  it('bounds every derived series to the clamped viewport width', () => {
    const model = buildAnalysisOverviewRenderModel(
      { startTime: 100, duration: 10, lanes: fullLanes() },
      50_000,
    );

    expect(model.width).toBe(8192);
    expect(model.envelopes.get('motion')).toHaveLength(8192);
    expect(model.audio).toHaveLength(8192);
    expect(model.markers).toHaveLength(8192);
    expect(model.cuts).toHaveLength(8192);
  });

  it('derives per-form data only for lanes that are present', () => {
    const model = buildAnalysisOverviewRenderModel({
      duration: 10,
      lanes: {
        scenes: [{ id: 'scene', start: 0, end: 10, label: 'Scene 1' }],
        speech: [{ id: 'word', start: 1, end: 2 }],
      },
    }, 400);

    expect(model.scenes).toHaveLength(1);
    expect(model.cuts).toEqual([]);
    expect(model.envelopes.size).toBe(0);
    expect(model.audio).toBeNull();
    expect(model.markers).toEqual([]);
    expect([...model.bands.keys()]).toEqual(['speech']);
    expect(model.bands.get('speech')?.[0]).toMatchObject({ startPixel: 40, endPixel: 79 });
    expect(model.ticks.map((tick) => tick.time)).toEqual([2, 4, 6, 8]);
  });

  it('bins marker point events as confidence-scaled needles', () => {
    const model = buildAnalysisOverviewRenderModel({
      duration: 10,
      lanes: { markers: [{ id: 'breath', start: 2, label: 'breath', score: 0.75 }] },
    }, 10);

    expect(model.layout.presence.map(row => row.lane)).toEqual(['markers']);
    expect(model.markers[2]).toMatchObject({ eventCount: 1, averageScore: 0.75 });
    expect(model.bands.has('markers')).toBe(false);
  });
});
