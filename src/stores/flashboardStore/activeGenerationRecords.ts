import {
  FLASHBOARD_CANCEL_REQUESTED_ERROR,
  flashBoardJobService,
} from '../../services/flashboard/FlashBoardJobService';
import {
  mergeFlashBoardVideoJobRecovery,
  persistFlashBoardVideoJobRecovery,
  readFlashBoardVideoJobRecovery,
} from '../../services/flashboard/FlashBoardVideoJobRecovery';
import { resolveFlashBoardJobStartedAt } from '../../services/flashboard/FlashBoardJobTiming';
import { projectFileService } from '../../services/projectFileService';
import { useFlashBoardStore } from './index';
import { createDefaultFlashBoardComposer } from './defaults';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardChatMessage,
  FlashBoardComposerState,
  FlashBoardGenerationRequest,
  FlashBoardGenerationOutput,
  FlashBoardJobRefund,
  FlashBoardJobState,
  FlashBoardPromptHistoryEntry,
  FlashBoardPromptHistoryKind,
  FlashBoardResult,
  FlashBoardStoreState,
} from './types';

export type { FlashBoardActiveGenerationRecord } from './types';

const MAX_FLASHBOARD_PROMPT_HISTORY = 200;
export { FLASHBOARD_CANCEL_REQUESTED_ERROR };

function getCurrentProjectCreatedAt(): string | null {
  return typeof projectFileService.getProjectData === 'function'
    ? projectFileService.getProjectData()?.createdAt ?? null
    : null;
}

function persistCurrentFlashBoardVideoJobs(): void {
  persistFlashBoardVideoJobRecovery(
    useFlashBoardStore.getState().activeGenerationRecords,
    getCurrentProjectCreatedAt(),
  );
}

function isVideoGenerationRequest(request: FlashBoardGenerationRequest): boolean {
  return request.outputType !== 'audio' && request.outputType !== 'image';
}

function areActiveGenerationRecordsEqual(
  left: FlashBoardActiveGenerationRecord[],
  right: FlashBoardActiveGenerationRecord[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  return left.every((leftRecord, index) => {
    const rightRecord = right[index];
    return leftRecord.id === rightRecord.id
      && leftRecord.createdAt === rightRecord.createdAt
      && leftRecord.updatedAt === rightRecord.updatedAt
      && leftRecord.request === rightRecord.request
      && leftRecord.job === rightRecord.job
      && leftRecord.outputs === rightRecord.outputs
      && leftRecord.result === rightRecord.result
      && leftRecord.results === rightRecord.results;
  });
}

function updateFlashBoardActiveGenerationRecord(
  recordId: string,
  updater: (record: FlashBoardActiveGenerationRecord) => FlashBoardActiveGenerationRecord,
): void {
  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: state.activeGenerationRecords.map((record) =>
      record.id === recordId ? updater(record) : record
    ),
  }));
  persistCurrentFlashBoardVideoJobs();
}

function removeFlashBoardActiveGenerationRecord(recordId: string): void {
  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: state.activeGenerationRecords.filter((record) => record.id !== recordId),
    selectedActiveGenerationRecordIds: state.selectedActiveGenerationRecordIds.filter((id) => id !== recordId),
  }));
  persistCurrentFlashBoardVideoJobs();
}

export function selectFlashBoardActiveGenerationRecords(
  state: FlashBoardStoreState,
): FlashBoardActiveGenerationRecord[] {
  return state.activeGenerationRecords;
}

export function useFlashBoardActiveGenerationRecords(): FlashBoardActiveGenerationRecord[] {
  return useFlashBoardStore(selectFlashBoardActiveGenerationRecords);
}

function getFlashBoardState(): FlashBoardStoreState {
  return useFlashBoardStore.getState();
}

export function getFlashBoardActiveGenerationRecords(): FlashBoardActiveGenerationRecord[] {
  return selectFlashBoardActiveGenerationRecords(getFlashBoardState());
}

export function getFlashBoardComposerState(): FlashBoardComposerState {
  return getFlashBoardState().composer;
}

export function subscribeFlashBoardComposerState(
  listener: () => void,
): () => void {
  return useFlashBoardStore.subscribe(
    (state) => state.composer,
    () => listener(),
  );
}

export function subscribeFlashBoardActiveGenerationRecords(
  listener: () => void,
): () => void {
  return useFlashBoardStore.subscribe(
    selectFlashBoardActiveGenerationRecords,
    () => listener(),
    { equalityFn: areActiveGenerationRecordsEqual },
  );
}

export function subscribeFlashBoardPromptHistory(
  listener: () => void,
): () => void {
  return useFlashBoardStore.subscribe(
    (state) => state.promptHistory,
    () => listener(),
  );
}

export function selectHasFlashBoardActiveGenerationBoard(_state: FlashBoardStoreState): boolean {
  return true;
}

export function useHasFlashBoardActiveGenerationBoard(): boolean {
  return true;
}

export function useRemoveFlashBoardActiveGenerationRecord(): (recordId: string) => void {
  return removeFlashBoardActiveGenerationRecord;
}

export function useSelectedFlashBoardActiveGenerationRecordIds(): string[] {
  return useFlashBoardStore((state) => state.selectedActiveGenerationRecordIds);
}

export function clearFlashBoardActiveGenerationSelection(): void {
  useFlashBoardStore.setState({ selectedActiveGenerationRecordIds: [] });
}

export function getFlashBoardActiveGenerationRecord(
  recordId: string,
): FlashBoardActiveGenerationRecord | undefined {
  return getFlashBoardState().activeGenerationRecords.find((record) => record.id === recordId);
}

export function getFlashBoardActiveGenerationRecordByRequestKey(
  idempotencyKey: string,
): FlashBoardActiveGenerationRecord | undefined {
  return getFlashBoardState().activeGenerationRecords.find(
    (record) => record.request?.idempotencyKey === idempotencyKey,
  );
}

/**
 * Only hosted image/video generation currently replays an already-created
 * remote task for a stable idempotency key. Audio routes fail closed because
 * their provider call cannot yet be proven exactly-once after reload.
 */
export function hasDurableFlashBoardProviderIdempotency(
  request: FlashBoardGenerationRequest,
): boolean {
  return request.service === 'cloud'
    && Boolean(request.idempotencyKey)
    && (request.outputType === 'image' || request.outputType === 'video' || !request.outputType);
}

export function isFlashBoardCancellationRequested(
  record: FlashBoardActiveGenerationRecord,
): boolean {
  return record.job?.error === FLASHBOARD_CANCEL_REQUESTED_ERROR;
}

export function getFlashBoardPromptHistory(): FlashBoardPromptHistoryEntry[] {
  return getFlashBoardState().promptHistory;
}

export function getFlashBoardChatMessages(): FlashBoardChatMessage[] {
  return getFlashBoardState().chatMessages;
}

export function subscribeFlashBoardChatMessages(
  listener: () => void,
): () => void {
  return useFlashBoardStore.subscribe(
    (state) => state.chatMessages,
    () => listener(),
  );
}

export function appendFlashBoardPromptHistoryEntry(input: {
  kind: FlashBoardPromptHistoryKind;
  prompt: string;
}): FlashBoardPromptHistoryEntry | null {
  const prompt = input.prompt.trim();
  if (!prompt) return null;

  const entry: FlashBoardPromptHistoryEntry = {
    id: crypto.randomUUID(),
    kind: input.kind,
    prompt,
    createdAt: Date.now(),
  };

  useFlashBoardStore.setState((state) => ({
    promptHistory: [
      entry,
      ...state.promptHistory.filter((item) => item.kind !== entry.kind || item.prompt !== entry.prompt),
    ].slice(0, MAX_FLASHBOARD_PROMPT_HISTORY),
  }));

  return entry;
}

export function completeFlashBoardActiveGenerationRecord(
  recordId: string,
  results: FlashBoardResult | FlashBoardResult[],
): void {
  const now = Date.now();
  const normalizedResults = Array.isArray(results) ? results : [results];
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    job: { ...record.job, status: 'completed', completedAt: now },
    outputs: record.outputs?.map((output) => {
      const matchingResult = normalizedResults.find((result) => result.outputId === output.id);
      return {
        ...output,
        availability: matchingResult ? 'completed' : output.availability,
        importStatus: matchingResult ? 'completed' : output.importStatus,
        importError: matchingResult ? undefined : output.importError,
        mediaFileId: matchingResult?.mediaFileId ?? output.mediaFileId,
      };
    }),
    result: normalizedResults[0],
    results: normalizedResults,
    updatedAt: now,
  }));
}

export function recordFlashBoardImportedGenerationResult(
  recordId: string,
  result: FlashBoardResult,
): void {
  const now = Date.now();
  updateFlashBoardActiveGenerationRecord(recordId, (record) => {
    const previousResults = record.results ?? [];
    const matchingIndex = previousResults.findIndex((previous) => (
      (result.outputId && previous.outputId === result.outputId)
      || previous.mediaFileId === result.mediaFileId
    ));
    const nextResults = matchingIndex >= 0
      ? previousResults.map((previous, index) => index === matchingIndex ? result : previous)
      : [...previousResults, result];

    return {
      ...record,
      outputs: record.outputs?.map((output) => (
        output.id === result.outputId
          ? {
              ...output,
              importError: undefined,
              importStatus: 'completed',
              mediaFileId: result.mediaFileId,
            }
          : output
      )),
      results: nextResults,
      updatedAt: now,
    };
  });
}

export function updateFlashBoardActiveGenerationOutputs(
  recordId: string,
  outputs: FlashBoardGenerationOutput[],
): void {
  const now = Date.now();
  updateFlashBoardActiveGenerationRecord(recordId, (record) => {
    const existingById = new Map(record.outputs?.map((output) => [output.id, output]) ?? []);
    return {
      ...record,
      outputs: outputs.map((output) => ({
        ...existingById.get(output.id),
        ...output,
        mediaFileId: existingById.get(output.id)?.mediaFileId ?? output.mediaFileId,
      })),
      updatedAt: now,
    };
  });
}

export function updateFlashBoardActiveGenerationJob(
  recordId: string,
  patch: Partial<FlashBoardJobState>,
): void {
  const now = Date.now();
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    job: {
      ...record.job,
      ...patch,
      startedAt: resolveFlashBoardJobStartedAt({
        currentStartedAt: record.job?.startedAt,
        nextStartedAt: patch.startedAt,
        nextStatus: patch.status ?? record.job?.status ?? 'queued',
        now,
      }),
    } as FlashBoardJobState,
    updatedAt: now,
  }));
}

export function failFlashBoardActiveGenerationRecord(
  recordId: string,
  error: string,
  refund?: FlashBoardJobRefund,
): void {
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    job: { ...record.job, status: 'failed', error, refund: refund ?? record.job?.refund },
    updatedAt: Date.now(),
  }));
}

export function ensureFlashBoardActiveGenerationBoard(): void {
  // Kept for active caller compatibility. The generation store no longer has a board to bootstrap.
}

export function resetFlashBoardActiveGenerationState(): void {
  useFlashBoardStore.setState({
    activeGenerationRecords: [],
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
    promptHistory: [],
    chatMessages: [],
    hoveredComposerReference: null,
  });
}

export function hydrateFlashBoardActiveGenerationRecords(
  records: FlashBoardActiveGenerationRecord[],
  composer: FlashBoardComposerState = createDefaultFlashBoardComposer(),
  promptHistory: FlashBoardPromptHistoryEntry[] = [],
  chatMessages: FlashBoardChatMessage[] = [],
): void {
  useFlashBoardStore.setState({
    activeGenerationRecords: records,
    selectedActiveGenerationRecordIds: [],
    composer,
    promptHistory,
    chatMessages,
    hoveredComposerReference: null,
  });
  persistCurrentFlashBoardVideoJobs();
}

export function markFlashBoardGenerationOutputImportFailed(
  recordId: string,
  outputId: string,
  error: string,
): void {
  const safeError = error.trim().slice(0, 500) || 'Project media import failed.';
  const now = Date.now();
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    outputs: record.outputs?.map((output) => (
      output.id === outputId
        ? {
            ...output,
            importError: safeError,
            importStatus: 'failed',
          }
        : output
    )),
    updatedAt: now,
  }));
}

export function restoreFlashBoardActiveGenerationRecordsFromRecovery(
  projectCreatedAt: string | null = getCurrentProjectCreatedAt(),
): void {
  const recoveredRecords = readFlashBoardVideoJobRecovery(projectCreatedAt);
  if (recoveredRecords.length === 0) return;

  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: mergeFlashBoardVideoJobRecovery(
      state.activeGenerationRecords,
      recoveredRecords,
    ),
  }));
  persistCurrentFlashBoardVideoJobs();
}

export function prepareFlashBoardActiveGenerationRequest(
  request: FlashBoardGenerationRequest,
): FlashBoardActiveGenerationRecord {
  if (request.idempotencyKey) {
    const existing = getFlashBoardActiveGenerationRecordByRequestKey(request.idempotencyKey);
    if (existing) return existing;
  }

  const now = Date.now();
  const recordId = crypto.randomUUID();
  const durableRequest = isVideoGenerationRequest(request)
    ? {
        ...request,
        idempotencyKey: request.idempotencyKey ?? `flashboard-video:${recordId}`,
      }
    : request;
  const record: FlashBoardActiveGenerationRecord = {
    id: recordId,
    kind: 'generation',
    createdAt: now,
    updatedAt: now,
    request: durableRequest,
    job: { status: 'draft' },
  };

  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: [...state.activeGenerationRecords, record],
  }));
  persistCurrentFlashBoardVideoJobs();
  const prompts = [
    durableRequest.prompt,
    ...(durableRequest.multiPrompt ?? []).map((shot) => shot.prompt),
  ];
  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    appendFlashBoardPromptHistoryEntry({ kind: 'generation', prompt: prompts[index] });
  }

  return getFlashBoardActiveGenerationRecord(record.id) ?? record;
}

export function startFlashBoardActiveGenerationRecord(
  recordId: string,
): FlashBoardActiveGenerationRecord {
  const record = getFlashBoardActiveGenerationRecord(recordId);
  if (!record?.request) {
    throw new Error(`Cannot start unknown FlashBoard generation record: ${recordId}`);
  }
  if (
    record.job?.status === 'completed'
    || record.job?.status === 'failed'
    || record.job?.status === 'canceled'
  ) {
    return record;
  }
  if (record.job?.status !== 'draft') {
    if (
      record.job?.status === 'queued'
      && !flashBoardJobService.hasJob(record.id)
      && hasDurableFlashBoardProviderIdempotency(record.request)
    ) {
      flashBoardJobService.submit({ recordId: record.id, request: record.request });
    }
    return getFlashBoardActiveGenerationRecord(record.id) ?? record;
  }
  updateFlashBoardActiveGenerationJob(record.id, { status: 'queued' });
  flashBoardJobService.submit({ recordId: record.id, request: record.request });
  return getFlashBoardActiveGenerationRecord(record.id) ?? record;
}

export function submitFlashBoardActiveGenerationRequest(
  request: FlashBoardGenerationRequest,
): FlashBoardActiveGenerationRecord | null {
  const record = prepareFlashBoardActiveGenerationRequest(request);
  return startFlashBoardActiveGenerationRecord(record.id);
}
