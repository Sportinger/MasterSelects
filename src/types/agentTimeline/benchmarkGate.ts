import type {
  AgentTimelineChannel,
  AgentTimelineProfile,
} from './manifest';

export type AgentTimelineBenchmarkCacheState = 'cold' | 'warm';
export type AgentTimelineBenchmarkBaselineKind = 'standalone-cut' | 'proxy-piggyback';

/** Observable rendering context for platform-specific benchmark gates. */
export interface AgentTimelineBenchmarkRuntimeEvidence {
  platformClass: 'windows' | 'linux' | 'linux-mesa' | 'macos' | 'unknown';
  renderBackend: 'webgpu' | 'cpu' | 'unknown';
  canvasPath: 'software' | 'gpu' | 'unknown';
  mesa: boolean | 'unknown';
  renderer?: string;
}

export interface AgentTimelineBenchmarkMeasurement {
  id: string;
  realMedia: boolean;
  profile: AgentTimelineProfile;
  channels: readonly AgentTimelineChannel[];
  platform: string;
  deviceClass: string;
  scenarioId: string;
  cacheState: AgentTimelineBenchmarkCacheState;
  /** Defaults to standalone-cut for existing policies. Set explicitly for new channels. */
  baselineKind?: AgentTimelineBenchmarkBaselineKind;
  /** Baseline and analysis must have been measured in the same environment. */
  baselinePlatform: string;
  baselineDeviceClass: string;
  runtimeEvidence?: AgentTimelineBenchmarkRuntimeEvidence;
  baselineRuntimeEvidence?: AgentTimelineBenchmarkRuntimeEvidence;
  sourceDurationSeconds: number;
  wallTimeSeconds: number;
  baselineWallTimeSeconds: number;
  peakMemoryBytes: number;
  artifactBytes: number;
  /** Warm-cache source seconds that were decoded again. Must be zero. */
  redundantDecodedSeconds: number;
}

export interface AgentTimelineBenchmarkGatePolicy {
  profile: Exclude<AgentTimelineProfile, 'custom'>;
  channel: AgentTimelineChannel;
  baselineKind: AgentTimelineBenchmarkBaselineKind;
  requiredPlatforms: readonly string[];
  requiredScenarios: readonly string[];
  maximumPeakMemoryBytes: number;
  maximumArtifactBytesPerMediaMinute: number;
  /** Use for Linux/Mesa and other platform-path-specific promotion gates. */
  requiredRuntimeEvidence?: Partial<AgentTimelineBenchmarkRuntimeEvidence>;
}

export type AgentTimelineBenchmarkGateFailure =
  | 'missing-real-measurement'
  | 'missing-cache-state'
  | 'runtime-budget-exceeded'
  | 'memory-budget-exceeded'
  | 'artifact-budget-exceeded'
  | 'warm-cache-redecoded'
  | 'baseline-mismatch'
  | 'runtime-evidence-mismatch'
  | 'invalid-measurement';

export interface AgentTimelineBenchmarkGateResult {
  passed: boolean;
  profile: AgentTimelineBenchmarkGatePolicy['profile'];
  channel: AgentTimelineChannel;
  allowedRuntimeRatio: number;
  evaluatedMeasurementIds: readonly string[];
  failures: readonly {
    code: AgentTimelineBenchmarkGateFailure;
    platform?: string;
    scenarioId?: string;
    cacheState?: AgentTimelineBenchmarkCacheState;
    measurementId?: string;
    detail: string;
  }[];
}
