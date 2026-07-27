import { describe, expect, it } from 'vitest';
import {
  buildOverviewTile,
  createOverviewTileBuilder,
} from '../../src/services/agentTimeline/overview/overviewTileBuilder';
import { buildOverviewParentTile } from '../../src/services/agentTimeline/overview/overviewPyramidReducer';
import { createOverviewTileIndex } from '../../src/services/agentTimeline/overview/overviewTileIndex';
import {
  getAgentTimelineOverview,
  selectOverviewLevel,
} from '../../src/services/agentTimeline/overview/overviewTileQuery';
import { overviewTileRef } from '../../src/services/agentTimeline/overview/overviewTileLayout';
import type {
  AgentTimelineOverviewEvent,
  AgentTimelineOverviewTile,
  AgentTimelineOverviewTileReader,
  AgentTimelineOverviewTileRef,
  OverviewTileBuildConfig,
} from '../../src/types/agentTimeline/overview';

function config(overrides: Partial<OverviewTileBuildConfig> = {}): OverviewTileBuildConfig {
  return {
    sourceId: 'source-a',
    channel: 'camera-motion',
    timeDomain: 'source',
    level: 0,
    tileIndex: 0,
    baseBinDuration: 1,
    tileBinCount: 4,
    duration: 4,
    inputArtifactIds: ['artifact-a'],
    coverage: [{ start: 0, end: 4 }],
    ...overrides,
  };
}

function point(
  id: string,
  time: number,
  overrides: Partial<AgentTimelineOverviewEvent> = {},
): AgentTimelineOverviewEvent {
  return {
    id,
    channel: 'camera-motion',
    time: { temporalKind: 'point', time },
    ...overrides,
  };
}

class RecordingTileReader implements AgentTimelineOverviewTileReader {
  readonly refs: AgentTimelineOverviewTileRef[] = [];
  private readonly byId: ReadonlyMap<string, AgentTimelineOverviewTile>;

  constructor(tiles: readonly AgentTimelineOverviewTile[]) {
    this.byId = new Map(tiles.map(tile => [tile.tileId, tile]));
  }

  async readTile(ref: AgentTimelineOverviewTileRef): Promise<AgentTimelineOverviewTile> {
    this.refs.push(ref);
    const tile = this.byId.get(ref.tileId);
    if (!tile) throw new Error(`missing ${ref.tileId}`);
    return tile;
  }
}

describe('Agent Timeline overview tile pyramid', () => {
  it('selects the finest level that is at least one visible pixel wide', () => {
    const refs = [0, 1, 2, 3].map(level => overviewTileRef(buildOverviewTile(
      config({
        level,
        duration: 64,
        tileBinCount: 16,
        coverage: [{ start: 0, end: 64 }],
      }),
      [],
    )));

    expect(selectOverviewLevel(refs, 64, 16)).toEqual({ level: 2, binDuration: 4 });
    expect(selectOverviewLevel(refs, 8, 32)).toEqual({ level: 0, binDuration: 1 });
  });

  it('preserves extrema, weighted averages, severity and bounded counts in parent tiles', () => {
    const child = buildOverviewTile(config({ maxLabelCounts: 2 }), [[
      point('a', .2, { numericValue: -5, label: 'A', qualitySeverity: 'info' }),
      point('b', .4, { numericValue: 5, label: 'B', qualitySeverity: 'critical' }),
      point('c', 1.2, { numericValue: 10, label: 'C', qualitySeverity: 'warning' }),
    ]]);
    const parent = buildOverviewParentTile(config({
      level: 1,
      duration: 8,
      maxLabelCounts: 2,
    }), [child]);

    expect(parent.bins[0].numeric).toMatchObject({
      min: -5,
      max: 10,
      avg: 10 / 3,
      sampleCount: 3,
    });
    expect(parent.bins[0].qualitySeverityMax).toBe('critical');
    expect(parent.bins[0].labels).toEqual([
      { value: 'A', count: 1 },
      { value: 'B', count: 1 },
    ]);
    expect(parent.bins[0].labelOverflowCount).toBe(1);
  });

  it('uses half-open point boundaries and interval density without double bins', () => {
    const tile = buildOverviewTile(config(), [[
      point('start', 0),
      point('boundary', 1),
      point('last', 3.999),
      point('excluded-end', 4),
      {
        id: 'interval',
        channel: 'camera-motion',
        time: { temporalKind: 'interval', start: .5, end: 1.5 },
      },
      {
        id: 'after',
        channel: 'camera-motion',
        time: { temporalKind: 'interval', start: 4, end: 5 },
      },
    ]]);

    expect(tile.bins.map(bin => bin.pointCount)).toEqual([1, 1, 0, 1]);
    expect(tile.bins.map(bin => bin.intervalCount)).toEqual([1, 1, 0, 0]);
    expect(tile.bins.slice(0, 2).map(bin => bin.intervalDensity)).toEqual([.5, .5]);
  });

  it('builds deterministically from chunks without retaining raw events', () => {
    const events = [
      point('c', 2.5, { numericValue: 3, category: 'right' }),
      point('a', .5, { numericValue: 1, category: 'left' }),
      point('b', 1.5, { numericValue: 2, category: 'left' }),
    ];
    const first = createOverviewTileBuilder(config({ inputArtifactIds: ['b', 'a'] }));
    first.addChunk(events.slice(0, 1));
    first.addChunk(events.slice(1));
    const second = createOverviewTileBuilder(config({ inputArtifactIds: ['a', 'b'] }));
    second.addChunk(events.toReversed());

    expect(first.finish()).toEqual(second.finish());
  });

  it('keeps dense event responses and label/category summaries bounded', async () => {
    const duration = 3_600;
    const dense = Array.from({ length: 10_000 }, (_, index) =>
      point(`p-${index}`, index / 10_000 * duration, {
        numericValue: index % 100,
        label: `person-${index % 20}`,
        category: `kind-${index % 12}`,
      }));
    const tiles = Array.from({ length: 4 }, (_, tileIndex) => buildOverviewTile(config({
      level: 6,
      tileIndex,
      tileBinCount: 16,
      duration,
      maxLabelCounts: 4,
      maxCategoryCounts: 3,
      coverage: [{ start: 0, end: duration }],
    }), [dense]));
    const index = createOverviewTileIndex({
      sourceId: 'source-a',
      timeDomain: 'source',
      duration,
      baseBinDuration: 1,
      tileBinCount: 16,
      tiles: tiles.map(overviewTileRef),
    });
    const reader = new RecordingTileReader(tiles);
    const result = await getAgentTimelineOverview(index, reader, {
      start: 0,
      end: duration,
      pixelWidth: 100,
      channels: ['camera-motion'],
    });

    expect(result.channels[0].bins.length).toBeLessThanOrEqual(102);
    expect(reader.refs.length).toBeLessThanOrEqual(Math.ceil(100 / 16) + 2);
    expect(result.channels[0].bins.every(bin => bin.labels.length <= 4)).toBe(true);
    expect(result.channels[0].bins.every(bin => bin.categories.length <= 3)).toBe(true);
    expect(result.channels[0].bins.some(bin => bin.labelOverflowCount > 0)).toBe(true);
  });

  it('returns exact partial tile coverage and reads only overlapping tiles', async () => {
    const first = buildOverviewTile(config({
      tileIndex: 0,
      tileBinCount: 2,
      duration: 8,
      coverage: [{ start: 0, end: 2 }],
    }), []);
    const second = buildOverviewTile(config({
      tileIndex: 1,
      tileBinCount: 2,
      duration: 8,
      coverage: [{ start: 3, end: 4 }],
    }), []);
    const outside = buildOverviewTile(config({
      tileIndex: 2,
      tileBinCount: 2,
      duration: 8,
      coverage: [{ start: 4, end: 6 }],
    }), []);
    const tiles = [first, second, outside];
    const index = createOverviewTileIndex({
      sourceId: 'source-a',
      timeDomain: 'source',
      duration: 8,
      baseBinDuration: 1,
      tileBinCount: 2,
      tiles: tiles.map(overviewTileRef),
    });
    const reader = new RecordingTileReader(tiles);
    const result = await getAgentTimelineOverview(index, reader, {
      start: 1,
      end: 4,
      pixelWidth: 4,
      channels: ['camera-motion'],
    });

    expect(reader.refs.map(ref => ref.tileIndex)).toEqual([0, 1]);
    expect(result.channels[0].covered).toEqual([{ start: 1, end: 2 }, { start: 3, end: 4 }]);
    expect(result.channels[0].missing).toEqual([{ start: 2, end: 3 }]);
    expect(result.channels[0].bins.map(bin => bin.coverage)).toEqual([1, 0, 1]);
  });
});
