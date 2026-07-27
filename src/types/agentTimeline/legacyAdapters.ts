import type {
  AgentTimelineChannel,
  AgentTimelineChannelStatus,
  AgentTimelineEvent,
  AgentTimelineProfile,
  AgentTimelineProvenance,
  AgentTimelineRange,
  AgentTimelineTimeDomain,
  NormalizedBox,
} from './manifest';
import type { AudioAnalysisArtifactKind } from '../audio';

export const LEGACY_ADAPTER_VIEW_SCHEMA_VERSION = 'agent-timeline-legacy-view/v1' as const;

export type LegacyAdapterRangeCapability = 'range-queryable' | 'source-wide-only';
export type LegacyAdapterLimitation =
  | 'coverage-not-recorded'
  | 'face-identity-source-wide-only'
  | 'raw-measurement-not-classification'
  | 'payload-not-loaded'
  | 'stale-artifact';

export interface LegacyFocusSampleRecord {
  kind: 'focus-brightness-sample';
  time: number;
  focus: number;
  brightness: number;
}

export interface LegacyMotionSampleRecord {
  kind: 'motion-sample';
  time: number;
  motion: number;
  globalMotion: number;
  localMotion: number;
  meanMagnitude?: number;
  meanX?: number;
  meanY?: number;
  directionCoherence?: number;
  coverageRatio?: number;
  vectorConvention?: 'camera-motion' | 'image-flow';
}

export interface LegacyFaceSampleRecord {
  kind: 'face-sample';
  time: number;
  detectionId: string;
  personId: string;
  confidence: number;
  identityEligible: boolean;
  box: NormalizedBox;
}

export interface LegacySceneDescriptionRecord {
  kind: 'scene-description';
  segmentId: string;
  start: number;
  end: number;
  text: string;
}

export interface LegacyAudioArtifactRecord {
  kind: 'audio-artifact-reference';
  artifactId: string;
  artifactKind: AudioAnalysisArtifactKind;
  start: number;
  end: number;
  sampleRate: number;
  channelCount: number;
  stale: boolean;
  payloadArtifactIds: string[];
}

export type LegacyAdapterRecord =
  | LegacyFocusSampleRecord
  | LegacyMotionSampleRecord
  | LegacyFaceSampleRecord
  | LegacySceneDescriptionRecord
  | LegacyAudioArtifactRecord;

export interface LegacyArtifactShardView<TRecord extends LegacyAdapterRecord = never> {
  type: 'agent-timeline-legacy-shard-view';
  schemaVersion: typeof LEGACY_ADAPTER_VIEW_SCHEMA_VERSION;
  channel: AgentTimelineChannel;
  profile: AgentTimelineProfile;
  timeDomain: AgentTimelineTimeDomain;
  stateHash?: string;
  requestedRange: AgentTimelineRange;
  status: AgentTimelineChannelStatus;
  coverage: AgentTimelineRange[];
  missing: AgentTimelineRange[];
  artifactRefs: string[];
  provenance: AgentTimelineProvenance[];
  rangeCapability: LegacyAdapterRangeCapability;
  limitations: LegacyAdapterLimitation[];
  events: AgentTimelineEvent[];
  records: TRecord[];
}
