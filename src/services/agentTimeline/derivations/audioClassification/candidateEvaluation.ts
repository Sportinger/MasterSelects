import type {
  AudioClassificationCandidateComparison,
  AudioClassificationCandidateEvaluation,
  AudioClassificationClassifier,
  AudioClassificationLabel,
  AudioClassificationMetric,
  AudioClassificationReferenceCase,
  AudioClassificationSpan,
} from '../../../../types/agentTimeline/audioClassification';

const LABELS: readonly AudioClassificationLabel[] = [
  'speech', 'music', 'noise', 'ambience', 'applause', 'unknown',
];

function overlapSeconds(left: AudioClassificationSpan, right: AudioClassificationSpan): number {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function validSpans(spans: readonly AudioClassificationSpan[], bounds: { start: number; end: number }): AudioClassificationSpan[] {
  return spans.flatMap(span => {
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end <= span.start) return [];
    const start = Math.max(bounds.start, span.start);
    const end = Math.min(bounds.end, span.end);
    return end > start ? [{ ...span, start, end }] : [];
  });
}

function metric(referenceCases: readonly AudioClassificationReferenceCase[], classifier: AudioClassificationClassifier): AudioClassificationMetric {
  const expected = Object.fromEntries(LABELS.map(label => [label, 0])) as Record<AudioClassificationLabel, number>;
  const predicted = Object.fromEntries(LABELS.map(label => [label, 0])) as Record<AudioClassificationLabel, number>;
  const truePositive = Object.fromEntries(LABELS.map(label => [label, 0])) as Record<AudioClassificationLabel, number>;
  let totalExpected = 0;
  let totalCorrect = 0;
  for (const referenceCase of referenceCases) {
    const actual = validSpans(referenceCase.expected, referenceCase.input.range);
    const candidate = validSpans(classifier.classify(referenceCase.input), referenceCase.input.range);
    for (const span of actual) {
      const duration = span.end - span.start;
      expected[span.label] += duration;
      totalExpected += duration;
      for (const prediction of candidate) {
        if (prediction.label !== span.label) continue;
        const overlap = overlapSeconds(span, prediction);
        truePositive[span.label] += overlap;
        totalCorrect += overlap;
      }
    }
    for (const span of candidate) predicted[span.label] += span.end - span.start;
  }
  const perLabel = Object.fromEntries(LABELS.map(label => {
    const precision = predicted[label] === 0 ? 0 : truePositive[label] / predicted[label];
    const recall = expected[label] === 0 ? 0 : truePositive[label] / expected[label];
    return [label, {
      precision,
      recall,
      f1: precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall),
      expectedSeconds: expected[label],
      predictedSeconds: predicted[label],
    }];
  })) as AudioClassificationMetric['perLabel'];
  const presentLabels = LABELS.filter(label => expected[label] > 0 || predicted[label] > 0);
  return {
    accuracy: totalExpected === 0 ? 0 : Math.min(1, totalCorrect / totalExpected),
    macroF1: presentLabels.length === 0 ? 0 : presentLabels.reduce((sum, label) => sum + perLabel[label].f1, 0) / presentLabels.length,
    perLabel,
  };
}

/** Evaluates a supplied candidate only against explicitly labelled local cases. */
export function evaluateAudioClassificationCandidate(
  classifier: AudioClassificationClassifier,
  referenceCases: readonly AudioClassificationReferenceCase[],
): AudioClassificationCandidateEvaluation {
  return {
    classifier: classifier.metadata,
    referenceCaseIds: referenceCases.map(referenceCase => referenceCase.id).toSorted(),
    metric: metric(referenceCases, classifier),
  };
}

export function compareAudioClassificationCandidates(
  baseline: AudioClassificationClassifier,
  candidate: AudioClassificationClassifier,
  referenceCases: readonly AudioClassificationReferenceCase[],
): AudioClassificationCandidateComparison {
  const baselineEvaluation = evaluateAudioClassificationCandidate(baseline, referenceCases);
  const candidateEvaluation = evaluateAudioClassificationCandidate(candidate, referenceCases);
  return {
    baseline: baselineEvaluation,
    candidate: candidateEvaluation,
    accuracyGain: candidateEvaluation.metric.accuracy - baselineEvaluation.metric.accuracy,
    macroF1Gain: candidateEvaluation.metric.macroF1 - baselineEvaluation.metric.macroF1,
  };
}
