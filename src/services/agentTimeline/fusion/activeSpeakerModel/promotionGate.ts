import type {
  ActiveSpeakerLocalRoiModelMetadata,
  ActiveSpeakerModelPromotionPolicy,
  ActiveSpeakerModelPromotionResult,
  ActiveSpeakerModelRuntimeEvidence,
  ActiveSpeakerModelComparison,
} from '../../../../types/agentTimeline/activeSpeakerModel';

function invalidEvidenceReason(evidence: ActiveSpeakerModelRuntimeEvidence): string | undefined {
  if (!evidence.id.trim() || !evidence.modelId.trim() || !evidence.modelVersion.trim()
    || !evidence.platform.trim() || !evidence.scenarioId.trim()) return 'Evidence identity fields must not be empty';
  if (evidence.cacheState !== 'cold' && evidence.cacheState !== 'warm') return 'Cache state must be cold or warm';
  if (evidence.downloadEvidence !== 'measured-download'
    && evidence.downloadEvidence !== 'no-download-observed') {
    return 'Download evidence must be observed';
  }
  const positive = [evidence.sourceDurationSeconds, evidence.candidateDurationSeconds, evidence.wallTimeSeconds, evidence.baselineWallTimeSeconds];
  if (positive.some(value => !Number.isFinite(value) || value <= 0)) return 'Duration and runtime fields must be positive and finite';
  const nonNegative = [
    evidence.peakMemoryBytes,
    evidence.artifactBytes,
    evidence.downloadBytes,
    evidence.redundantDecodedSeconds,
  ];
  return nonNegative.some(value => !Number.isFinite(value) || value < 0)
    ? 'Memory, artifact, and download fields must be finite and non-negative'
    : undefined;
}

function assertPolicy(policy: ActiveSpeakerModelPromotionPolicy): void {
  const finiteNonNegative = [policy.minimumAccuracyGain, policy.maximumDownloadBytes];
  if (finiteNonNegative.some(value => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(policy.maximumRuntimeRatio) || policy.maximumRuntimeRatio <= 0
    || !Number.isFinite(policy.maximumPeakMemoryBytes) || policy.maximumPeakMemoryBytes <= 0
    || !Number.isFinite(policy.maximumArtifactBytesPerMediaMinute) || policy.maximumArtifactBytesPerMediaMinute <= 0
    || policy.requiredPlatforms.length === 0 || policy.requiredScenarios.length === 0) {
    throw new RangeError('Active-speaker promotion policy is invalid');
  }
}

function capabilityFailure(
  metadata: ActiveSpeakerLocalRoiModelMetadata,
  policy: ActiveSpeakerModelPromotionPolicy,
): string | undefined {
  const capabilities = metadata.capabilities;
  if (!metadata.id.trim() || !metadata.version.trim() || !capabilities.license.trim()
    || !Number.isFinite(capabilities.modelBytes) || capabilities.modelBytes <= 0) return 'Model metadata requires id, version, license, and positive model bytes';
  if (policy.requireWebGpu && !capabilities.webgpu) return 'WebGPU capability is required';
  if (policy.requireWasm && !capabilities.wasm) return 'WASM capability is required';
  if (policy.requireCpuFallback && !capabilities.cpuFallback) return 'CPU fallback is required';
  return undefined;
}

/** No model can pass without both an accuracy gain and complete real cold/warm candidate-only evidence. */
export function evaluateActiveSpeakerModelPromotionGate(
  model: ActiveSpeakerLocalRoiModelMetadata,
  comparison: ActiveSpeakerModelComparison,
  evidence: readonly ActiveSpeakerModelRuntimeEvidence[],
  policy: ActiveSpeakerModelPromotionPolicy,
): ActiveSpeakerModelPromotionResult {
  assertPolicy(policy);
  const failures: ActiveSpeakerModelPromotionResult['failures'][number][] = [];
  const capability = capabilityFailure(model, policy);
  if (capability) failures.push({ code: capability.includes('required') ? 'missing-required-capability' : 'invalid-capability-metadata', detail: capability });
  if (comparison.modelId !== model.id || comparison.modelVersion !== model.version) {
    failures.push({
      code: 'model-comparison-mismatch',
      detail: 'Labelled comparison does not belong to the promoted model version',
    });
  }
  if (comparison.accuracyGain < policy.minimumAccuracyGain) failures.push({
    code: 'insufficient-accuracy-benefit',
    detail: `Observed accuracy gain ${comparison.accuracyGain.toFixed(4)} is below ${policy.minimumAccuracyGain}`,
  });
  const relevant = evidence
    .filter(item => item.modelId === model.id && item.modelVersion === model.version)
    .filter(item => policy.requiredPlatforms.includes(item.platform) && policy.requiredScenarios.includes(item.scenarioId))
    .toSorted((left, right) => left.platform.localeCompare(right.platform) || left.scenarioId.localeCompare(right.scenarioId) || left.cacheState.localeCompare(right.cacheState) || left.id.localeCompare(right.id));
  for (const item of relevant) {
    const invalid = invalidEvidenceReason(item);
    if (invalid) {
      failures.push({ code: 'invalid-runtime-evidence', evidenceId: item.id, detail: invalid });
      continue;
    }
    if (!item.realMedia) {
      failures.push({ code: 'missing-real-runtime-evidence', evidenceId: item.id, platform: item.platform, scenarioId: item.scenarioId, detail: 'Synthetic evidence cannot promote a model' });
      continue;
    }
    if (!item.candidateOnly) failures.push({ code: 'continuous-full-video-run', evidenceId: item.id, detail: 'Evidence includes a continuous full-video model run' });
    if (item.wallTimeSeconds / item.baselineWallTimeSeconds > policy.maximumRuntimeRatio) failures.push({ code: 'runtime-budget-exceeded', evidenceId: item.id, detail: 'Runtime ratio exceeds the promotion policy' });
    if (item.peakMemoryBytes > policy.maximumPeakMemoryBytes) failures.push({ code: 'memory-budget-exceeded', evidenceId: item.id, detail: 'Peak memory exceeds the promotion policy' });
    if (item.artifactBytes / (item.sourceDurationSeconds / 60) > policy.maximumArtifactBytesPerMediaMinute) failures.push({ code: 'artifact-budget-exceeded', evidenceId: item.id, detail: 'Artifact bytes per media minute exceed the promotion policy' });
    if (item.downloadBytes > policy.maximumDownloadBytes) failures.push({ code: 'download-budget-exceeded', evidenceId: item.id, detail: 'Observed download bytes exceed the promotion policy' });
    if (item.cacheState === 'warm' && item.redundantDecodedSeconds !== 0) failures.push({
      code: 'warm-cache-redecoded',
      evidenceId: item.id,
      platform: item.platform,
      scenarioId: item.scenarioId,
      cacheState: item.cacheState,
      detail: 'Warm-cache evidence decoded candidate source ranges again',
    });
  }
  for (const platform of [...new Set(policy.requiredPlatforms)].toSorted()) {
    for (const scenarioId of [...new Set(policy.requiredScenarios)].toSorted()) {
      for (const cacheState of ['cold', 'warm'] as const) {
        if (!relevant.some(item => item.realMedia && item.candidateOnly && item.platform === platform
          && item.scenarioId === scenarioId && item.cacheState === cacheState && invalidEvidenceReason(item) === undefined)) {
          failures.push({ code: 'missing-real-runtime-evidence', platform, scenarioId, cacheState, detail: `No valid ${cacheState} real-media candidate-only evidence for ${platform}/${scenarioId}` });
        }
      }
    }
  }
  return { passed: failures.length === 0, failures };
}
