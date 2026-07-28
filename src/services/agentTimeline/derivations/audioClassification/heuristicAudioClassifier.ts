import {
  AUDIO_CLASSIFICATION_CLASS_MAPPING_VERSION,
  AUDIO_CLASSIFICATION_HEURISTIC_ID,
  AUDIO_CLASSIFICATION_HEURISTIC_VERSION,
  type AudioClassificationClassifier,
  type AudioClassificationFeatureWindow,
  type AudioClassificationInput,
  type AudioClassificationLabel,
  type AudioClassificationSpan,
} from '../../../../types/agentTimeline/audioClassification';

const MAX_HEURISTIC_CONFIDENCE = 0.82;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function overlapSeconds(
  left: { start: number; end: number },
  right: { start: number; end: number },
): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function transcriptCoverage(
  window: AudioClassificationFeatureWindow,
  input: AudioClassificationInput,
): { coverage: number; confidence: number } {
  const duration = window.end - window.start;
  if (duration <= 0 || !input.transcript?.length) return { coverage: 0, confidence: 0 };
  let covered = 0;
  let confidenceTotal = 0;
  for (const segment of input.transcript) {
    const overlap = overlapSeconds(window, segment);
    covered += overlap;
    confidenceTotal += overlap * clamp01(segment.confidence ?? 0.7);
  }
  return {
    coverage: Math.min(1, covered / duration),
    confidence: covered > 0 ? confidenceTotal / covered : 0,
  };
}

function classifyWindow(
  window: AudioClassificationFeatureWindow,
  input: AudioClassificationInput,
): { label: AudioClassificationLabel; confidence: number } {
  const speech = transcriptCoverage(window, input);
  if (speech.coverage >= 0.6) {
    return { label: 'speech', confidence: Math.min(MAX_HEURISTIC_CONFIDENCE, 0.58 + speech.coverage * 0.18 + speech.confidence * 0.08) };
  }

  const loudEnough = Number.isFinite(window.loudnessDb) && (window.loudnessDb as number) >= -55;
  const flatness = window.spectralFlatness;
  const onsetRate = window.onsetRateHz;
  const lowRatio = window.lowFrequencyRatio;
  const highRatio = window.highFrequencyRatio;
  if (!loudEnough || flatness === undefined || !Number.isFinite(flatness)) {
    return { label: 'unknown', confidence: 0.2 };
  }

  if (Number.isFinite(onsetRate) && (onsetRate as number) >= 5 && flatness >= 0.42) {
    return { label: 'applause', confidence: Math.min(MAX_HEURISTIC_CONFIDENCE, 0.46 + (onsetRate as number) * 0.025 + flatness * 0.12) };
  }
  if (Number.isFinite(onsetRate) && Number.isFinite(lowRatio)
    && (onsetRate as number) >= 1.5 && (lowRatio as number) >= 0.25 && flatness <= 0.55) {
    return { label: 'music', confidence: Math.min(MAX_HEURISTIC_CONFIDENCE, 0.4 + (onsetRate as number) * 0.04 + (lowRatio as number) * 0.18) };
  }
  if (flatness >= 0.75 && Number.isFinite(highRatio) && (highRatio as number) >= 0.35) {
    return { label: 'noise', confidence: Math.min(MAX_HEURISTIC_CONFIDENCE, 0.38 + flatness * 0.18 + (highRatio as number) * 0.12) };
  }
  if (flatness >= 0.28 && flatness <= 0.72
    && (!Number.isFinite(onsetRate) || (onsetRate as number) <= 0.25)
    && Number.isFinite(window.loudnessDb) && (window.loudnessDb as number) <= -30) {
    return { label: 'ambience', confidence: Math.min(MAX_HEURISTIC_CONFIDENCE, 0.38 + flatness * 0.18) };
  }
  return { label: 'unknown', confidence: 0.25 };
}

export const persistedAudioHeuristicClassifier: AudioClassificationClassifier = {
  metadata: {
    id: AUDIO_CLASSIFICATION_HEURISTIC_ID,
    version: AUDIO_CLASSIFICATION_HEURISTIC_VERSION,
    classMappingVersion: AUDIO_CLASSIFICATION_CLASS_MAPPING_VERSION,
    kind: 'heuristic',
  },
  classify(input): readonly AudioClassificationSpan[] {
    return input.features
      .filter(window => Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)
      .map(window => ({ ...window, ...classifyWindow(window, input) }));
  },
};
