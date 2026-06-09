import type { FlashBoardActiveGenerationRecord, FlashBoardStoreState } from './types';

export interface FlashBoardMediaReferenceUsage {
  start: boolean;
  end: boolean;
  reference: boolean;
}

const EMPTY_RECORDS: FlashBoardActiveGenerationRecord[] = [];
const EMPTY_REFERENCE_IDS: string[] = [];

let cachedReferenceUsageRecords: FlashBoardActiveGenerationRecord[] = EMPTY_RECORDS;
let cachedReferenceUsageComposerStart: string | undefined;
let cachedReferenceUsageComposerEnd: string | undefined;
let cachedReferenceUsageComposerReferenceIds: string[] = EMPTY_REFERENCE_IDS;
let cachedReferenceUsageResult: Record<string, FlashBoardMediaReferenceUsage> = {};

function markReferenceUsage(
  usageByMediaId: Record<string, FlashBoardMediaReferenceUsage>,
  mediaFileId: string | undefined,
  role: keyof FlashBoardMediaReferenceUsage,
): void {
  if (!mediaFileId) {
    return;
  }

  usageByMediaId[mediaFileId] ??= {
    start: false,
    end: false,
    reference: false,
  };
  usageByMediaId[mediaFileId][role] = true;
}

export const selectActiveBoardReferenceUsageByMediaFileId = (
  state: FlashBoardStoreState
): Record<string, FlashBoardMediaReferenceUsage> => {
  const records = state.activeGenerationRecords;
  const composerReferenceIds = state.composer.referenceMediaFileIds ?? EMPTY_REFERENCE_IDS;

  if (
    cachedReferenceUsageRecords === records &&
    cachedReferenceUsageComposerStart === state.composer.startMediaFileId &&
    cachedReferenceUsageComposerEnd === state.composer.endMediaFileId &&
    cachedReferenceUsageComposerReferenceIds === composerReferenceIds
  ) {
    return cachedReferenceUsageResult;
  }

  const usageByMediaId: Record<string, FlashBoardMediaReferenceUsage> = {};

  for (const record of records) {
    const request = record.request;
    if (!request) {
      continue;
    }

    markReferenceUsage(usageByMediaId, request.startMediaFileId, 'start');
    markReferenceUsage(usageByMediaId, request.endMediaFileId, 'end');

    for (const mediaFileId of request.referenceMediaFileIds ?? []) {
      markReferenceUsage(usageByMediaId, mediaFileId, 'reference');
    }
  }

  markReferenceUsage(usageByMediaId, state.composer.startMediaFileId, 'start');
  markReferenceUsage(usageByMediaId, state.composer.endMediaFileId, 'end');

  for (const mediaFileId of composerReferenceIds) {
    markReferenceUsage(usageByMediaId, mediaFileId, 'reference');
  }

  cachedReferenceUsageRecords = records;
  cachedReferenceUsageComposerStart = state.composer.startMediaFileId;
  cachedReferenceUsageComposerEnd = state.composer.endMediaFileId;
  cachedReferenceUsageComposerReferenceIds = composerReferenceIds;
  cachedReferenceUsageResult = usageByMediaId;

  return usageByMediaId;
};
