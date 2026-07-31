import {
  getFlashBoardActiveGenerationRecord,
  updateFlashBoardActiveGenerationJob,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import {
  FLASHBOARD_CANCEL_REQUESTED_ERROR,
  flashBoardJobService,
} from '../../flashboard/FlashBoardJobService';
import {
  reconcileStoryboardGenerationRecord,
  setStoryboardCandidateState,
} from '../candidates';
import type {
  CancelStoryboardGenerationInput,
  CancelStoryboardGenerationResult,
  StoryboardGenerationCancelPorts,
} from './types';
import { recordStoryboardTelemetry } from '../telemetry';

const defaultCancelPorts: StoryboardGenerationCancelPorts = {
  cancelJob: (recordId) => flashBoardJobService.cancel(recordId),
  getRecord: getFlashBoardActiveGenerationRecord,
  updateJob: updateFlashBoardActiveGenerationJob,
};

function withCancelTelemetry(
  result: CancelStoryboardGenerationResult,
): CancelStoryboardGenerationResult {
  recordStoryboardTelemetry('generation.cancelled', {
    status: result.disposition,
  });
  return result;
}

function completedResult(
  input: CancelStoryboardGenerationInput,
  ports: StoryboardGenerationCancelPorts,
): CancelStoryboardGenerationResult | null {
  const candidate = input.state.candidates[input.candidateId];
  if (!candidate?.generationRecordId) return null;
  const record = ports.getRecord(candidate.generationRecordId);
  if (record?.job?.status !== 'completed' && !record?.result && !record?.results?.length) {
    return null;
  }
  if (candidate.generationBriefRevision === undefined) {
    throw new Error('Generated storyboard candidate is missing its brief revision.');
  }
  return {
    billingMayContinue: true,
    disposition: 'completed-billable',
    state: reconcileStoryboardGenerationRecord(input.state, {
      generationBriefRevision: candidate.generationBriefRevision,
      generationRequestKey: candidate.generationRequestKey,
      record,
      sceneId: candidate.sceneId,
    }).state,
  };
}

export function cancelStoryboardGeneration(
  input: CancelStoryboardGenerationInput,
): CancelStoryboardGenerationResult {
  const candidate = input.state.candidates[input.candidateId];
  if (!candidate) throw new Error(`Unknown storyboard candidate: ${input.candidateId}`);
  const ports = input.ports ?? defaultCancelPorts;

  const alreadyCompleted = completedResult(input, ports);
  if (alreadyCompleted) return withCancelTelemetry(alreadyCompleted);
  if (!candidate.generationRecordId) {
    return withCancelTelemetry({
      billingMayContinue: false,
      disposition: 'canceled-before-submission',
      state: setStoryboardCandidateState(input.state, candidate.id, 'canceled'),
    });
  }
  const record = ports.getRecord(candidate.generationRecordId);
  if (record?.job?.status === 'draft') {
    ports.updateJob(candidate.generationRecordId, { status: 'canceled' });
    return withCancelTelemetry({
      billingMayContinue: false,
      disposition: 'canceled-before-submission',
      state: setStoryboardCandidateState(input.state, candidate.id, 'canceled'),
    });
  }
  if (record?.job?.status === 'canceled') {
    return withCancelTelemetry({
      billingMayContinue: false,
      disposition: 'canceled-before-submission',
      state: setStoryboardCandidateState(input.state, candidate.id, 'canceled'),
    });
  }

  const cancellation = ports.cancelJob(candidate.generationRecordId);
  const completedAfterCancel = completedResult(input, ports);
  if (completedAfterCancel) return withCancelTelemetry(completedAfterCancel);
  if (cancellation.disposition === 'canceled-before-submission') {
    ports.updateJob(candidate.generationRecordId, { status: 'canceled' });
    return withCancelTelemetry({
      billingMayContinue: false,
      disposition: 'canceled-before-submission',
      state: setStoryboardCandidateState(input.state, candidate.id, 'canceled'),
    });
  }

  ports.updateJob(candidate.generationRecordId, {
    status: 'processing',
    error: FLASHBOARD_CANCEL_REQUESTED_ERROR,
    ...(cancellation.remoteTaskId
      ? { remoteTaskId: cancellation.remoteTaskId }
      : {}),
  });
  return withCancelTelemetry({
    billingMayContinue: true,
    disposition: 'cancel-requested',
    state: setStoryboardCandidateState(input.state, candidate.id, 'processing'),
  });
}
