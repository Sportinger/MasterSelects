import type {
  AgentTimelineBenchmarkGateFailure,
  AgentTimelineBenchmarkGatePolicy,
  AgentTimelineBenchmarkGateResult,
  AgentTimelineBenchmarkMeasurement,
} from '../../../types/agentTimeline/benchmarkGate';

const PROFILE_RUNTIME_BUDGET = {
  quick: 1.25,
  balanced: 2,
  deep: 5,
} as const;

type GateFailure = AgentTimelineBenchmarkGateResult['failures'][number];

function sameRuntimeEvidence(
  left: AgentTimelineBenchmarkMeasurement['runtimeEvidence'],
  right: AgentTimelineBenchmarkMeasurement['baselineRuntimeEvidence'],
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function matchesRuntimeRequirement(
  evidence: AgentTimelineBenchmarkMeasurement['runtimeEvidence'],
  required: AgentTimelineBenchmarkGatePolicy['requiredRuntimeEvidence'],
): boolean {
  if (!required) return true;
  if (!evidence) return false;
  return Object.entries(required).every(([key, value]) => (
    evidence[key as keyof typeof evidence] === value
  ));
}

function invalidMeasurementReason(
  measurement: AgentTimelineBenchmarkMeasurement,
): string | undefined {
  if (!measurement.id.trim()
    || !measurement.platform.trim()
    || !measurement.deviceClass.trim()
    || !measurement.baselinePlatform.trim()
    || !measurement.baselineDeviceClass.trim()
    || !measurement.scenarioId.trim()) {
    return 'Measurement identity fields must not be empty';
  }
  const positive = [
    measurement.sourceDurationSeconds,
    measurement.wallTimeSeconds,
    measurement.baselineWallTimeSeconds,
  ];
  if (positive.some((value) => !Number.isFinite(value) || value <= 0)) {
    return 'Duration and wall-time values must be positive and finite';
  }
  const nonNegative = [
    measurement.peakMemoryBytes,
    measurement.artifactBytes,
    measurement.redundantDecodedSeconds,
  ];
  if (nonNegative.some((value) => !Number.isFinite(value) || value < 0)) {
    return 'Memory, artifact, and redundant-decode values must be finite and non-negative';
  }
  return undefined;
}

function failure(
  code: AgentTimelineBenchmarkGateFailure,
  detail: string,
  measurement?: AgentTimelineBenchmarkMeasurement,
): GateFailure {
  return {
    code,
    detail,
    platform: measurement?.platform,
    scenarioId: measurement?.scenarioId,
    cacheState: measurement?.cacheState,
    measurementId: measurement?.id,
  };
}

function assertPolicy(policy: AgentTimelineBenchmarkGatePolicy): void {
  if (policy.requiredPlatforms.length === 0 || policy.requiredScenarios.length === 0) {
    throw new TypeError('Benchmark gates require platforms and scenarios');
  }
  if (!Number.isFinite(policy.maximumPeakMemoryBytes) || policy.maximumPeakMemoryBytes <= 0) {
    throw new RangeError('maximumPeakMemoryBytes must be positive');
  }
  if (!Number.isFinite(policy.maximumArtifactBytesPerMediaMinute)
    || policy.maximumArtifactBytesPerMediaMinute <= 0) {
    throw new RangeError('maximumArtifactBytesPerMediaMinute must be positive');
  }
  if (policy.baselineKind !== undefined
    && policy.baselineKind !== 'standalone-cut'
    && policy.baselineKind !== 'proxy-piggyback') {
    throw new TypeError('Benchmark gates require a known baseline kind');
  }
}

function relevantMeasurements(
  policy: AgentTimelineBenchmarkGatePolicy,
  measurements: readonly AgentTimelineBenchmarkMeasurement[],
): AgentTimelineBenchmarkMeasurement[] {
  return measurements
    .filter((measurement) => measurement.profile === policy.profile)
    .filter((measurement) => measurement.channels.includes(policy.channel))
    .filter((measurement) => policy.requiredPlatforms.includes(measurement.platform))
    .filter((measurement) => policy.requiredScenarios.includes(measurement.scenarioId))
    .toSorted((left, right) => left.platform.localeCompare(right.platform)
      || left.scenarioId.localeCompare(right.scenarioId)
      || left.cacheState.localeCompare(right.cacheState)
      || left.id.localeCompare(right.id));
}

export function evaluateAgentTimelineBenchmarkGate(
  policy: AgentTimelineBenchmarkGatePolicy,
  measurements: readonly AgentTimelineBenchmarkMeasurement[],
): AgentTimelineBenchmarkGateResult {
  assertPolicy(policy);
  const requiredBaselineKind = policy.baselineKind ?? 'standalone-cut';
  const allowedRuntimeRatio = PROFILE_RUNTIME_BUDGET[policy.profile];
  const relevant = relevantMeasurements(policy, measurements);
  const failures: GateFailure[] = [];

  for (const measurement of relevant) {
    const invalid = invalidMeasurementReason(measurement);
    if (invalid) {
      failures.push(failure('invalid-measurement', invalid, measurement));
      continue;
    }
    if (!measurement.realMedia) {
      failures.push(failure(
        'missing-real-measurement',
        'Synthetic measurements cannot unlock a production analysis channel',
        measurement,
      ));
      continue;
    }
    if (measurement.baselineKind !== requiredBaselineKind) {
      failures.push(failure(
        'baseline-mismatch',
        `Baseline kind ${measurement.baselineKind} does not match required ${requiredBaselineKind}`,
        measurement,
      ));
    }
    if (measurement.baselinePlatform !== measurement.platform
      || measurement.baselineDeviceClass !== measurement.deviceClass) {
      failures.push(failure(
        'baseline-mismatch',
        'Baseline platform/device class must match the analysis measurement',
        measurement,
      ));
    }
    if (!sameRuntimeEvidence(measurement.runtimeEvidence, measurement.baselineRuntimeEvidence)) {
      failures.push(failure(
        'baseline-mismatch',
        'Baseline renderer/backend evidence must match the analysis measurement',
        measurement,
      ));
    }
    if (!matchesRuntimeRequirement(measurement.runtimeEvidence, policy.requiredRuntimeEvidence)) {
      failures.push(failure(
        'runtime-evidence-mismatch',
        'Observed renderer/backend evidence does not satisfy the benchmark policy',
        measurement,
      ));
    }
    const runtimeRatio = measurement.wallTimeSeconds / measurement.baselineWallTimeSeconds;
    if (runtimeRatio > allowedRuntimeRatio) {
      failures.push(failure(
        'runtime-budget-exceeded',
        `Runtime ratio ${runtimeRatio.toFixed(3)} exceeds ${allowedRuntimeRatio}`,
        measurement,
      ));
    }
    if (measurement.peakMemoryBytes > policy.maximumPeakMemoryBytes) {
      failures.push(failure(
        'memory-budget-exceeded',
        `Peak memory ${measurement.peakMemoryBytes} exceeds ${policy.maximumPeakMemoryBytes}`,
        measurement,
      ));
    }
    const artifactBytesPerMinute = measurement.artifactBytes
      / (measurement.sourceDurationSeconds / 60);
    if (artifactBytesPerMinute > policy.maximumArtifactBytesPerMediaMinute) {
      failures.push(failure(
        'artifact-budget-exceeded',
        `Artifact rate ${artifactBytesPerMinute.toFixed(0)} B/min exceeds ${policy.maximumArtifactBytesPerMediaMinute}`,
        measurement,
      ));
    }
    if (measurement.cacheState === 'warm' && measurement.redundantDecodedSeconds > 0) {
      failures.push(failure(
        'warm-cache-redecoded',
        `Warm cache decoded ${measurement.redundantDecodedSeconds}s already covered media`,
        measurement,
      ));
    }
  }

  for (const platform of [...new Set(policy.requiredPlatforms)].toSorted()) {
    for (const scenarioId of [...new Set(policy.requiredScenarios)].toSorted()) {
      const matching = relevant.filter((measurement) => (
        measurement.realMedia
        && measurement.platform === platform
        && measurement.scenarioId === scenarioId
        && invalidMeasurementReason(measurement) === undefined
      ));
      if (matching.length === 0) {
        failures.push({
          code: 'missing-real-measurement',
          platform,
          scenarioId,
          detail: `No valid real-media measurement for ${platform}/${scenarioId}`,
        });
        continue;
      }
      for (const cacheState of ['cold', 'warm'] as const) {
        if (!matching.some((measurement) => measurement.cacheState === cacheState)) {
          failures.push({
            code: 'missing-cache-state',
            platform,
            scenarioId,
            cacheState,
            detail: `Missing ${cacheState} measurement for ${platform}/${scenarioId}`,
          });
        }
      }
    }
  }

  return {
    passed: failures.length === 0,
    profile: policy.profile,
    channel: policy.channel,
    allowedRuntimeRatio,
    evaluatedMeasurementIds: relevant.map((measurement) => measurement.id),
    failures,
  };
}
