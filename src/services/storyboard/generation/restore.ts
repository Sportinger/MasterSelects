import {
  hasDurableFlashBoardProviderIdempotency,
  isFlashBoardCancellationRequested,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import type { FlashBoardActiveGenerationRecord } from '../../../stores/flashboardStore/types';
import { flashBoardJobService } from '../../flashboard/FlashBoardJobService';
import { reconcileStoryboardGenerationRecord } from '../candidates';
import type {
  ReconcileStoryboardGenerationRecordsResult,
  StoryboardGenerationRestoreAction,
  StoryboardGenerationRestoreExecutionResult,
  StoryboardGenerationRestorePorts,
} from './types';
import type { StoryboardProjectState } from '../contracts';
import { recordStoryboardTelemetry } from '../telemetry';

const restoredRecordIds = new Set<string>();

function hasImportedResult(record: FlashBoardActiveGenerationRecord): boolean {
  return Boolean(
    record.result?.mediaFileId
    || record.results?.some((result) => result.mediaFileId)
    || record.outputs?.some((output) => output.mediaFileId),
  );
}

function restoreActionFor(
  record: FlashBoardActiveGenerationRecord,
): StoryboardGenerationRestoreAction | null {
  const request = record.request;
  if (!request) {
    return {
      kind: 'needs-confirmation',
      reason: 'Persisted generation record has no request payload.',
      recordId: record.id,
    };
  }
  if (record.job?.status === 'completed') {
    const missingOutputs = record.outputs?.filter((output) => !output.mediaFileId) ?? [];
    if (
      missingOutputs.length > 0
      && missingOutputs.every((output) => output.importStatus === 'failed')
    ) {
      return null;
    }
    return hasImportedResult(record)
      ? null
      : { kind: 'awaiting-import', recordId: record.id };
  }
  if (record.job?.status !== 'queued' && record.job?.status !== 'processing') {
    return null;
  }
  if (record.job.remoteTaskId) {
    return {
      kind: 'resume',
      recordId: record.id,
      remoteTaskId: record.job.remoteTaskId,
      request,
    };
  }
  if (isFlashBoardCancellationRequested(record)) {
    return {
      kind: 'needs-confirmation',
      reason: 'Cancellation was requested while submission may have been in flight.',
      recordId: record.id,
    };
  }
  if (hasDurableFlashBoardProviderIdempotency(request)) {
    return {
      kind: 'resubmit-idempotently',
      recordId: record.id,
      request,
    };
  }
  return {
    kind: 'needs-confirmation',
    reason: 'Provider route cannot safely replay a queued request without a task id.',
    recordId: record.id,
  };
}

export function reconcileStoryboardGenerationRecords(
  state: StoryboardProjectState,
  records: readonly FlashBoardActiveGenerationRecord[],
): ReconcileStoryboardGenerationRecordsResult {
  let nextState = state;
  const actions: StoryboardGenerationRestoreAction[] = [];
  const handledRecordIds = new Set<string>();
  const recordById = new Map(records.map((record) => [record.id, record]));
  const recordByRequestKey = new Map(
    records.flatMap((record) => (
      record.request?.idempotencyKey
        ? [[record.request.idempotencyKey, record] as const]
        : []
    )),
  );

  for (const candidate of Object.values(state.candidates)) {
    if (!nextState.scenes[candidate.sceneId]) continue;
    const record = (
      candidate.generationRecordId
        ? recordById.get(candidate.generationRecordId)
        : undefined
    ) ?? (
      candidate.generationRequestKey
        ? recordByRequestKey.get(candidate.generationRequestKey)
        : undefined
    );
    if (!record) continue;

    const mappedCandidate = candidate.generationRecordId === record.id
      ? candidate
      : { ...candidate, generationRecordId: record.id };
    if (mappedCandidate !== candidate) {
      nextState = {
        ...nextState,
        candidates: {
          ...nextState.candidates,
          [candidate.id]: mappedCandidate,
        },
      };
    }
    if (mappedCandidate.generationBriefRevision !== undefined) {
      nextState = reconcileStoryboardGenerationRecord(nextState, {
        generationBriefRevision: mappedCandidate.generationBriefRevision,
        generationRequestKey: mappedCandidate.generationRequestKey,
        record,
        sceneId: mappedCandidate.sceneId,
      }).state;
    }

    if (handledRecordIds.has(record.id)) continue;
    handledRecordIds.add(record.id);
    const action = restoreActionFor(record);
    if (action) actions.push(action);
  }
  return { actions, state: nextState };
}

const defaultRestorePorts: StoryboardGenerationRestorePorts = {
  hasJob: (recordId) => flashBoardJobService.hasJob(recordId),
  resume: (input) => flashBoardJobService.resume(input),
  submit: (input) => flashBoardJobService.submit(input),
};

export function executeStoryboardGenerationRestoreActions(
  actions: readonly StoryboardGenerationRestoreAction[],
  ports: StoryboardGenerationRestorePorts = defaultRestorePorts,
): StoryboardGenerationRestoreExecutionResult {
  const executedRecordIds: string[] = [];
  const failed: StoryboardGenerationRestoreExecutionResult['failed'] = [];
  const needsConfirmationRecordIds: string[] = [];
  for (const action of actions) {
    if (action.kind === 'needs-confirmation') {
      needsConfirmationRecordIds.push(action.recordId);
      continue;
    }
    if (action.kind === 'awaiting-import') continue;
    if (restoredRecordIds.has(action.recordId) || ports.hasJob(action.recordId)) {
      continue;
    }
    try {
      if (action.kind === 'resume') {
        ports.resume({
          recordId: action.recordId,
          remoteTaskId: action.remoteTaskId,
          request: action.request,
        });
      } else {
        ports.submit({
          recordId: action.recordId,
          request: action.request,
        });
      }
      restoredRecordIds.add(action.recordId);
      executedRecordIds.push(action.recordId);
    } catch (error) {
      failed.push({
        error: error instanceof Error ? error.message : String(error),
        recordId: action.recordId,
      });
    }
  }
  recordStoryboardTelemetry('generation.restored', {
    count: actions.length,
    failedCount: failed.length,
    succeededCount: executedRecordIds.length,
  });
  return { executedRecordIds, failed, needsConfirmationRecordIds };
}
