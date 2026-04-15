import type { FlashBoard, FlashBoardNode, FlashBoardStoreState } from './types';

export interface FlashBoardMediaReferenceUsage {
  start: boolean;
  end: boolean;
  reference: boolean;
}

const EMPTY_NODES: FlashBoardNode[] = [];
const EMPTY_REFERENCE_IDS: string[] = [];

let cachedReferenceUsageNodes: FlashBoardNode[] = EMPTY_NODES;
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

export const selectActiveBoard = (state: FlashBoardStoreState): FlashBoard | undefined =>
  state.boards.find((b) => b.id === state.activeBoardId);

export const selectActiveBoardNodes = (state: FlashBoardStoreState): FlashBoardNode[] => {
  const board = state.boards.find((b) => b.id === state.activeBoardId);
  return board?.nodes ?? [];
};

export const selectNodeById = (state: FlashBoardStoreState, nodeId: string): FlashBoardNode | undefined => {
  for (const board of state.boards) {
    const node = board.nodes.find((n) => n.id === nodeId);
    if (node) return node;
  }
  return undefined;
};

export const selectSelectedNodes = (state: FlashBoardStoreState): FlashBoardNode[] => {
  const ids = new Set(state.selectedNodeIds);
  if (ids.size === 0) return [];
  const board = state.boards.find((b) => b.id === state.activeBoardId);
  if (!board) return [];
  return board.nodes.filter((n) => ids.has(n.id));
};

export const selectQueuedNodes = (state: FlashBoardStoreState): FlashBoardNode[] => {
  const nodes: FlashBoardNode[] = [];
  for (const board of state.boards) {
    for (const node of board.nodes) {
      if (node.job?.status === 'queued') nodes.push(node);
    }
  }
  return nodes;
};

export const selectProcessingNodes = (state: FlashBoardStoreState): FlashBoardNode[] => {
  const nodes: FlashBoardNode[] = [];
  for (const board of state.boards) {
    for (const node of board.nodes) {
      if (node.job?.status === 'processing') nodes.push(node);
    }
  }
  return nodes;
};

export const selectActiveBoardReferenceUsageByMediaFileId = (
  state: FlashBoardStoreState
): Record<string, FlashBoardMediaReferenceUsage> => {
  const board = selectActiveBoard(state);
  const boardNodes = board?.nodes ?? EMPTY_NODES;
  const composerReferenceIds = state.composer.referenceMediaFileIds ?? EMPTY_REFERENCE_IDS;

  if (
    cachedReferenceUsageNodes === boardNodes &&
    cachedReferenceUsageComposerStart === state.composer.startMediaFileId &&
    cachedReferenceUsageComposerEnd === state.composer.endMediaFileId &&
    cachedReferenceUsageComposerReferenceIds === composerReferenceIds
  ) {
    return cachedReferenceUsageResult;
  }

  const usageByMediaId: Record<string, FlashBoardMediaReferenceUsage> = {};

  for (const node of boardNodes) {
    const request = node.request;
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

  cachedReferenceUsageNodes = boardNodes;
  cachedReferenceUsageComposerStart = state.composer.startMediaFileId;
  cachedReferenceUsageComposerEnd = state.composer.endMediaFileId;
  cachedReferenceUsageComposerReferenceIds = composerReferenceIds;
  cachedReferenceUsageResult = usageByMediaId;

  return usageByMediaId;
};
