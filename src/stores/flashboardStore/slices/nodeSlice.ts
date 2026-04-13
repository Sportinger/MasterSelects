import type { FlashBoard, FlashBoardNode, FlashBoardGenerationRequest, FlashBoardJobState, FlashBoardResult, FlashBoardStoreState } from '../types';

type Set = (partial: Partial<FlashBoardStoreState> | ((state: FlashBoardStoreState) => Partial<FlashBoardStoreState>)) => void;
type Get = () => FlashBoardStoreState;

export interface NodeSliceActions {
  createDraftNode: (boardId: string, position?: { x: number; y: number }) => FlashBoardNode;
  createReferenceNode: (boardId: string, mediaFileId: string, position?: { x: number; y: number }) => FlashBoardNode;
  updateNodeRequest: (nodeId: string, patch: Partial<FlashBoardGenerationRequest>) => void;
  queueNode: (nodeId: string) => void;
  updateNodeJob: (nodeId: string, patch: Partial<FlashBoardJobState>) => void;
  completeNode: (nodeId: string, result: FlashBoardResult) => void;
  failNode: (nodeId: string, error: string) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  resizeNode: (nodeId: string, size: { width: number; height: number }) => void;
  duplicateNode: (nodeId: string) => FlashBoardNode | null;
  removeNode: (nodeId: string) => void;
  setSelectedNodes: (nodeIds: string[]) => void;
  clearSelection: () => void;
}

function findAndUpdateNode(
  boards: FlashBoard[],
  nodeId: string,
  updater: (node: FlashBoardNode) => FlashBoardNode
): FlashBoard[] {
  return boards.map((board) => {
    const idx = board.nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) return board;
    const updatedNodes = [...board.nodes];
    updatedNodes[idx] = updater(updatedNodes[idx]);
    return { ...board, nodes: updatedNodes, updatedAt: Date.now() };
  });
}

export const createNodeSlice = (set: Set, get: Get): NodeSliceActions => ({
  createDraftNode: (boardId: string, position?: { x: number; y: number }): FlashBoardNode => {
    const now = Date.now();
    const node: FlashBoardNode = {
      id: crypto.randomUUID(),
      kind: 'generation',
      createdAt: now,
      updatedAt: now,
      position: position ?? { x: 0, y: 0 },
      size: { width: 280, height: 320 },
      job: { status: 'draft' },
    };
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? { ...b, nodes: [...b.nodes, node], updatedAt: now }
          : b
      ),
    }));
    return node;
  },

  createReferenceNode: (boardId: string, mediaFileId: string, position?: { x: number; y: number }): FlashBoardNode => {
    const now = Date.now();
    const node: FlashBoardNode = {
      id: crypto.randomUUID(),
      kind: 'reference',
      createdAt: now,
      updatedAt: now,
      position: position ?? { x: 0, y: 0 },
      size: { width: 200, height: 160 },
      result: { mediaFileId, mediaType: 'video' },
    };
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? { ...b, nodes: [...b.nodes, node], updatedAt: now }
          : b
      ),
    }));
    return node;
  },

  updateNodeRequest: (nodeId: string, patch: Partial<FlashBoardGenerationRequest>): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        request: { ...node.request, ...patch } as FlashBoardGenerationRequest,
        updatedAt: Date.now(),
      })),
    }));
  },

  queueNode: (nodeId: string): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        job: { ...node.job, status: 'queued' as const },
        updatedAt: Date.now(),
      })),
    }));
  },

  updateNodeJob: (nodeId: string, patch: Partial<FlashBoardJobState>): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        job: { ...node.job, ...patch } as FlashBoardJobState,
        updatedAt: Date.now(),
      })),
    }));
  },

  completeNode: (nodeId: string, result: FlashBoardResult): void => {
    const now = Date.now();
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        job: { ...node.job, status: 'completed' as const, completedAt: now },
        result,
        updatedAt: now,
      })),
    }));
  },

  failNode: (nodeId: string, error: string): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        job: { ...node.job, status: 'failed' as const, error },
        updatedAt: Date.now(),
      })),
    }));
  },

  moveNode: (nodeId: string, position: { x: number; y: number }): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        position,
        updatedAt: Date.now(),
      })),
    }));
  },

  resizeNode: (nodeId: string, size: { width: number; height: number }): void => {
    set((state) => ({
      boards: findAndUpdateNode(state.boards, nodeId, (node) => ({
        ...node,
        size,
        updatedAt: Date.now(),
      })),
    }));
  },

  duplicateNode: (nodeId: string): FlashBoardNode | null => {
    const state = get();
    let sourceNode: FlashBoardNode | undefined;
    let sourceBoardId: string | undefined;
    for (const board of state.boards) {
      const found = board.nodes.find((n) => n.id === nodeId);
      if (found) {
        sourceNode = found;
        sourceBoardId = board.id;
        break;
      }
    }
    if (!sourceNode || !sourceBoardId) return null;

    const now = Date.now();
    const duplicate: FlashBoardNode = {
      ...structuredClone(sourceNode),
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      position: {
        x: sourceNode.position.x + 30,
        y: sourceNode.position.y + 30,
      },
    };

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === sourceBoardId
          ? { ...b, nodes: [...b.nodes, duplicate], updatedAt: now }
          : b
      ),
    }));
    return duplicate;
  },

  removeNode: (nodeId: string): void => {
    set((state) => ({
      boards: state.boards.map((b) => {
        const idx = b.nodes.findIndex((n) => n.id === nodeId);
        if (idx === -1) return b;
        return {
          ...b,
          nodes: b.nodes.filter((n) => n.id !== nodeId),
          updatedAt: Date.now(),
        };
      }),
      selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
    }));
  },

  setSelectedNodes: (nodeIds: string[]): void => {
    set({ selectedNodeIds: nodeIds });
  },

  clearSelection: (): void => {
    set({ selectedNodeIds: [] });
  },
});
