import {
  LOCAL_BENCHMARK_SCHEMA_VERSION,
  type LocalBenchmarkAnalyzer,
  type LocalBenchmarkBinding,
  type LocalBenchmarkExecution,
  type LocalBenchmarkRequest,
  type LocalBenchmarkResult,
} from './contracts';

const CHANNELS: Record<LocalBenchmarkAnalyzer, readonly string[]> = {
  cuts: ['cuts'],
  'focus-motion': ['quality', 'camera-motion'],
  faces: ['people'],
  audio: ['audio'],
};

const ANALYZERS = new Set<LocalBenchmarkAnalyzer>(['cuts', 'focus-motion', 'faces', 'audio']);

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function positive(value: unknown, field: string): number {
  if (!Number.isFinite(value) || Number(value) <= 0) throw new RangeError(`${field} must be positive and finite`);
  return Number(value);
}

function optionalMetric(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseLocalBenchmarkRequest(value: Record<string, unknown>): LocalBenchmarkRequest {
  if (value.schemaVersion !== LOCAL_BENCHMARK_SCHEMA_VERSION || value.kind !== 'agent-timeline-benchmark-request') {
    throw new TypeError('Unsupported local benchmark request schema');
  }
  if (value.localOnly !== true) throw new TypeError('Local benchmark runner rejects non-local requests');
  const analyzer = value.analyzer;
  if (typeof analyzer !== 'string' || !ANALYZERS.has(analyzer as LocalBenchmarkAnalyzer)) throw new TypeError('Unsupported benchmark analyzer');
  if (value.profile !== 'quick' && value.profile !== 'balanced' && value.profile !== 'deep') throw new TypeError('Unsupported analysis profile');
  if (value.cacheState !== 'cold' && value.cacheState !== 'warm') throw new TypeError('cacheState must be cold or warm');
  if (value.baselineKind !== 'standalone-cut' && value.baselineKind !== 'proxy-piggyback') {
    throw new TypeError('baselineKind must be standalone-cut or proxy-piggyback');
  }
  if (value.pass !== 'baseline' && value.pass !== 'analysis') throw new TypeError('pass must be baseline or analysis');
  const fingerprint = value.mediaFingerprint;
  if (!fingerprint || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) throw new TypeError('mediaFingerprint is required');
  const fingerprintRecord = fingerprint as Record<string, unknown>;
  const sha256 = nonEmpty(fingerprintRecord.sha256, 'mediaFingerprint.sha256');
  if (!/^[a-f0-9]{64}$/iu.test(sha256)) throw new TypeError('mediaFingerprint.sha256 must be a SHA-256 digest');
  return {
    schemaVersion: LOCAL_BENCHMARK_SCHEMA_VERSION,
    kind: 'agent-timeline-benchmark-request',
    localOnly: true,
    mediaPath: nonEmpty(value.mediaPath, 'mediaPath'),
    mediaFingerprint: {
      name: nonEmpty(fingerprintRecord.name, 'mediaFingerprint.name'),
      sizeBytes: positive(fingerprintRecord.sizeBytes, 'mediaFingerprint.sizeBytes'),
      sha256,
    },
    durationSeconds: positive(value.durationSeconds, 'durationSeconds'),
    scenarioId: nonEmpty(value.scenarioId, 'scenarioId'),
    profile: value.profile,
    analyzer: analyzer as LocalBenchmarkAnalyzer,
    baselineKind: value.baselineKind,
    cacheState: value.cacheState,
    pass: value.pass,
  };
}

export interface RunLocalBenchmarkOptions {
  request: Record<string, unknown>;
  resolveBinding: (request: LocalBenchmarkRequest) => Promise<LocalBenchmarkBinding | null>;
  now?: () => number;
  platform?: () => string;
  deviceClass?: () => string;
  signal?: AbortSignal;
}

function baseResult(request: LocalBenchmarkRequest, options: RunLocalBenchmarkOptions, startedAt: number): LocalBenchmarkResult {
  return {
    schemaVersion: LOCAL_BENCHMARK_SCHEMA_VERSION,
    kind: 'agent-timeline-local-analysis-pass',
    status: 'unavailable',
    localOnly: true,
    networkUsed: false,
    cloudUsed: false,
    profile: request.profile,
    analyzer: request.analyzer,
    pass: request.pass,
    baselineKind: request.baselineKind,
    channels: CHANNELS[request.analyzer],
    cacheStateObserved: 'unknown',
    cacheResetConfirmed: false,
    cacheEvidence: { detail: 'No selected local media binding was available.' },
    platform: options.platform?.() ?? 'unknown',
    deviceClass: options.deviceClass?.() ?? 'unknown',
    elapsedMs: Math.max(.001, (options.now?.() ?? performance.now()) - startedAt),
    peakMemoryBytes: null,
    artifactBytes: null,
    redundantDecodedSeconds: null,
  };
}

function measuredExecution(
  request: LocalBenchmarkRequest,
  execution: LocalBenchmarkExecution,
): LocalBenchmarkExecution | undefined {
  if (execution.pass !== request.pass || execution.baselineKind !== request.baselineKind) return undefined;
  return execution;
}

/**
 * Runs an injected, browser-local analyzer pass. The core intentionally has no
 * imports from cloud, transcription, descriptions or durable storage.
 */
export async function runLocalBenchmarkPass(options: RunLocalBenchmarkOptions): Promise<LocalBenchmarkResult> {
  const request = parseLocalBenchmarkRequest(options.request);
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const result = baseResult(request, options, startedAt);
  const binding = await options.resolveBinding(request);
  if (!binding) return { ...result, elapsedMs: Math.max(.001, now() - startedAt) };
  let observation = await binding.observeCache(request);
  if (request.cacheState === 'cold' && binding.verifyColdReset) {
    observation = await binding.verifyColdReset(request);
  }
  const bound = {
    ...result,
    cacheStateObserved: observation.state,
    cacheResetConfirmed: observation.coldResetConfirmed,
    cacheEvidence: { detail: observation.detail, mediaFileId: binding.mediaFileId, clipId: binding.clipId },
  };
  if (observation.state !== request.cacheState || observation.coldResetConfirmed !== (request.cacheState === 'cold')) {
    return { ...bound, status: 'blocked', elapsedMs: Math.max(.001, now() - startedAt), detail: 'Requested cache state is not observably confirmed.' };
  }
  const controller = new AbortController();
  const abort = () => { binding.cancel(); controller.abort(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const rawExecution = await (request.pass === 'baseline'
      ? binding.runBaseline(request, controller.signal)
      : binding.runAnalysis(request, controller.signal));
    const execution = measuredExecution(request, rawExecution);
    if (!execution) {
      return {
        ...bound,
        status: 'unavailable',
        elapsedMs: Math.max(.001, now() - startedAt),
        detail: 'Local adapter did not verify the requested pass and baseline kind.',
      };
    }
    const observability = execution.observability;
    const result: LocalBenchmarkResult = {
      ...bound,
      status: execution.status,
      elapsedMs: Math.max(.001, now() - startedAt),
      peakMemoryBytes: optionalMetric(observability?.peakMemoryBytes),
      artifactBytes: optionalMetric(observability?.artifactBytes),
      redundantDecodedSeconds: optionalMetric(observability?.redundantDecodedSeconds),
      runtimeEvidence: observability?.runtimeEvidence,
      detail: execution.detail,
    };
    if (execution.status === 'completed' && request.cacheState === 'warm' && (result.redundantDecodedSeconds === null || result.redundantDecodedSeconds !== 0)) {
      return {
        ...result,
        status: 'blocked',
        detail: result.redundantDecodedSeconds === null
          ? 'Warm cache requires measured redundant decoded seconds.'
          : 'Warm cache decoded already-covered source ranges.',
      };
    }
    return result;
  } catch (error) {
    const cancelled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    return {
      ...bound,
      status: cancelled ? 'cancelled' : 'unavailable',
      elapsedMs: Math.max(.001, now() - startedAt),
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
