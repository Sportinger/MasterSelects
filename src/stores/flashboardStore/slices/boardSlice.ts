import type { FlashBoard, FlashBoardStoreState } from '../types';

type Set = (partial: Partial<FlashBoardStoreState> | ((state: FlashBoardStoreState) => Partial<FlashBoardStoreState>)) => void;
type Get = () => FlashBoardStoreState;

export interface BoardSliceActions {
  createBoard: (name: string) => FlashBoard;
  renameBoard: (id: string, name: string) => void;
  setActiveBoard: (id: string | null) => void;
  updateViewport: (boardId: string, viewport: Partial<FlashBoard['viewport']>) => void;
}

export const createBoardSlice = (set: Set, _get: Get): BoardSliceActions => ({
  createBoard: (name: string): FlashBoard => {
    const now = Date.now();
    const board: FlashBoard = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      nodes: [],
    };
    set((state) => ({
      boards: [...state.boards, board],
      activeBoardId: board.id,
    }));
    return board;
  },

  renameBoard: (id: string, name: string): void => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === id ? { ...b, name, updatedAt: Date.now() } : b
      ),
    }));
  },

  setActiveBoard: (id: string | null): void => {
    set({ activeBoardId: id });
  },

  updateViewport: (boardId: string, viewport: Partial<FlashBoard['viewport']>): void => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? { ...b, viewport: { ...b.viewport, ...viewport }, updatedAt: Date.now() }
          : b
      ),
    }));
  },
});
