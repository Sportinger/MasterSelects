import type {
  ActiveSpeakerEvaluationMetric,
  ActiveSpeakerLabelledReferenceCase,
  ActiveSpeakerLocalRoiModelMetadata,
  ActiveSpeakerModelComparison,
  ActiveSpeakerModelPrediction,
} from '../../../../types/agentTimeline/activeSpeakerModel';

function validPrediction(
  prediction: ActiveSpeakerModelPrediction,
  referenceCase: ActiveSpeakerLabelledReferenceCase,
): ActiveSpeakerModelPrediction {
  if (prediction.candidateId !== referenceCase.candidate.id
    || !Number.isFinite(prediction.confidence)
    || prediction.confidence < 0 || prediction.confidence > 1) {
    return { candidateId: referenceCase.candidate.id, status: 'unknown', confidence: 0 };
  }
  if (prediction.status !== 'onscreen'
    || !prediction.sourcePersonId
    || !referenceCase.candidate.sourcePersonIds.includes(prediction.sourcePersonId)) {
    return { candidateId: prediction.candidateId, status: 'unknown', confidence: prediction.confidence };
  }
  return prediction;
}

function correct(prediction: ActiveSpeakerModelPrediction, referenceCase: ActiveSpeakerLabelledReferenceCase): boolean {
  const normalized = validPrediction(prediction, referenceCase);
  return normalized.status === referenceCase.expected.status
    && normalized.sourcePersonId === referenceCase.expected.sourcePersonId;
}

function evaluate(
  cases: readonly ActiveSpeakerLabelledReferenceCase[],
  selector: (referenceCase: ActiveSpeakerLabelledReferenceCase) => ActiveSpeakerModelPrediction,
): ActiveSpeakerEvaluationMetric {
  const correctCount = cases.filter(referenceCase => correct(selector(referenceCase), referenceCase)).length;
  return { correct: correctCount, total: cases.length, accuracy: cases.length === 0 ? 0 : correctCount / cases.length };
}

/** Compares supplied local inference results; it never invokes, loads, or downloads a model. */
export function compareActiveSpeakerModelResults(
  cases: readonly ActiveSpeakerLabelledReferenceCase[],
  modelMetadata: ActiveSpeakerLocalRoiModelMetadata,
): ActiveSpeakerModelComparison {
  const heuristic = evaluate(cases, referenceCase => referenceCase.heuristic);
  const model = evaluate(cases, referenceCase => referenceCase.model);
  return {
    modelId: modelMetadata.id,
    modelVersion: modelMetadata.version,
    heuristic,
    model,
    accuracyGain: model.accuracy - heuristic.accuracy,
    evaluatedCaseIds: cases.map(referenceCase => referenceCase.id).toSorted(),
  };
}
