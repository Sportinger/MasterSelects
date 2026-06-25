import { vi } from 'vitest';

import { useMediaStore } from '../../src/stores/mediaStore';
import type { Composition, MediaFile, SlotClipSettings } from '../../src/stores/mediaStore/types';

type FakeMediaStore = {
  files: MediaFile[];
  compositions: Composition[];
  selectedIds: string[];
  activeCompositionId: string | null;
  openCompositionIds: string[];
  slotAssignments: Record<string, number>;
  slotClipSettings: Record<string, SlotClipSettings>;
  selectedSlotCompositionId: string | null;
  createComposition: (name: string, settings?: Partial<Composition>) => Composition;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  removeComposition: (id: string) => void;
};

let nextCompositionId = 0;

function createComposition(name: string, settings: Partial<Composition> = {}): Composition {
  const duration = settings.duration ?? settings.timelineData?.duration ?? 60;
  return {
    id: settings.id ?? `fake-comp-${++nextCompositionId}`,
    name,
    type: 'composition',
    parentId: settings.parentId ?? null,
    createdAt: settings.createdAt ?? 1,
    width: settings.width ?? 1920,
    height: settings.height ?? 1080,
    frameRate: settings.frameRate ?? 30,
    duration,
    backgroundColor: settings.backgroundColor ?? '#000000',
    timelineData: settings.timelineData ?? { tracks: [], clips: [], duration },
    transitionComp: settings.transitionComp,
  };
}

export function installFakeMediaStore(initial: Partial<FakeMediaStore> = {}): FakeMediaStore {
  nextCompositionId = 0;
  const state = {
    files: [],
    compositions: [],
    selectedIds: [],
    activeCompositionId: null,
    openCompositionIds: [],
    slotAssignments: {},
    slotClipSettings: {},
    selectedSlotCompositionId: null,
    ...initial,
  } as FakeMediaStore;

  state.createComposition = (name, settings) => {
    const composition = createComposition(name, settings);
    state.compositions = [...state.compositions, composition];
    return composition;
  };
  state.updateComposition = (id, updates) => {
    state.compositions = state.compositions.map((composition) =>
      composition.id === id ? { ...composition, ...updates } : composition
    );
  };
  state.removeComposition = (id) => {
    const removedIds = new Set<string>();
    const pending = [id];
    while (pending.length > 0) {
      const parentId = pending.pop()!;
      removedIds.add(parentId);
      state.compositions.forEach((composition) => {
        if (
          composition.transitionComp?.kind === 'transition-comp' &&
          composition.transitionComp.parentCompositionId === parentId &&
          !removedIds.has(composition.id)
        ) {
          pending.push(composition.id);
        }
      });
    }
    state.compositions = state.compositions.filter((composition) => !removedIds.has(composition.id));
    state.selectedIds = state.selectedIds.filter((selectedId) => !removedIds.has(selectedId));
    state.openCompositionIds = state.openCompositionIds.filter((compositionId) => !removedIds.has(compositionId));
    if (state.activeCompositionId && removedIds.has(state.activeCompositionId)) state.activeCompositionId = null;
    if (state.selectedSlotCompositionId && removedIds.has(state.selectedSlotCompositionId)) {
      state.selectedSlotCompositionId = null;
    }
  };

  vi.mocked(useMediaStore.getState).mockImplementation(() => state as ReturnType<typeof useMediaStore.getState>);
  vi.mocked(useMediaStore.setState).mockImplementation((partial: Parameters<typeof useMediaStore.setState>[0]) => {
    const patch = typeof partial === 'function' ? partial(state as ReturnType<typeof useMediaStore.getState>) : partial;
    Object.assign(state, patch);
  });
  (globalThis as typeof globalThis & {
    __mediaStoreModule?: { useMediaStore: typeof useMediaStore };
  }).__mediaStoreModule = { useMediaStore };

  return state;
}
