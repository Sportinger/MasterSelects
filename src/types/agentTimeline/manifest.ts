import type { SourceIdentity } from './sourceIdentity';

export const AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION = 'agent-timeline-manifest/v1' as const;
// Versioning policy: adding a new event-type union member or optional data
// fields is additive and stays on v1 (persisted v1 shards remain valid; app
// and storage readers ship as one unit). Bump only for breaking changes to
// existing event shapes or time semantics.
export const AGENT_TIMELINE_EVENT_SCHEMA_VERSION = 'agent-timeline-event/v1' as const;

export type AgentTimelineProfile = 'quick' | 'balanced' | 'deep' | 'custom';
export type AgentTimelineTimeDomain = 'source' | 'clip-rendered' | 'composition-rendered';
export type AgentTimelineQueryTimeDomain = 'source' | 'clip-local' | 'composition';
export type AgentTimelineChannel =
  | 'cuts'
  | 'shots'
  | 'scenes'
  | 'speech'
  | 'people'
  | 'active-speaker'
  | 'camera-motion'
  | 'audio'
  | 'quality'
  | 'text'
  | 'duplicates';

export interface AgentTimelineRange {
  start: number;
  end: number;
}

export interface AgentTimelinePointTime {
  temporalKind: 'point';
  timeDomain: AgentTimelineTimeDomain;
  time: number;
  stateHash?: string;
}

export interface AgentTimelineIntervalTime {
  temporalKind: 'interval';
  timeDomain: AgentTimelineTimeDomain;
  start: number;
  end: number;
  stateHash?: string;
}

export type AgentTimelineEventTime = AgentTimelinePointTime | AgentTimelineIntervalTime;

export interface AnalyzerProvenance {
  kind: 'analyzer';
  analyzerId: string;
  analyzerVersion: string;
  modelId?: string;
  modelVersion?: string;
  artifactRef?: string;
}

export interface ManualProvenance {
  kind: 'manual';
  annotationId: string;
  createdAt: string;
}

export type AgentTimelineProvenance = AnalyzerProvenance | ManualProvenance;

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CutEventData {
  score: number;
  transition: 'hard' | 'fade' | 'dissolve' | 'black' | 'unknown';
}

export interface ShotEventData {
  shotId: string;
  index?: number;
  setupId?: string;
  shotSize?: 'extreme-close-up' | 'close-up' | 'medium' | 'medium-wide' | 'wide' | 'unknown';
  layout?: 'single' | 'two-shot' | 'group' | 'no-face' | 'unknown';
}

export interface SceneBlockEventData {
  sceneId: string;
  boundarySource: 'rule-based' | 'manual' | 'shot-fallback';
  shotIds: string[];
  setupIds?: string[];
  label?: string;
}

export interface SpeechEventData {
  speakerId: string;
  text?: string;
  language?: string;
  wordCount?: number;
  // Prosody-derived per-word scalars; optional and additive within schema v1.
  emphasis?: number;
  f0MeanHz?: number;
}

export interface SpeechMarkerEventData {
  marker: 'breath' | 'filler' | 'disfluency' | 'pause';
  text?: string;
  speakerId?: string;
  wordId?: string;
  intensity?: number;
}

export interface PersonVisibleEventData {
  personId: string;
  faceTrackId?: string;
  box?: NormalizedBox;
  position?: 'left' | 'center' | 'right' | 'unknown';
}

export interface ActiveSpeakerEventData {
  speakerId: string;
  personId?: string;
  status: 'onscreen' | 'offscreen' | 'unknown' | 'conflict';
  method: 'single-face' | 'mouth-motion' | 'model' | 'manual' | 'none';
  candidatePersonIds?: string[];
}

export interface CameraMotionEventData {
  motion: 'static' | 'pan' | 'tilt' | 'zoom' | 'dolly' | 'handheld' | 'global-motion' | 'unknown';
  direction?: 'left' | 'right' | 'up' | 'down' | 'in' | 'out' | 'mixed';
  magnitude?: number;
  coherence?: number;
}

export interface AudioActivityEventData {
  activity: 'speech' | 'music' | 'noise' | 'ambience' | 'applause' | 'silence' | 'transient' | 'unknown';
  loudnessDb?: number;
  peakDb?: number;
}

export interface QualityIssueEventData {
  issue: 'focus' | 'black' | 'exposure' | 'freeze' | 'shake' | 'clipping' | 'quiet' | 'silence' | 'dropout' | 'noise' | 'flicker' | 'compression';
  severity: 'info' | 'warning' | 'critical';
  measurement: number;
  threshold: number;
  unit: string;
}

export interface OnscreenTextEventData {
  text: string;
  originalText?: string;
  language?: string;
  kind: 'subtitle' | 'title' | 'lower-third' | 'sign' | 'unknown';
  box?: NormalizedBox;
}

export interface DuplicateGroupEventData {
  duplicateGroupId: string;
  takeGroupId?: string;
  memberEventIds: string[];
  similarity: number;
}

export interface AgentTimelineEventBase<TType extends string, TData> {
  schemaVersion: typeof AGENT_TIMELINE_EVENT_SCHEMA_VERSION;
  id: string;
  type: TType;
  time: AgentTimelineEventTime;
  confidence: number;
  provenance: AgentTimelineProvenance[];
  keyframeSourceTime?: number;
  data: TData;
}

export type AgentTimelineEvent =
  | AgentTimelineEventBase<'cut', CutEventData>
  | AgentTimelineEventBase<'shot', ShotEventData>
  | AgentTimelineEventBase<'scene-block', SceneBlockEventData>
  | AgentTimelineEventBase<'speech', SpeechEventData>
  | AgentTimelineEventBase<'speech-marker', SpeechMarkerEventData>
  | AgentTimelineEventBase<'person-visible', PersonVisibleEventData>
  | AgentTimelineEventBase<'active-speaker', ActiveSpeakerEventData>
  | AgentTimelineEventBase<'camera-motion', CameraMotionEventData>
  | AgentTimelineEventBase<'audio-activity', AudioActivityEventData>
  | AgentTimelineEventBase<'quality-issue', QualityIssueEventData>
  | AgentTimelineEventBase<'onscreen-text', OnscreenTextEventData>
  | AgentTimelineEventBase<'duplicate-group', DuplicateGroupEventData>;

export interface AgentTimelineArtifactRef {
  artifactRef: string;
  shardId: string;
  schemaVersion: string;
  analyzerId: string;
  analyzerVersion: string;
  modelId?: string;
  modelVersion?: string;
  profile: AgentTimelineProfile;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  eventTypes: AgentTimelineEvent['type'][];
  coverage: AgentTimelineRange[];
  byteLength: number;
  checksum?: string;
}

export type AgentTimelineChannelStatus = 'missing' | 'partial' | 'complete' | 'stale' | 'failed';

export interface AgentTimelineChannelManifest {
  status: AgentTimelineChannelStatus;
  artifacts: AgentTimelineArtifactRef[];
  error?: string;
}

export interface AgentTimelineManifest {
  schemaVersion: typeof AGENT_TIMELINE_MANIFEST_SCHEMA_VERSION;
  mediaFileId: string;
  sourceIdentity: SourceIdentity;
  durationSeconds: number;
  generatedAt: string;
  profile: AgentTimelineProfile;
  channels: Record<AgentTimelineChannel, AgentTimelineChannelManifest>;
}

export interface AgentTimelineQueryScope {
  mediaFileId?: string;
  compositionId?: string;
  compositionPath?: string[];
  clipId?: string;
}

export interface AgentTimelineQuery {
  scope: AgentTimelineQueryScope;
  start: number;
  end: number;
  timeDomain: AgentTimelineQueryTimeDomain;
  granularity: 'summary' | 'shot' | 'event' | 'sample';
  channels: AgentTimelineChannel[];
  includeFrames: boolean;
  limit?: number;
  cursor?: string;
}

export interface AgentTimelineTruncation {
  truncated: boolean;
  reason?: 'event-limit' | 'byte-limit';
  returnedEvents: number;
  estimatedBytes: number;
}

export interface AgentTimelineCoverageSummary {
  channel: AgentTimelineChannel;
  status: AgentTimelineChannelStatus;
  covered: AgentTimelineRange[];
  missing: AgentTimelineRange[];
  artifactRefs: string[];
  staleArtifactRefs: string[];
  error?: string;
}

export interface AgentTimelineQueryPage {
  schemaVersion: typeof AGENT_TIMELINE_EVENT_SCHEMA_VERSION;
  events: AgentTimelineEvent[];
  coverage: AgentTimelineCoverageSummary[];
  missingChannels: AgentTimelineChannel[];
  nextCursor?: string;
  truncation: AgentTimelineTruncation;
}
