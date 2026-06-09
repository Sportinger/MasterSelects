import { flashBoardJobService } from '../../services/flashboard/FlashBoardJobService';
import { useFlashBoardStore } from './index';
import { createDefaultFlashBoardComposer } from './defaults';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
  FlashBoardJobState,
  FlashBoardResult,
  FlashBoardStoreState,
} from './types';

export type { FlashBoardActiveGenerationRecord } from './types';

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

export function getFlashBoardActiveGenerationRecords(): FlashBoardActiveGenerationRecord[] {
  return selectFlashBoardActiveGenerationRecords(useFlashBoardStore.getState());
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
  return useFlashBoardStore.getState().activeGenerationRecords.find((record) => record.id === recordId);
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
): void {
  updateFlashBoardActiveGenerationRecord(recordId, (record) => ({
    ...record,
    job: { ...record.job, status: 'failed', error },
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
    hoveredComposerReference: null,
  });
}

export function hydrateFlashBoardActiveGenerationRecords(
  records: FlashBoardActiveGenerationRecord[],
): void {
  useFlashBoardStore.setState({
    activeGenerationRecords: records,
    selectedActiveGenerationRecordIds: [],
    composer: createDefaultFlashBoardComposer(),
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

  flashBoardJobService.submit({ recordId: record.id, request });

  return getFlashBoardActiveGenerationRecord(record.id) ?? null;
}
