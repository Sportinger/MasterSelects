export const LOCAL_BENCHMARK_SCHEMA_VERSION = 'agent-timeline-real-media-benchmark/v1' as const;
export const LOCAL_BENCHMARK_TOOL = 'runAgentTimelineLocalBenchmark' as const;

export type LocalBenchmarkAnalyzer = 'cuts' | 'focus-motion' | 'faces' | 'audio';
export type LocalBenchmarkPass = 'baseline' | 'analysis';
export type LocalBenchmarkCacheState = 'cold' | 'warm';
export type LocalBenchmarkBaselineKind = 'standalone-cut' | 'proxy-piggyback';

export interface LocalBenchmarkRuntimeEvidence {
  platformClass: 'windows' | 'linux' | 'linux-mesa' | 'macos' | 'unknown';
  renderBackend: 'webgpu' | 'cpu' | 'unknown';
  canvasPath: 'software' | 'gpu' | 'unknown';
  mesa: boolean | 'unknown';
  renderer?: string;
}

export interface LocalBenchmarkObservability {
  /** All values are accepted only when directly measured for this pass. */
  peakMemoryBytes?: number | null;
  artifactBytes?: number | null;
  redundantDecodedSeconds?: number | null;
  runtimeEvidence?: LocalBenchmarkRuntimeEvidence;
}

export interface LocalBenchmarkRequest {
  schemaVersion: typeof LOCAL_BENCHMARK_SCHEMA_VERSION;
  kind: 'agent-timeline-benchmark-request';
  localOnly: true;
  /** Never read by the browser runner; it is only compared with the selected local item. */
  mediaPath: string;
  mediaFingerprint: { name: string; sizeBytes: number; sha256: string };
  durationSeconds: number;
  scenarioId: string;
  profile: 'quick' | 'balanced' | 'deep';
  analyzer: LocalBenchmarkAnalyzer;
  baselineKind: LocalBenchmarkBaselineKind;
  cacheState: LocalBenchmarkCacheState;
  pass: LocalBenchmarkPass;
}

export interface LocalBenchmarkCacheObservation {
  state: LocalBenchmarkCacheState | 'unknown';
  coldResetConfirmed: boolean;
  detail: string;
}

export interface LocalBenchmarkExecution {
  status: 'completed' | 'cancelled' | 'unavailable';
  /** Echoed by the adapter so a baseline cannot be accidentally run as analysis. */
  pass: LocalBenchmarkPass;
  baselineKind: LocalBenchmarkBaselineKind;
  detail?: string;
  observability?: LocalBenchmarkObservability;
}

export interface LocalBenchmarkBinding {
  mediaFileId: string;
  clipId?: string;
  observeCache: (request: LocalBenchmarkRequest) => Promise<LocalBenchmarkCacheObservation>;
  /** Must independently verify that local analyzer/model/artifact caches were reset. */
  verifyColdReset?: (request: LocalBenchmarkRequest) => Promise<LocalBenchmarkCacheObservation>;
  runBaseline: (request: LocalBenchmarkRequest, signal: AbortSignal) => Promise<LocalBenchmarkExecution>;
  runAnalysis: (request: LocalBenchmarkRequest, signal: AbortSignal) => Promise<LocalBenchmarkExecution>;
  /** `false` means this local adapter has no abort primitive. */
  cancel: () => boolean;
}

export interface LocalBenchmarkResult {
  schemaVersion: typeof LOCAL_BENCHMARK_SCHEMA_VERSION;
  kind: 'agent-timeline-local-analysis-pass';
  status: 'completed' | 'cancelled' | 'unavailable' | 'blocked';
  localOnly: true;
  networkUsed: false;
  cloudUsed: false;
  profile: LocalBenchmarkRequest['profile'];
  analyzer: LocalBenchmarkAnalyzer;
  pass: LocalBenchmarkPass;
  baselineKind: LocalBenchmarkBaselineKind;
  channels: readonly string[];
  cacheStateObserved: LocalBenchmarkCacheObservation['state'];
  cacheResetConfirmed: boolean;
  cacheEvidence: { detail: string; mediaFileId?: string; clipId?: string };
  platform: string;
  deviceClass: string;
  elapsedMs: number;
  peakMemoryBytes: number | null;
  artifactBytes: number | null;
  redundantDecodedSeconds: number | null;
  runtimeEvidence?: LocalBenchmarkRuntimeEvidence;
  detail?: string;
}
