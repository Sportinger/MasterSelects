import type {
  AgentTimelineEventBase,
  AgentTimelineProvenance,
  AgentTimelineRange,
  ShotEventData,
} from './manifest';
import type { SourceIdentity } from './sourceIdentity';

export const SETUP_CLUSTERING_VERSION = 'camera-setup-clustering/v1' as const;

export type SetupDescriptorSignal =
  | 'perceptual-hash'
  | 'color-histogram'
  | 'luma-histogram'
  | 'edge-histogram'
  | 'face-layout';

export interface SetupFaceLayoutDescriptor {
  faceCount: number;
  centers?: Array<{ x: number; y: number }>;
  dominantFaceHeight?: number;
  shotSize?: 'extreme-close-up' | 'close-up' | 'medium' | 'medium-wide' | 'wide' | 'unknown';
  layout?: 'single' | 'two-shot' | 'group' | 'no-face' | 'unknown';
}

export interface CameraSetupDescriptor {
  perceptualHash?: string;
  colorHistogram?: number[];
  lumaHistogram?: number[];
  edgeHistogram?: number[];
  faceLayout?: SetupFaceLayoutDescriptor;
}

export interface SetupShotInput {
  shotId: string;
  start: number;
  end: number;
  keyframeSourceTime?: number;
  descriptor?: CameraSetupDescriptor;
}

export interface SetupSimilarityWeights {
  perceptualHash: number;
  colorHistogram: number;
  lumaHistogram: number;
  edgeHistogram: number;
  faceLayout: number;
}

export interface SetupClusteringThresholds {
  minimumSimilarity: number;
  adjacentShotMinimumSimilarity: number;
  shortShotMinimumSimilarity: number;
  shortShotDuration: number;
  minimumComparableWeight: number;
  maximumHashBits: number;
  maximumHistogramBins: number;
  maximumFaceCenters: number;
  weights: SetupSimilarityWeights;
}

export type SetupAssignmentStatus = 'recurring' | 'unique' | 'unknown';
export type SetupAssignmentReason =
  | 'clustered-across-shots'
  | 'no-compatible-match'
  | 'missing-descriptor'
  | 'insufficient-comparable-signals';

export interface SetupAssignmentData extends ShotEventData {
  setupStatus: SetupAssignmentStatus;
  setupReason: SetupAssignmentReason;
  clusterSize: number;
  similarity?: number;
  descriptorSignals: SetupDescriptorSignal[];
}

export type SetupAssignmentEvent = AgentTimelineEventBase<'shot', SetupAssignmentData>;

export interface SourceCameraSetupCluster {
  setupId: string;
  memberShotIds: string[];
  start: number;
  end: number;
  confidence: number;
  recurring: boolean;
}

export interface SetupDerivationCoverage {
  coveredShotIds: string[];
  missingShotIds: string[];
  coveredRanges: AgentTimelineRange[];
  missingRanges: AgentTimelineRange[];
}

export interface SetupClusteringResult {
  version: typeof SETUP_CLUSTERING_VERSION;
  sourceIdentity: SourceIdentity;
  events: SetupAssignmentEvent[];
  clusters: SourceCameraSetupCluster[];
  coverage: SetupDerivationCoverage;
}

export interface SetupClusteringOptions {
  thresholds?: Partial<Omit<SetupClusteringThresholds, 'weights'>> & {
    weights?: Partial<SetupSimilarityWeights>;
  };
  provenance?: AgentTimelineProvenance[];
}
