import type { MediaSliceCreator } from '../../types';
import type { Composition } from '../../types';
import { useSettingsStore } from '../../../settingsStore';
import { generateId } from '../../helpers/importPipeline';
import type { CompositionActions } from '../compositionSlice';
import {
  invalidateCompositionDurationDependents,
  syncActiveTimelineNestedCompReferences,
  syncInactiveCompositionNestedReferences,
} from './activeTimelineSync';
import { createDefaultCompositionTimelineData, lockTimelineDuration } from './timelineDataPlanner';
import { adjustClipTransformsOnResize } from './resizeTransforms';

export const createCompositionCrudActions: MediaSliceCreator<Pick<
  CompositionActions,
  | 'createComposition'
  | 'duplicateComposition'
  | 'removeComposition'
  | 'updateComposition'
  | 'getActiveComposition'
>> = (set, get) => ({
  createComposition: (name: string, settings?: Partial<Composition>) => {
    const { outputResolution } = useSettingsStore.getState();
    const duration = settings?.duration ?? 60;
    const comp: Composition = {
      id: generateId(),
      name,
      type: 'composition',
      parentId: settings?.parentId ?? null,
      createdAt: Date.now(),
      width: settings?.width ?? outputResolution.width,
      height: settings?.height ?? outputResolution.height,
      frameRate: settings?.frameRate ?? 30,
      duration,
      backgroundColor: settings?.backgroundColor ?? '#000000',
      timelineData: settings?.timelineData ?? createDefaultCompositionTimelineData(duration),
      transitionComp: settings?.transitionComp ? structuredClone(settings.transitionComp) : undefined,
    };

    set((state) => ({ compositions: [...state.compositions, comp] }));
    return comp;
  },

  duplicateComposition: (id: string) => {
    const original = get().compositions.find((c) => c.id === id);
    if (!original) return null;

    const duplicate: Composition = {
      ...original,
      id: generateId(),
      name: `${original.name} Copy`,
      createdAt: Date.now(),
    };

    set((state) => ({ compositions: [...state.compositions, duplicate] }));
    return duplicate;
  },

  removeComposition: (id: string) => {
    set((state) => {
      const newAssignments = { ...state.slotAssignments };
      const newSlotClipSettings = { ...state.slotClipSettings };
      delete newAssignments[id];
      delete newSlotClipSettings[id];
      return {
        compositions: state.compositions.filter((c) => c.id !== id),
        selectedIds: state.selectedIds.filter((sid) => sid !== id),
        activeCompositionId: state.activeCompositionId === id ? null : state.activeCompositionId,
        openCompositionIds: state.openCompositionIds.filter((cid) => cid !== id),
        slotAssignments: newAssignments,
        slotClipSettings: newSlotClipSettings,
        selectedSlotCompositionId: state.selectedSlotCompositionId === id ? null : state.selectedSlotCompositionId,
      };
    });
  },

  updateComposition: (id: string, updates: Partial<Composition>) => {
    const oldComp = get().compositions.find((c) => c.id === id);
    if (!oldComp) {
      return;
    }

    const normalizedUpdates: Partial<Composition> = { ...updates };
    const previousDuration = oldComp.timelineData?.duration ?? oldComp.duration;
    const nextDuration = updates.duration !== undefined
      ? Math.max(1, updates.duration)
      : previousDuration;
    const durationChanged = updates.duration !== undefined && nextDuration !== previousDuration;

    if (updates.width !== undefined || updates.height !== undefined) {
      const newW = updates.width ?? oldComp.width;
      const newH = updates.height ?? oldComp.height;
      if (newW !== oldComp.width || newH !== oldComp.height) {
        adjustClipTransformsOnResize(get, id, oldComp.width, oldComp.height, newW, newH, normalizedUpdates);
      }
    }

    if (durationChanged) {
      normalizedUpdates.duration = nextDuration;
      normalizedUpdates.timelineData = lockTimelineDuration(
        normalizedUpdates.timelineData ?? oldComp.timelineData,
        nextDuration,
      );
    }

    set((state) => ({
      compositions: state.compositions.map((c) =>
        c.id === id
          ? { ...c, ...normalizedUpdates }
          : !durationChanged
            ? c
            : syncInactiveCompositionNestedReferences(
                c,
                state.activeCompositionId,
                id,
                previousDuration,
                nextDuration,
              )
      ),
    }));

    if (durationChanged) {
      syncActiveTimelineNestedCompReferences(get().activeCompositionId, id, previousDuration, nextDuration);
      invalidateCompositionDurationDependents(id);
    }
  },

  getActiveComposition: () => {
    const { compositions, activeCompositionId } = get();
    return compositions.find((c) => c.id === activeCompositionId);
  },
});
