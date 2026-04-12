// Slot assignment actions slice - extracted from compositionSlice
// Manages Resolume-style slot grid assignments and per-slot clip behavior

import { flags } from '../../../engine/featureFlags';
import type {
  Composition,
  MediaSliceCreator,
  MediaState,
  SlotClipSettings,
  SlotDeckState,
} from '../types';

export const MIN_SLOT_CLIP_WINDOW_SECONDS = 0.05;

export interface SlotActions {
  moveSlot: (compId: string, toSlotIndex: number) => void;
  unassignSlot: (compId: string) => void;
  getSlotMap: (totalSlots: number) => (Composition | null)[];
  setSlotDeckState: (slotIndex: number, next: SlotDeckState) => void;
  clearSlotDeckState: (slotIndex: number) => void;
  selectSlotComposition: (compositionId: string | null) => void;
  ensureSlotClipSettings: (compositionId: string, duration: number) => void;
  updateSlotClipSettings: (compositionId: string, duration: number, updates: Partial<SlotClipSettings>) => void;
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

function getDefaultSlotClipSettings(duration: number): SlotClipSettings {
  const safeDuration = Math.max(duration, MIN_SLOT_CLIP_WINDOW_SECONDS);
  return {
    trimIn: 0,
    trimOut: safeDuration,
    endBehavior: 'loop',
  };
}

function normalizeSlotClipSettings(duration: number, settings?: Partial<SlotClipSettings> | null): SlotClipSettings {
  const defaults = getDefaultSlotClipSettings(duration);
  const safeDuration = defaults.trimOut;
  const requestedTrimIn = settings?.trimIn ?? defaults.trimIn;
  const requestedTrimOut = settings?.trimOut ?? defaults.trimOut;
  const endBehavior = settings?.endBehavior ?? defaults.endBehavior;

  if (safeDuration <= MIN_SLOT_CLIP_WINDOW_SECONDS) {
    return {
      trimIn: 0,
      trimOut: safeDuration,
      endBehavior,
    };
  }

  const trimIn = Math.max(0, Math.min(requestedTrimIn, safeDuration - MIN_SLOT_CLIP_WINDOW_SECONDS));
  const minTrimOut = Math.min(safeDuration, trimIn + MIN_SLOT_CLIP_WINDOW_SECONDS);
  const trimOut = Math.max(minTrimOut, Math.min(requestedTrimOut, safeDuration));

  return {
    trimIn,
    trimOut,
    endBehavior,
  };
}

function areSlotClipSettingsEqual(a: SlotClipSettings, b: SlotClipSettings): boolean {
  return a.trimIn === b.trimIn && a.trimOut === b.trimOut && a.endBehavior === b.endBehavior;
}

export const createSlotSlice: MediaSliceCreator<SlotActions> = (set, get) => ({
  moveSlot: (compId: string, toSlotIndex: number) => {
    const { slotAssignments, selectedSlotCompositionId } = get();
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

    const nextSelection =
      displacedCompId && sourceSlot === undefined && selectedSlotCompositionId === displacedCompId
        ? null
        : selectedSlotCompositionId;

    if (!flags.useWarmSlotDecks) {
      set({ slotAssignments: newAssignments, selectedSlotCompositionId: nextSelection });
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
      selectedSlotCompositionId: nextSelection,
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
    const { slotAssignments, selectedSlotCompositionId } = get();
    const newAssignments = { ...slotAssignments };
    const slotIndex = newAssignments[compId];
    delete newAssignments[compId];

    const nextSelection = selectedSlotCompositionId === compId ? null : selectedSlotCompositionId;

    if (!flags.useWarmSlotDecks) {
      set({ slotAssignments: newAssignments, selectedSlotCompositionId: nextSelection });
      return;
    }

    const nextDeckStates = { ...getSlotDeckStateMap(get()) };
    if (slotIndex !== undefined) {
      nextDeckStates[slotIndex] = createSlotDeckState(slotIndex, null, 'disposed');
    }

    set({
      slotAssignments: newAssignments,
      slotDeckStates: nextDeckStates,
      selectedSlotCompositionId: nextSelection,
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

  selectSlotComposition: (compositionId: string | null) => {
    set({ selectedSlotCompositionId: compositionId });
  },

  ensureSlotClipSettings: (compositionId: string, duration: number) => {
    set((state) => {
      const normalized = normalizeSlotClipSettings(duration, state.slotClipSettings[compositionId]);
      const current = state.slotClipSettings[compositionId];
      if (current && areSlotClipSettingsEqual(current, normalized)) {
        return {};
      }

      return {
        slotClipSettings: {
          ...state.slotClipSettings,
          [compositionId]: normalized,
        },
      };
    });
  },

  updateSlotClipSettings: (compositionId: string, duration: number, updates: Partial<SlotClipSettings>) => {
    set((state) => {
      const current = state.slotClipSettings[compositionId];
      const normalized = normalizeSlotClipSettings(duration, {
        ...(current ?? getDefaultSlotClipSettings(duration)),
        ...updates,
      });

      if (current && areSlotClipSettingsEqual(current, normalized)) {
        return {};
      }

      return {
        slotClipSettings: {
          ...state.slotClipSettings,
          [compositionId]: normalized,
        },
      };
    });
  },
});
