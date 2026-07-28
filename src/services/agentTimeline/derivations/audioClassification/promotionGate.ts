import type {
  AudioClassificationCandidateComparison,
  AudioClassificationPromotionPolicy,
  AudioClassificationPromotionResult,
  AudioClassificationRuntimeEvidence,
} from '../../../../types/agentTimeline/audioClassification';

function invalidEvidenceReason(evidence: AudioClassificationRuntimeEvidence): string | undefined {
  if (!evidence.id.trim() || !evidence.classifierId.trim() || !evidence.classifierVersion.trim()
    || !evidence.platform.trim() || !evidence.scenarioId.trim()) return 'Evidence identity fields must not be empty';
  const positive = [evidence.sourceDurationSeconds, evidence.wallTimeSeconds, evidence.baselineWallTimeSeconds];
  if (positive.some(value => !Number.isFinite(value) || value <= 0)) return 'Durations and runtime values must be positive and finite';
  if (evidence.cacheState !== 'cold' && evidence.cacheState !== 'warm') return 'Cache state must be cold or warm';
  const nonNegative = [
    evidence.peakMemoryBytes,
    evidence.artifactBytes,
    evidence.downloadBytes,
    evidence.redundantDecodedSeconds,
  ];
  return nonNegative.some(value => !Number.isFinite(value) || value < 0)
    ? 'Memory, artifact, and download values must be finite and non-negative'
    : undefined;
}

function assertPolicy(policy: AudioClassificationPromotionPolicy): void {
  const nonNegative = [policy.minimumAccuracyGain, policy.minimumMacroF1Gain, policy.maximumDownloadBytes];
  if (nonNegative.some(value => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(policy.maximumRuntimeRatio) || policy.maximumRuntimeRatio <= 0
    || !Number.isFinite(policy.maximumPeakMemoryBytes) || policy.maximumPeakMemoryBytes <= 0
    || !Number.isFinite(policy.maximumArtifactBytesPerMediaMinute) || policy.maximumArtifactBytesPerMediaMinute <= 0
    || policy.requiredPlatforms.length === 0 || policy.requiredScenarios.length === 0) {
    throw new RangeError('Audio classification promotion policy is invalid');
  }
}

/**
 * A model is promotable only with a measurable labelled-case improvement and
 * observed real-media resource evidence. Missing evidence is a failing gate.
 */
export function evaluateAudioClassificationPromotionGate(
  comparison: AudioClassificationCandidateComparison,
  evidence: readonly AudioClassificationRuntimeEvidence[],
  policy: AudioClassificationPromotionPolicy,
): AudioClassificationPromotionResult {
  assertPolicy(policy);
  const failures: AudioClassificationPromotionResult['failures'][number][] = [];
  if (comparison.accuracyGain < policy.minimumAccuracyGain
    || comparison.macroF1Gain < policy.minimumMacroF1Gain) {
    failures.push({
      code: 'insufficient-quality-benefit',
      detail: `Observed gains: accuracy ${comparison.accuracyGain.toFixed(4)}, macro-F1 ${comparison.macroF1Gain.toFixed(4)}`,
    });
  }
  const candidate = evidence
    .filter(item => item.classifierId === comparison.candidate.classifier.id)
    .filter(item => item.classifierVersion === comparison.candidate.classifier.version)
    .filter(item => policy.requiredPlatforms.includes(item.platform) && policy.requiredScenarios.includes(item.scenarioId))
    .toSorted((left, right) => left.platform.localeCompare(right.platform)
      || left.scenarioId.localeCompare(right.scenarioId)
      || left.cacheState.localeCompare(right.cacheState)
      || left.id.localeCompare(right.id));
  for (const item of candidate) {
    const invalid = invalidEvidenceReason(item);
    if (invalid) {
      failures.push({ code: 'invalid-runtime-evidence', evidenceId: item.id, detail: invalid });
      continue;
    }
    if (!item.realMedia) {
      failures.push({ code: 'missing-real-runtime-evidence', evidenceId: item.id, platform: item.platform, scenarioId: item.scenarioId, detail: 'Synthetic evidence cannot promote a product model' });
      continue;
    }
    if (item.wallTimeSeconds / item.baselineWallTimeSeconds > policy.maximumRuntimeRatio) failures.push({ code: 'runtime-budget-exceeded', evidenceId: item.id, detail: 'Runtime ratio exceeds the promotion policy' });
    if (item.peakMemoryBytes > policy.maximumPeakMemoryBytes) failures.push({ code: 'memory-budget-exceeded', evidenceId: item.id, detail: 'Peak memory exceeds the promotion policy' });
    if (item.artifactBytes / (item.sourceDurationSeconds / 60) > policy.maximumArtifactBytesPerMediaMinute) failures.push({ code: 'artifact-budget-exceeded', evidenceId: item.id, detail: 'Artifact bytes per media minute exceed the promotion policy' });
    if (item.downloadBytes > policy.maximumDownloadBytes) failures.push({ code: 'download-budget-exceeded', evidenceId: item.id, detail: 'Observed download bytes exceed the promotion policy' });
    if (item.cacheState === 'warm' && item.redundantDecodedSeconds !== 0) {
      failures.push({
        code: 'warm-cache-redecoded',
        evidenceId: item.id,
        platform: item.platform,
        scenarioId: item.scenarioId,
        cacheState: item.cacheState,
        detail: 'Warm-cache evidence decoded source media again',
      });
    }
  }
  for (const platform of [...new Set(policy.requiredPlatforms)].toSorted()) {
    for (const scenarioId of [...new Set(policy.requiredScenarios)].toSorted()) {
      for (const cacheState of ['cold', 'warm'] as const) {
        if (!candidate.some(item => item.realMedia
          && item.platform === platform
          && item.scenarioId === scenarioId
          && item.cacheState === cacheState
          && invalidEvidenceReason(item) === undefined)) {
          failures.push({
            code: 'missing-real-runtime-evidence',
            platform,
            scenarioId,
            cacheState,
            detail: `No valid ${cacheState} real-media runtime, memory, artifact, and download evidence for ${platform}/${scenarioId}`,
          });
        }
      }
    }
  }
  return { passed: failures.length === 0, failures };
}
