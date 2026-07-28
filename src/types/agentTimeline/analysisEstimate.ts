import type {
  AgentTimelineChannel,
  AgentTimelineProfile,
  AgentTimelineRange,
} from './manifest';

export type AgentTimelineAnalysisScopeKind =
  | 'source'
  | 'used-ranges'
  | 'selection'
  | 'in-out'
  | 'shots'
  | 'custom-range';

export interface AgentTimelineAnalysisScope {
  kind: AgentTimelineAnalysisScopeKind;
  sourceRanges: readonly AgentTimelineRange[];
}

export interface AgentTimelineProfileSettings {
  profile: AgentTimelineProfile;
  metricSamplesPerSecond: number;
  faceSamplesPerSecond: number;
  cameraSamplesPerSecond: number;
  audioHopSeconds: number;
  ocrKeyframesPerShot: number;
  activeSpeakerCandidateSamplesPerSecond: number;
  spatialResolution: { width: number; height: number };
}

export interface AgentTimelineCachedChannelCoverage {
  channel: AgentTimelineChannel;
  ranges: readonly AgentTimelineRange[];
}

export interface AgentTimelineModelDownload {
  id: string;
  bytes: number;
  cached: boolean;
  kind: 'model' | 'language-pack';
}

export interface AgentTimelineBenchmarkRate {
  profile: AgentTimelineProfile;
  minimumSecondsPerMediaSecond: number;
  maximumSecondsPerMediaSecond: number;
  platform: string;
  deviceClass: string;
}

export interface AgentTimelineAnalysisEstimateRequest {
  scope: AgentTimelineAnalysisScope;
  profile: AgentTimelineProfileSettings;
  channels: readonly AgentTimelineChannel[];
  cachedCoverage: readonly AgentTimelineCachedChannelCoverage[];
  sourceFrameRate?: number;
  shotCount?: number;
  uncachedShotCount?: number;
  ambiguousSpeechSeconds?: number;
  downloads?: readonly AgentTimelineModelDownload[];
  benchmark?: AgentTimelineBenchmarkRate;
}

export interface AgentTimelineChannelEstimate {
  channel: AgentTimelineChannel;
  totalDurationSeconds: number;
  uncachedDurationSeconds: number;
  reusableDurationSeconds: number;
  estimatedWorkItems?: number;
  workItemKind?: 'frames' | 'samples' | 'windows' | 'keyframes' | 'candidate-samples';
}

export interface AgentTimelineAnalysisEstimate {
  scope: AgentTimelineAnalysisScopeKind;
  profile: AgentTimelineProfile;
  channels: readonly AgentTimelineChannelEstimate[];
  totalDurationSeconds: number;
  uncachedDurationSeconds: number;
  relativeCost: 'low' | 'moderate' | 'high' | 'custom';
  estimatedWallTimeSeconds?: {
    minimum: number;
    maximum: number;
    platform: string;
    deviceClass: string;
  };
  downloads: {
    requiredBytes: number;
    reusableBytes: number;
    items: readonly AgentTimelineModelDownload[];
  };
  notes: readonly string[];
}
