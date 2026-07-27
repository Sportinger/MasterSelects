import type {
  AgentTimelineOverviewTile,
  AgentTimelineOverviewTileRef,
  OverviewTileBuildConfig,
} from '../../../types/agentTimeline/overview';

export function overviewBinDuration(baseBinDuration: number, level: number): number {
  if (!Number.isFinite(baseBinDuration) || baseBinDuration <= 0) {
    throw new RangeError('baseBinDuration must be positive');
  }
  if (!Number.isSafeInteger(level) || level < 0) throw new RangeError('level must be a non-negative integer');
  return baseBinDuration * 2 ** level;
}

export function overviewTileRange(
  config: Pick<OverviewTileBuildConfig, 'baseBinDuration' | 'level' | 'tileIndex' | 'tileBinCount' | 'duration'>,
): { start: number; end: number } {
  if (!Number.isSafeInteger(config.tileIndex) || config.tileIndex < 0) {
    throw new RangeError('tileIndex must be a non-negative integer');
  }
  if (!Number.isSafeInteger(config.tileBinCount) || config.tileBinCount < 1) {
    throw new RangeError('tileBinCount must be a positive integer');
  }
  if (!Number.isFinite(config.duration) || config.duration <= 0) {
    throw new RangeError('duration must be positive');
  }
  const binDuration = overviewBinDuration(config.baseBinDuration, config.level);
  const start = config.tileIndex * config.tileBinCount * binDuration;
  return {
    start,
    end: Math.min(config.duration, start + config.tileBinCount * binDuration),
  };
}

export function overviewTileRef(tile: AgentTimelineOverviewTile): AgentTimelineOverviewTileRef {
  return {
    tileId: tile.tileId,
    sourceId: tile.sourceId,
    channel: tile.channel,
    timeDomain: tile.timeDomain,
    stateHash: tile.stateHash,
    level: tile.level,
    tileIndex: tile.tileIndex,
    binDuration: tile.binDuration,
    tileBinCount: tile.tileBinCount,
    range: { ...tile.range },
    coverage: tile.coverage.map(range => ({ ...range })),
    inputArtifactIds: [...tile.inputArtifactIds],
    reducerVersion: tile.reducerVersion,
  };
}
