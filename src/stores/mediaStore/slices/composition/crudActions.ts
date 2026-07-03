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

function stripTransitionCompositionIds(timelineData: Composition['timelineData']): Composition['timelineData'] {
  if (!timelineData) return timelineData;
  return {
    ...structuredClone(timelineData),
    clips: timelineData.clips.map((clip) => ({
      ...clip,
      transitionIn: clip.transitionIn ? { ...clip.transitionIn, compositionId: undefined } : undefined,
      transitionOut: clip.transitionOut ? { ...clip.transitionOut, compositionId: undefined } : undefined,
    })),
  };
}

function collectTransitionCompositionDescendantIds(
  compositions: readonly Composition[],
  rootId: string,
): Set<string> {
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    const parentComposition = compositions.find((composition) => composition.id === parentId);
    for (const clip of parentComposition?.timelineData?.clips ?? []) {
      for (const transition of [clip.transitionIn, clip.transitionOut]) {
        if (transition?.compositionId && !ids.has(transition.compositionId)) {
          ids.add(transition.compositionId);
          pending.push(transition.compositionId);
        }
      }
    }
    for (const composition of compositions) {
      if (
        composition.transitionComp?.kind !== 'transition-comp' ||
        composition.transitionComp.parentCompositionId !== parentId ||
        ids.has(composition.id)
      ) {
        continue;
      }
      ids.add(composition.id);
      pending.push(composition.id);
    }
  }
  return ids;
}

function stripRemovedTransitionCompositionRefs(
  composition: Composition,
  removedIds: ReadonlySet<string>,
): Composition {
  if (!composition.timelineData) return composition;
  let changed = false;
  const clips = composition.timelineData.clips.map((clip) => {
    let nextClip = clip;
    if (clip.transitionOut?.compositionId && removedIds.has(clip.transitionOut.compositionId)) {
      changed = true;
      nextClip = { ...nextClip, transitionOut: { ...clip.transitionOut, compositionId: undefined } };
    }
    if (clip.transitionIn?.compositionId && removedIds.has(clip.transitionIn.compositionId)) {
      changed = true;
      nextClip = { ...nextClip, transitionIn: { ...clip.transitionIn, compositionId: undefined } };
    }
    return nextClip;
  });
  return changed ? { ...composition, timelineData: { ...composition.timelineData, clips } } : composition;
}

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
    if (original.transitionComp?.kind === 'transition-comp') return null;

    const duplicate: Composition = {
      ...original,
      id: generateId(),
      name: `${original.name} Copy`,
      createdAt: Date.now(),
      timelineData: stripTransitionCompositionIds(original.timelineData),
      transitionComp: undefined,
    };

    set((state) => ({ compositions: [...state.compositions, duplicate] }));
    return duplicate;
  },

  removeComposition: (id: string) => {
    set((state) => {
      const removedIds = collectTransitionCompositionDescendantIds(state.compositions, id);
      removedIds.add(id);
      const newAssignments = { ...state.slotAssignments };
      const newSlotClipSettings = { ...state.slotClipSettings };
      for (const removedId of removedIds) {
        delete newAssignments[removedId];
        delete newSlotClipSettings[removedId];
      }
      return {
        compositions: state.compositions
          .filter((c) => !removedIds.has(c.id))
          .map((c) => stripRemovedTransitionCompositionRefs(c, removedIds)),
        selectedIds: state.selectedIds.filter((sid) => !removedIds.has(sid)),
        activeCompositionId: state.activeCompositionId && removedIds.has(state.activeCompositionId) ? null : state.activeCompositionId,
        openCompositionIds: state.openCompositionIds.filter((cid) => !removedIds.has(cid)),
        slotAssignments: newAssignments,
        slotClipSettings: newSlotClipSettings,
        selectedSlotCompositionId: state.selectedSlotCompositionId && removedIds.has(state.selectedSlotCompositionId) ? null : state.selectedSlotCompositionId,
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
    const isTransitionComposition =
      oldComp.transitionComp?.kind === 'transition-comp' ||
      updates.transitionComp?.kind === 'transition-comp';
    const minDuration = isTransitionComposition ? 0.0001 : 1;
    const nextDuration = updates.duration !== undefined
      ? Math.max(minDuration, updates.duration)
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
