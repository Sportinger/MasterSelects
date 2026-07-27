import {
  AGENT_TIMELINE_OVERVIEW_INDEX_SCHEMA_VERSION,
  AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
  type AgentTimelineOverviewIndex,
  type AgentTimelineOverviewTileRef,
} from '../../../types/agentTimeline/overview';

export interface CreateOverviewIndexInput {
  sourceId: string;
  timeDomain: AgentTimelineOverviewIndex['timeDomain'];
  stateHash?: string;
  duration: number;
  baseBinDuration: number;
  tileBinCount: number;
  tiles: readonly AgentTimelineOverviewTileRef[];
}

export function createOverviewTileIndex(input: CreateOverviewIndexInput): AgentTimelineOverviewIndex {
  if (!input.sourceId) throw new TypeError('sourceId is required');
  if (!Number.isFinite(input.duration) || input.duration <= 0) throw new RangeError('duration must be positive');
  if (!Number.isFinite(input.baseBinDuration) || input.baseBinDuration <= 0) {
    throw new RangeError('baseBinDuration must be positive');
  }
  if (!Number.isSafeInteger(input.tileBinCount) || input.tileBinCount < 1) {
    throw new RangeError('tileBinCount must be a positive integer');
  }
  const tiles = input.tiles.filter(tile =>
    tile.sourceId === input.sourceId &&
    tile.timeDomain === input.timeDomain &&
    tile.stateHash === input.stateHash &&
    tile.reducerVersion === AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION &&
    tile.tileBinCount === input.tileBinCount &&
    tile.binDuration === input.baseBinDuration * 2 ** tile.level);
  const unique = new Map<string, AgentTimelineOverviewTileRef>();
  for (const tile of tiles.toSorted((left, right) => left.tileId.localeCompare(right.tileId))) {
    const key = `${tile.channel}:${tile.level}:${tile.tileIndex}`;
    if (!unique.has(key)) unique.set(key, tile);
  }
  return {
    schemaVersion: AGENT_TIMELINE_OVERVIEW_INDEX_SCHEMA_VERSION,
    sourceId: input.sourceId,
    timeDomain: input.timeDomain,
    stateHash: input.stateHash,
    duration: input.duration,
    baseBinDuration: input.baseBinDuration,
    tileBinCount: input.tileBinCount,
    reducerVersion: AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
    tiles: Array.from(unique.values()).toSorted((left, right) =>
      left.channel.localeCompare(right.channel) ||
      left.level - right.level ||
      left.tileIndex - right.tileIndex ||
      left.tileId.localeCompare(right.tileId)),
  };
}
