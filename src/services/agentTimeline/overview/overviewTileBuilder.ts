import type {
  AgentTimelineChannel,
  AgentTimelineEvent,
  AgentTimelineRange,
} from '../../../types/agentTimeline/manifest';
import {
  AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION,
  AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION,
  type AgentTimelineOverviewBin,
  type AgentTimelineOverviewEvent,
  type AgentTimelineOverviewTile,
  type OverviewCount,
  type OverviewQualitySeverity,
  type OverviewTileBuildConfig,
} from '../../../types/agentTimeline/overview';
import {
  overviewBinDuration,
  overviewTileRange,
} from './overviewTileLayout';

interface BinAccumulator {
  range: AgentTimelineRange;
  pointCount: number;
  intervalCount: number;
  intervalSeconds: number;
  numericMin?: number;
  numericMax?: number;
  numericSum: number;
  numericCount: number;
  severity: OverviewQualitySeverity;
  labels: Map<string, number>;
  categories: Map<string, number>;
  coverageSeconds: number;
}

const SEVERITY_RANK: Record<OverviewQualitySeverity, number> = {
  none: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

function mergeRanges(ranges: readonly AgentTimelineRange[]): readonly AgentTimelineRange[] {
  const ordered = ranges
    .filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: AgentTimelineRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function overlapDuration(left: AgentTimelineRange, right: AgentTimelineRange): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function boundedCounts(counts: Map<string, number>, limit: number): { values: OverviewCount[]; overflow: number } {
  const ordered = Array.from(counts, ([value, count]) => ({ value, count }))
    .toSorted((left, right) => right.count - left.count || left.value.localeCompare(right.value));
  const values = ordered.slice(0, limit);
  return {
    values,
    overflow: ordered.slice(limit).reduce((total, item) => total + item.count, 0),
  };
}

function addCount(counts: Map<string, number>, value: string | undefined): void {
  const normalized = value?.trim();
  if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
}

function addNumeric(bin: BinAccumulator, value: number | undefined): void {
  if (!Number.isFinite(value)) return;
  const numeric = value as number;
  bin.numericMin = bin.numericMin === undefined ? numeric : Math.min(bin.numericMin, numeric);
  bin.numericMax = bin.numericMax === undefined ? numeric : Math.max(bin.numericMax, numeric);
  bin.numericSum += numeric;
  bin.numericCount += 1;
}

function addSeverity(bin: BinAccumulator, severity: OverviewQualitySeverity | undefined): void {
  if (severity && SEVERITY_RANK[severity] > SEVERITY_RANK[bin.severity]) bin.severity = severity;
}

function channelForEvent(event: AgentTimelineEvent): AgentTimelineChannel {
  switch (event.type) {
    case 'cut': return 'cuts';
    case 'shot': return 'shots';
    case 'scene-block': return 'scenes';
    case 'speech': return 'speech';
    case 'speech-marker': return 'speech';
    case 'person-visible': return 'people';
    case 'active-speaker': return 'active-speaker';
    case 'camera-motion': return 'camera-motion';
    case 'audio-activity': return 'audio';
    case 'quality-issue': return 'quality';
    case 'onscreen-text': return 'text';
    case 'duplicate-group': return 'duplicates';
  }
}

/** Normalizes a durable Agent Timeline event into the small overview reducer input. */
export function agentTimelineEventToOverviewEvent(event: AgentTimelineEvent): AgentTimelineOverviewEvent {
  const base = {
    id: event.id,
    channel: channelForEvent(event),
    time: event.time.temporalKind === 'point'
      ? { temporalKind: 'point' as const, time: event.time.time }
      : { temporalKind: 'interval' as const, start: event.time.start, end: event.time.end },
  };
  switch (event.type) {
    case 'cut': return { ...base, numericValue: event.data.score, category: event.data.transition };
    case 'shot': return { ...base, label: event.data.shotId, category: event.data.shotSize ?? event.data.layout };
    case 'scene-block': return { ...base, label: event.data.label ?? event.data.sceneId, category: event.data.boundarySource };
    case 'speech': return { ...base, numericValue: event.data.wordCount, label: event.data.speakerId, category: event.data.language };
    case 'speech-marker': return { ...base, numericValue: event.data.intensity, label: event.data.speakerId, category: event.data.marker };
    case 'person-visible': return { ...base, label: event.data.personId, category: event.data.position };
    case 'active-speaker': return { ...base, label: event.data.personId ?? event.data.speakerId, category: event.data.status };
    case 'camera-motion': return { ...base, numericValue: event.data.magnitude, label: event.data.motion, category: event.data.direction };
    case 'audio-activity': return { ...base, numericValue: event.data.loudnessDb, category: event.data.activity };
    case 'quality-issue': return { ...base, numericValue: event.data.measurement, label: event.data.issue, category: event.data.unit, qualitySeverity: event.data.severity };
    case 'onscreen-text': return { ...base, label: event.data.text, category: event.data.kind };
    case 'duplicate-group': return { ...base, numericValue: event.data.similarity, label: event.data.duplicateGroupId, category: event.data.takeGroupId };
  }
}

export interface OverviewTileBuilder {
  addChunk(events: readonly AgentTimelineOverviewEvent[]): void;
  finish(): AgentTimelineOverviewTile;
}

export function createOverviewTileBuilder(config: OverviewTileBuildConfig): OverviewTileBuilder {
  const range = overviewTileRange(config);
  if (range.end <= range.start) throw new RangeError('tileIndex lies outside the source duration');
  const binDuration = overviewBinDuration(config.baseBinDuration, config.level);
  const binCount = Math.ceil((range.end - range.start) / binDuration);
  const coverage = mergeRanges(config.coverage ?? []);
  const tileCoverage = coverage.flatMap(item => {
    const start = Math.max(range.start, item.start);
    const end = Math.min(range.end, item.end);
    return end > start ? [{ start, end }] : [];
  });
  const bins: BinAccumulator[] = Array.from({ length: binCount }, (_, index) => {
    const binRange = {
      start: range.start + index * binDuration,
      end: Math.min(range.end, range.start + (index + 1) * binDuration),
    };
    return {
      range: binRange,
      pointCount: 0,
      intervalCount: 0,
      intervalSeconds: 0,
      numericSum: 0,
      numericCount: 0,
      severity: 'none',
      labels: new Map(),
      categories: new Map(),
      coverageSeconds: coverage.reduce((total, item) => total + overlapDuration(item, binRange), 0),
    };
  });
  let finished = false;

  const addEventToBin = (event: AgentTimelineOverviewEvent, bin: BinAccumulator, overlap: number): void => {
    if (event.time.temporalKind === 'point') bin.pointCount += 1;
    else {
      bin.intervalCount += 1;
      bin.intervalSeconds += overlap;
    }
    addNumeric(bin, event.numericValue);
    addSeverity(bin, event.qualitySeverity);
    addCount(bin.labels, event.label);
    addCount(bin.categories, event.category);
  };

  return {
    addChunk(events) {
      if (finished) throw new Error('Overview tile builder is already finished');
      for (const event of events) {
        if (event.channel !== config.channel) continue;
        if (event.time.temporalKind === 'point') {
          if (!Number.isFinite(event.time.time) || event.time.time < range.start || event.time.time >= range.end) continue;
          const index = Math.min(binCount - 1, Math.floor((event.time.time - range.start) / binDuration));
          addEventToBin(event, bins[index], 0);
          continue;
        }
        if (!Number.isFinite(event.time.start) || !Number.isFinite(event.time.end) ||
            event.time.end <= event.time.start ||
            event.time.start >= range.end || event.time.end <= range.start) continue;
        const first = Math.max(0, Math.floor((Math.max(range.start, event.time.start) - range.start) / binDuration));
        const lastTime = Math.min(range.end, event.time.end);
        const last = Math.min(binCount - 1, Math.ceil((lastTime - range.start) / binDuration) - 1);
        for (let index = first; index <= last; index += 1) {
          const overlap = overlapDuration(bins[index].range, {
            start: event.time.start,
            end: event.time.end,
          });
          if (overlap > 0) addEventToBin(event, bins[index], overlap);
        }
      }
    },
    finish() {
      if (finished) throw new Error('Overview tile builder is already finished');
      finished = true;
      const maxLabels = Math.max(0, Math.trunc(config.maxLabelCounts ?? 8));
      const maxCategories = Math.max(0, Math.trunc(config.maxCategoryCounts ?? 8));
      const outputBins: AgentTimelineOverviewBin[] = bins.map(bin => {
        const labels = boundedCounts(bin.labels, maxLabels);
        const categories = boundedCounts(bin.categories, maxCategories);
        const duration = bin.range.end - bin.range.start;
        return {
          range: bin.range,
          pointCount: bin.pointCount,
          intervalCount: bin.intervalCount,
          intervalDensity: Math.min(1, bin.intervalSeconds / duration),
          ...(bin.numericCount > 0 ? {
            numeric: {
              min: bin.numericMin!,
              max: bin.numericMax!,
              avg: bin.numericSum / bin.numericCount,
              sampleCount: bin.numericCount,
            },
          } : {}),
          qualitySeverityMax: bin.severity,
          labels: labels.values,
          labelOverflowCount: labels.overflow,
          categories: categories.values,
          categoryOverflowCount: categories.overflow,
          coverage: Math.min(1, bin.coverageSeconds / duration),
        };
      });
      const inputArtifactIds = [...new Set(config.inputArtifactIds)].toSorted();
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
        coverage: tileCoverage,
        inputArtifactIds,
        bins: outputBins,
      };
    },
  };
}

export function buildOverviewTile(
  config: OverviewTileBuildConfig,
  chunks: Iterable<readonly AgentTimelineOverviewEvent[]>,
): AgentTimelineOverviewTile {
  const builder = createOverviewTileBuilder(config);
  for (const chunk of chunks) builder.addChunk(chunk);
  return builder.finish();
}
