import type {
  AgentTimelineChannel,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
} from './manifest';

export const AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION =
  'agent-timeline-overview-tile/v1' as const;
export const AGENT_TIMELINE_OVERVIEW_INDEX_SCHEMA_VERSION =
  'agent-timeline-overview-index/v1' as const;
export const AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION = 'overview-reducer/v1' as const;

export type OverviewQualitySeverity = 'none' | 'info' | 'warning' | 'critical';

export interface OverviewCount {
  value: string;
  count: number;
}

export interface OverviewNumericSummary {
  min: number;
  max: number;
  avg: number;
  sampleCount: number;
}

export interface AgentTimelineOverviewBin {
  range: AgentTimelineRange;
  pointCount: number;
  intervalCount: number;
  /** Summed interval occupancy, clamped to 0..1 for display. */
  intervalDensity: number;
  numeric?: OverviewNumericSummary;
  qualitySeverityMax: OverviewQualitySeverity;
  labels: readonly OverviewCount[];
  labelOverflowCount: number;
  categories: readonly OverviewCount[];
  categoryOverflowCount: number;
  /** Fraction of this bin covered by compatible input artifacts. */
  coverage: number;
}

export interface AgentTimelineOverviewTile {
  schemaVersion: typeof AGENT_TIMELINE_OVERVIEW_TILE_SCHEMA_VERSION;
  reducerVersion: typeof AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION;
  tileId: string;
  sourceId: string;
  channel: AgentTimelineChannel;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  level: number;
  tileIndex: number;
  binDuration: number;
  tileBinCount: number;
  range: AgentTimelineRange;
  coverage: readonly AgentTimelineRange[];
  inputArtifactIds: readonly string[];
  bins: readonly AgentTimelineOverviewBin[];
}

export interface AgentTimelineOverviewTileRef {
  tileId: string;
  sourceId: string;
  channel: AgentTimelineChannel;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  level: number;
  tileIndex: number;
  binDuration: number;
  tileBinCount: number;
  range: AgentTimelineRange;
  coverage: readonly AgentTimelineRange[];
  inputArtifactIds: readonly string[];
  reducerVersion: typeof AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION;
}

export interface AgentTimelineOverviewIndex {
  schemaVersion: typeof AGENT_TIMELINE_OVERVIEW_INDEX_SCHEMA_VERSION;
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  duration: number;
  baseBinDuration: number;
  tileBinCount: number;
  reducerVersion: typeof AGENT_TIMELINE_OVERVIEW_REDUCER_VERSION;
  tiles: readonly AgentTimelineOverviewTileRef[];
}

export type OverviewEventTime =
  | { temporalKind: 'point'; time: number }
  | { temporalKind: 'interval'; start: number; end: number };

/** Minimal normalized input; callers can stream these without retaining raw events. */
export interface AgentTimelineOverviewEvent {
  id: string;
  channel: AgentTimelineChannel;
  time: OverviewEventTime;
  numericValue?: number;
  qualitySeverity?: Exclude<OverviewQualitySeverity, 'none'>;
  label?: string;
  category?: string;
}

export interface OverviewTileBuildConfig {
  sourceId: string;
  channel: AgentTimelineChannel;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  level: number;
  tileIndex: number;
  baseBinDuration: number;
  tileBinCount: number;
  duration: number;
  inputArtifactIds: readonly string[];
  coverage?: readonly AgentTimelineRange[];
  maxLabelCounts?: number;
  maxCategoryCounts?: number;
}

export interface AgentTimelineOverviewTileReader {
  readTile(ref: AgentTimelineOverviewTileRef): Promise<AgentTimelineOverviewTile>;
}

export interface AgentTimelineOverviewQuery {
  start: number;
  end: number;
  pixelWidth: number;
  channels: readonly AgentTimelineChannel[];
}

export interface AgentTimelineOverviewChannelResult {
  channel: AgentTimelineChannel;
  level: number;
  binDuration: number;
  bins: readonly AgentTimelineOverviewBin[];
  tileIds: readonly string[];
  covered: readonly AgentTimelineRange[];
  missing: readonly AgentTimelineRange[];
}

export interface AgentTimelineOverviewResponse {
  schemaVersion: 'agent-timeline-overview-response/v1';
  sourceId: string;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  start: number;
  end: number;
  pixelWidth: number;
  channels: readonly AgentTimelineOverviewChannelResult[];
}
