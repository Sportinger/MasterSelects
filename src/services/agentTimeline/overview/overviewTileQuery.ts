import type {
  AgentTimelineChannel,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import {
  AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
  AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION,
  type AgentTimelineOverviewBin,
  type AgentTimelineOverviewChannelResult,
  type AgentTimelineOverviewIndex,
  type AgentTimelineOverviewQuery,
  type AgentTimelineOverviewResponse,
  type AgentTimelineOverviewTile,
  type AgentTimelineOverviewTileReader,
  type AgentTimelineOverviewTileRef,
} from '../../../types/agentTimeline/overview';

function overlaps(left: AgentTimelineRange, right: AgentTimelineRange): boolean {
  return left.start < right.end && left.end > right.start;
}

function mergeRanges(ranges: readonly AgentTimelineRange[]): readonly AgentTimelineRange[] {
  const ordered = ranges
    .filter(range => range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function clipped(range: AgentTimelineRange, query: AgentTimelineRange): AgentTimelineRange | undefined {
  const start = Math.max(range.start, query.start);
  const end = Math.min(range.end, query.end);
  return end > start ? { start, end } : undefined;
}

function missingRanges(
  query: AgentTimelineRange,
  coverage: readonly AgentTimelineRange[],
): readonly AgentTimelineRange[] {
  const missing: AgentTimelineRange[] = [];
  let cursor = query.start;
  for (const range of mergeRanges(coverage)) {
    if (cursor < range.start) missing.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < query.end) missing.push({ start: cursor, end: query.end });
  return missing;
}

/**
 * Chooses the finest available level whose bins are no narrower than one
 * viewport pixel. That guarantees a bounded response while preserving the
 * most detail that can still be displayed.
 */
export function selectOverviewLevel(
  refs: readonly AgentTimelineOverviewTileRef[],
  visibleDuration: number,
  pixelWidth: number,
): { level: number; binDuration: number } | undefined {
  if (!Number.isFinite(visibleDuration) || visibleDuration <= 0 ||
      !Number.isFinite(pixelWidth) || pixelWidth < 1) return undefined;
  const target = visibleDuration / Math.max(1, Math.floor(pixelWidth));
  const levels = Array.from(new Map(refs.map(ref => [ref.level, ref.binDuration])).entries())
    .map(([level, binDuration]) => ({ level, binDuration }))
    .toSorted((left, right) => left.binDuration - right.binDuration || left.level - right.level);
  return levels.find(item => item.binDuration >= target) ?? levels.at(-1);
}

function validTile(tile: AgentTimelineOverviewTile, ref: AgentTimelineOverviewTileRef): boolean {
  return tile.schemaVersion === AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION &&
    tile.reducerVersion === AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION &&
    tile.tileId === ref.tileId &&
    tile.sourceId === ref.sourceId &&
    tile.channel === ref.channel &&
    tile.timeDomain === ref.timeDomain &&
    tile.stateHash === ref.stateHash &&
    tile.level === ref.level &&
    tile.tileIndex === ref.tileIndex;
}

async function queryChannel(
  index: AgentTimelineOverviewIndex,
  reader: AgentTimelineOverviewTileReader,
  channel: AgentTimelineChannel,
  queryRange: AgentTimelineRange,
  pixelWidth: number,
): Promise<AgentTimelineOverviewChannelResult> {
  const channelRefs = index.tiles.filter(ref => ref.channel === channel);
  const selectedLevel = selectOverviewLevel(
    channelRefs,
    queryRange.end - queryRange.start,
    pixelWidth,
  );
  if (!selectedLevel) {
    return {
      channel,
      level: 0,
      binDuration: index.baseBinDuration,
      bins: [],
      tileIds: [],
      covered: [],
      missing: [queryRange],
    };
  }
  if (selectedLevel.binDuration < (queryRange.end - queryRange.start) / pixelWidth) {
    throw new RangeError(`Overview pyramid for ${channel} lacks a sufficiently coarse level`);
  }
  const refs = channelRefs
    .filter(ref => ref.level === selectedLevel.level && overlaps(ref.range, queryRange))
    .toSorted((left, right) => left.tileIndex - right.tileIndex || left.tileId.localeCompare(right.tileId));
  const tiles = await Promise.all(refs.map(ref => reader.readTile(ref)));
  for (let index = 0; index < tiles.length; index += 1) {
    if (!validTile(tiles[index], refs[index])) {
      throw new TypeError(`Overview reader returned a tile that does not match ${refs[index].tileId}`);
    }
  }
  const bins: AgentTimelineOverviewBin[] = tiles
    .flatMap(tile => tile.bins)
    .filter(bin => overlaps(bin.range, queryRange))
    .toSorted((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  const maximumBins = Math.ceil(pixelWidth) + 2;
  if (bins.length > maximumBins) {
    throw new RangeError(`Overview level ${selectedLevel.level} exceeds the viewport bin budget`);
  }
  const covered = mergeRanges(tiles.flatMap(tile => tile.coverage)
    .map(range => clipped(range, queryRange))
    .filter((range): range is AgentTimelineRange => range !== undefined));
  return {
    channel,
    level: selectedLevel.level,
    binDuration: selectedLevel.binDuration,
    bins,
    tileIds: tiles.map(tile => tile.tileId),
    covered,
    missing: missingRanges(queryRange, covered),
  };
}

export async function getAgentTimelineOverview(
  index: AgentTimelineOverviewIndex,
  reader: AgentTimelineOverviewTileReader,
  query: AgentTimelineOverviewQuery,
): Promise<AgentTimelineOverviewResponse> {
  if (!Number.isFinite(query.start) || !Number.isFinite(query.end) ||
      query.start < 0 || query.end <= query.start) {
    throw new RangeError('Overview query requires a non-negative half-open range');
  }
  if (!Number.isFinite(query.pixelWidth) || query.pixelWidth < 1) {
    throw new RangeError('pixelWidth must be positive');
  }
  const queryRange = { start: query.start, end: query.end };
  const channels = [...new Set(query.channels)].toSorted();
  const results = await Promise.all(channels.map(channel =>
    queryChannel(index, reader, channel, queryRange, Math.floor(query.pixelWidth))));
  return {
    schemaVersion: 'agent-timeline-overview-response/v1',
    sourceId: index.sourceId,
    timeDomain: index.timeDomain,
    stateHash: index.stateHash,
    start: query.start,
    end: query.end,
    pixelWidth: Math.floor(query.pixelWidth),
    channels: results,
  };
}
