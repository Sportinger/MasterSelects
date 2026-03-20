// Slot assignment actions slice - extracted from compositionSlice
// Manages Resolume-style slot grid assignments

import { flags } from '../../../engine/featureFlags';
import type { Composition, MediaSliceCreator, MediaState, SlotDeckState } from '../types';

export interface SlotActions {
  moveSlot: (compId: string, toSlotIndex: number) => void;
  unassignSlot: (compId: string) => void;
  getSlotMap: (totalSlots: number) => (Composition | null)[];
  setSlotDeckState: (slotIndex: number, next: SlotDeckState) => void;
  clearSlotDeckState: (slotIndex: number) => void;
}

interface SlotDeckManagerLike {
  prepareSlot: (slotIndex: number, compositionId: string) => void;
  disposeSlot: (slotIndex: number) => void;
  disposeAll: () => void;
  adoptDeckToLayer: (slotIndex: number, layerIndex: number, initialElapsed?: number) => boolean;
  getSlotState: (slotIndex: number) => SlotDeckState | null;
}

function resolveSlotDeckManager(): SlotDeckManagerLike | null {
  const globalScope = globalThis as typeof globalThis & { __slotDeckManager?: SlotDeckManagerLike };
  return globalScope.__slotDeckManager ?? null;
}

function createSlotDeckState(
  slotIndex: number,
  compositionId: string | null,
  status: SlotDeckState['status'],
  overrides?: Partial<SlotDeckState>
): SlotDeckState {
  const now = Date.now();
  return {
    slotIndex,
    compositionId,
    status,
    preparedClipCount: 0,
    readyClipCount: 0,
    firstFrameReady: false,
    decoderMode: 'unknown',
    lastPreparedAt: status === 'disposed' || status === 'cold' ? null : now,
    lastActivatedAt: null,
    lastError: null,
    pinnedLayerIndex: null,
    ...overrides,
  };
}

function getSlotDeckStateMap(state: MediaState): Record<number, SlotDeckState> {
  return state.slotDeckStates ?? {};
}

function setSlotDeckStateMap(
  state: MediaState,
  slotIndex: number,
  next: SlotDeckState
): Partial<MediaState> {
  return {
    slotDeckStates: {
      ...getSlotDeckStateMap(state),
      [slotIndex]: next,
    },
  };
}

function clearSlotDeckStateMap(state: MediaState, slotIndex: number): Partial<MediaState> {
  const next = { ...getSlotDeckStateMap(state) };
  delete next[slotIndex];
  return { slotDeckStates: next };
}

function findCompAtSlot(slotAssignments: Record<string, number>, slotIndex: number, excludeCompId?: string): string | undefined {
  for (const [compId, idx] of Object.entries(slotAssignments)) {
    if (idx === slotIndex && compId !== excludeCompId) {
      return compId;
    }
  }
  return undefined;
}

export const createSlotSlice: MediaSliceCreator<SlotActions> = (set, get) => ({
  moveSlot: (compId: string, toSlotIndex: number) => {
    const { slotAssignments } = get();
    const newAssignments = { ...slotAssignments };
    const sourceSlot = newAssignments[compId];
    const displacedCompId = findCompAtSlot(newAssignments, toSlotIndex, compId);

    // Remove any comp currently at the target slot
    if (displacedCompId) {
      if (sourceSlot !== undefined) {
        // Swap: move displaced comp to the dragged comp's old slot
        newAssignments[displacedCompId] = sourceSlot;
      } else {
        delete newAssignments[displacedCompId];
      }
    }

    newAssignments[compId] = toSlotIndex;

    if (!flags.useWarmSlotDecks) {
      set({ slotAssignments: newAssignments });
      return;
    }

    const nextDeckStates = { ...getSlotDeckStateMap(get()) };
    const sourceDeckWasSwapped = sourceSlot !== undefined && sourceSlot !== toSlotIndex && !!displacedCompId;
    const sourceDeckWasCleared = sourceSlot !== undefined && sourceSlot !== toSlotIndex && !displacedCompId;

    if (sourceDeckWasSwapped && displacedCompId) {
      nextDeckStates[sourceSlot] = createSlotDeckState(sourceSlot, displacedCompId, 'warming');
    } else if (sourceDeckWasCleared) {
      nextDeckStates[sourceSlot] = createSlotDeckState(sourceSlot, null, 'disposed');
    }

    if (toSlotIndex !== sourceSlot) {
      nextDeckStates[toSlotIndex] = createSlotDeckState(toSlotIndex, compId, 'warming');
    }

    set({
      slotAssignments: newAssignments,
      slotDeckStates: nextDeckStates,
    });

    const slotDeckManager = resolveSlotDeckManager();
    if (!slotDeckManager) {
      return;
    }

    if (sourceSlot !== undefined && sourceSlot !== toSlotIndex) {
      slotDeckManager.disposeSlot(sourceSlot);
    }

    if (sourceSlot === undefined && displacedCompId) {
      slotDeckManager.disposeSlot(toSlotIndex);
    }

    if (sourceDeckWasSwapped && displacedCompId) {
      slotDeckManager.prepareSlot(sourceSlot, displacedCompId);
    }

    slotDeckManager.prepareSlot(toSlotIndex, compId);
  },

  unassignSlot: (compId: string) => {
    const { slotAssignments } = get();
    const newAssignments = { ...slotAssignments };
    const slotIndex = newAssignments[compId];
    delete newAssignments[compId];

    if (!flags.useWarmSlotDecks) {
      set({ slotAssignments: newAssignments });
      return;
    }

    const nextDeckStates = { ...getSlotDeckStateMap(get()) };
    if (slotIndex !== undefined) {
      nextDeckStates[slotIndex] = createSlotDeckState(slotIndex, null, 'disposed');
    }

    set({
      slotAssignments: newAssignments,
      slotDeckStates: nextDeckStates,
    });

    if (slotIndex !== undefined) {
      resolveSlotDeckManager()?.disposeSlot(slotIndex);
    }
  },

  getSlotMap: (totalSlots: number) => {
    const { compositions, slotAssignments } = get();
    const map: (Composition | null)[] = new Array(totalSlots).fill(null);

    for (const [compId, slotIdx] of Object.entries(slotAssignments)) {
      if (slotIdx >= 0 && slotIdx < totalSlots) {
        const comp = compositions.find((c: Composition) => c.id === compId);
        if (comp) {
          map[slotIdx] = comp;
        }
      }
    }

    return map;
  },

  setSlotDeckState: (slotIndex: number, next: SlotDeckState) => {
    set((state) => setSlotDeckStateMap(state, slotIndex, next));
  },

  clearSlotDeckState: (slotIndex: number) => {
    set((state) => clearSlotDeckStateMap(state, slotIndex));
  },
});
