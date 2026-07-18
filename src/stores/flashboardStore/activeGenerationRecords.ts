import { flashBoardJobService } from '../../services/flashboard/FlashBoardJobService';
import { useFlashBoardStore } from './index';
import { createDefaultFlashBoardComposer } from './defaults';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardChatMessage,
  FlashBoardComposerState,
  FlashBoardGenerationRequest,
  FlashBoardJobRefund,
  FlashBoardJobState,
  FlashBoardPromptHistoryEntry,
  FlashBoardPromptHistoryKind,
  FlashBoardResult,
  FlashBoardStoreState,
} from './types';

export type { FlashBoardActiveGenerationRecord } from './types';

const MAX_FLASHBOARD_PROMPT_HISTORY = 200;

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
      && leftRecord.result === rightRecord.result;
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
}

function removeFlashBoardActiveGenerationRecord(recordId: string): void {
  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: state.activeGenerationRecords.filter((record) => record.id !== recordId),
    selectedActiveGenerationRecordIds: state.selectedActiveGenerationRecordIds.filter((id) => id !== recordId),
  }));
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
  result: FlashBoardResult,
): void {
  const now = Date.now();
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    job: { ...record.job, status: 'completed', completedAt: now },
    result,
    updatedAt: now,
  }));
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
      startedAt: patch.status === 'processing' && record.job?.status !== 'processing'
        ? now
        : patch.startedAt ?? record.job?.startedAt,
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
}

export function submitFlashBoardActiveGenerationRequest(
  request: FlashBoardGenerationRequest,
): FlashBoardActiveGenerationRecord | null {
  const now = Date.now();
  const record: FlashBoardActiveGenerationRecord = {
    id: crypto.randomUUID(),
    kind: 'generation',
    createdAt: now,
    updatedAt: now,
    request,
    job: { status: 'queued' },
  };

  useFlashBoardStore.setState((state) => ({
    activeGenerationRecords: [...state.activeGenerationRecords, record],
  }));
  const prompts = [
    request.prompt,
    ...(request.multiPrompt ?? []).map((shot) => shot.prompt),
  ];
  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    appendFlashBoardPromptHistoryEntry({ kind: 'generation', prompt: prompts[index] });
  }

  flashBoardJobService.submit({ recordId: record.id, request });

  return getFlashBoardActiveGenerationRecord(record.id) ?? null;
}
