import type { FlashBoard, FlashBoardNode, FlashBoardStoreState } from './types';

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
