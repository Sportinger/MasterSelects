import {
  AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
  AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION,
  type AgentTimelineOverviewBin,
  type AgentTimelineOverviewTile,
  type OverviewCount,
  type OverviewQualitySeverity,
  type OverviewTileBuildConfig,
} from '../../../types/agentTimeline/overview';
import {
  overviewBinDuration,
  overviewTileRange,
} from './overviewTileLayout';

const SEVERITY_RANK: Record<OverviewQualitySeverity, number> = {
  none: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function overlap(start: number, end: number, bin: AgentTimelineOverviewBin): number {
  return Math.max(0, Math.min(end, bin.range.end) - Math.max(start, bin.range.start));
}

function addCounts(target: Map<string, number>, counts: readonly OverviewCount[]): void {
  for (const item of counts) target.set(item.value, (target.get(item.value) ?? 0) + item.count);
}

function mergeRanges(ranges: readonly { start: number; end: number }[]): readonly { start: number; end: number }[] {
  const ordered = ranges
    .filter(range => range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: { start: number; end: number }[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function boundedCounts(counts: Map<string, number>, limit: number): { values: OverviewCount[]; overflow: number } {
  const ordered = Array.from(counts, ([value, count]) => ({ value, count }))
    .toSorted((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  return {
    values: ordered.slice(0, limit),
    overflow: ordered.slice(limit).reduce((total, item) => total + item.count, 0),
  };
}

function reduceBin(
  start: number,
  end: number,
  children: readonly AgentTimelineOverviewBin[],
  maxLabels: number,
  maxCategories: number,
): AgentTimelineOverviewBin {
  const labels = new Map<string, number>();
  const categories = new Map<string, number>();
  let labelOverflowCount = 0;
  let categoryOverflowCount = 0;
  let pointCount = 0;
  let intervalCount = 0;
  let intervalSeconds = 0;
  let numericMin: number | undefined;
  let numericMax: number | undefined;
  let numericSum = 0;
  let numericCount = 0;
  let severity: OverviewQualitySeverity = 'none';
  let coverageSeconds = 0;

  for (const child of children) {
    const shared = overlap(start, end, child);
    if (shared <= 0) continue;
    const childDuration = child.range.end - child.range.start;
    const fraction = childDuration > 0 ? shared / childDuration : 0;
    pointCount += child.pointCount;
    intervalCount += child.intervalCount;
    intervalSeconds += child.intervalDensity * shared;
    coverageSeconds += child.coverage * shared;
    if (child.numeric) {
      numericMin = numericMin === undefined ? child.numeric.min : Math.min(numericMin, child.numeric.min);
      numericMax = numericMax === undefined ? child.numeric.max : Math.max(numericMax, child.numeric.max);
      numericSum += child.numeric.avg * child.numeric.sampleCount * fraction;
      numericCount += child.numeric.sampleCount * fraction;
    }
    if (SEVERITY_RANK[child.qualitySeverityMax] > SEVERITY_RANK[severity]) {
      severity = child.qualitySeverityMax;
    }
    addCounts(labels, child.labels);
    addCounts(categories, child.categories);
    labelOverflowCount += child.labelOverflowCount;
    categoryOverflowCount += child.categoryOverflowCount;
  }
  const outputLabels = boundedCounts(labels, maxLabels);
  const outputCategories = boundedCounts(categories, maxCategories);
  const duration = end - start;
  return {
    range: { start, end },
    pointCount,
    intervalCount,
    intervalDensity: Math.min(1, intervalSeconds / duration),
    ...(numericCount > 0 ? {
      numeric: {
        min: numericMin!,
        max: numericMax!,
        avg: numericSum / numericCount,
        sampleCount: numericCount,
      },
    } : {}),
    qualitySeverityMax: severity,
    labels: outputLabels.values,
    labelOverflowCount: labelOverflowCount + outputLabels.overflow,
    categories: outputCategories.values,
    categoryOverflowCount: categoryOverflowCount + outputCategories.overflow,
    coverage: Math.min(1, coverageSeconds / duration),
  };
}

/**
 * Builds a coarser tile solely from lower-level tiles. Adjacent bin extrema,
 * weighted averages, density and partial coverage remain available.
 */
export function buildOverviewParentTile(
  config: OverviewTileBuildConfig,
  childTiles: readonly AgentTimelineOverviewTile[],
): AgentTimelineOverviewTile {
  if (config.level <= 0) throw new RangeError('Parent overview tiles require level > 0');
  const range = overviewTileRange(config);
  const candidates = childTiles.filter(tile =>
    tile.sourceId === config.sourceId &&
    tile.channel === config.channel &&
    tile.timeDomain === config.timeDomain &&
    tile.stateHash === config.stateHash &&
    tile.level < config.level &&
    tile.range.start < range.end &&
    tile.range.end > range.start);
  const childLevel = Math.max(-1, ...candidates.map(tile => tile.level));
  const compatible = candidates.filter(tile => tile.level === childLevel);
  const childBins = compatible
    .flatMap(tile => tile.bins)
    .filter(bin => bin.range.start < range.end && bin.range.end > range.start)
    .toSorted((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
  const binDuration = overviewBinDuration(config.baseBinDuration, config.level);
  const binCount = Math.ceil((range.end - range.start) / binDuration);
  const maxLabels = Math.max(0, Math.trunc(config.maxLabelCounts ?? 8));
  const maxCategories = Math.max(0, Math.trunc(config.maxCategoryCounts ?? 8));
  const bins = Array.from({ length: binCount }, (_, index) => {
    const start = range.start + index * binDuration;
    const end = Math.min(range.end, start + binDuration);
    return reduceBin(start, end, childBins, maxLabels, maxCategories);
  });
  const inputArtifactIds = [...new Set([
    ...config.inputArtifactIds,
    ...compatible.flatMap(tile => tile.inputArtifactIds),
  ])].toSorted();
  const key = JSON.stringify([
    AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
    config.sourceId,
    config.channel,
    config.timeDomain,
    config.stateHash ?? null,
    config.level,
    config.tileIndex,
    config.baseBinDuration,
    config.tileBinCount,
    config.duration,
    maxLabels,
    maxCategories,
    inputArtifactIds,
  ]);
  return {
    schemaVersion: AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION,
    reducerVersion: AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
    tileId: `overview-${stableHash(key)}`,
    sourceId: config.sourceId,
    channel: config.channel,
    timeDomain: config.timeDomain,
    stateHash: config.stateHash,
    level: config.level,
    tileIndex: config.tileIndex,
    binDuration,
    tileBinCount: config.tileBinCount,
    range,
    coverage: mergeRanges(compatible.flatMap(tile => tile.coverage).flatMap(item => {
      const start = Math.max(range.start, item.start);
      const end = Math.min(range.end, item.end);
      return end > start ? [{ start, end }] : [];
    })),
    inputArtifactIds,
    bins,
  };
}
