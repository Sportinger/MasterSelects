import type { MediaSliceCreator } from '../../types';
import type { Composition } from '../../types';
import { useSettingsStore } from '../../../settingsStore';
import { useTimelineStore } from '../../../timeline';
import { generateId } from '../../helpers/importPipeline';
import type { CompositionActions, CompositionDuplicateOptions } from '../compositionSlice';
import { Logger } from '../../../../services/logger';
import {
  invalidateCompositionDurationDependents,
  mirrorTimelineDataIntoComposition,
  readActiveTimelineSnapshot,
  syncActiveTimelineNestedCompReferences,
  syncInactiveCompositionNestedReferences,
} from './activeTimelineSync';
import { describeCompositionDuplicateBlocker, planCompositionDuplicate } from './compositionDuplicate';
import { collectPrivateChildCompositionIds } from './privateCompositionTree';
import { createDefaultCompositionTimelineData, lockTimelineDuration } from './timelineDataPlanner';
import { adjustClipTransformsOnResize } from './resizeTransforms';

const log = Logger.create('CompositionCrud');

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
      timelineData: settings?.timelineData ?? createDefaultCompositionTimelineData(duration, {
        // Passing an explicit composition duration is an authoring decision,
        // so clip edits must not replace it with the auto-duration minimum.
        durationLocked: settings?.duration !== undefined,
      }),
      transitionComp: settings?.transitionComp ? structuredClone(settings.transitionComp) : undefined,
      captionComp: settings?.captionComp ? structuredClone(settings.captionComp) : undefined,
    };

    set((state) => ({ compositions: [...state.compositions, comp] }));
    return comp;
  },

  duplicateComposition: (id: string, options?: CompositionDuplicateOptions) => {
    const state = get();
    const blocker = describeCompositionDuplicateBlocker(
      state.compositions.find((c) => c.id === id),
      id,
    );
    if (blocker) {
      log.warn('Composition duplicate refused', { compositionId: id, reason: blocker });
      return null;
    }

    // The stored timelineData of the active composition is only a lagging
    // mirror of the live timeline. When the source (or one of its private
    // transition/caption compositions) is active, snapshot the live timeline
    // and copy that, refreshing the original's mirror in the same write.
    const activeId = state.activeCompositionId;
    const sourcesActiveTimeline = activeId !== null && (
      activeId === id || collectPrivateChildCompositionIds(state.compositions, id).has(activeId)
    );
    let sourceCompositions: readonly Composition[] = state.compositions;
    let writesMirror = false;
    if (sourcesActiveTimeline) {
      const snapshot = readActiveTimelineSnapshot();
      if (snapshot.kind === 'live') {
        sourceCompositions = mirrorTimelineDataIntoComposition(state.compositions, activeId, snapshot.timelineData);
        writesMirror = snapshot.mayWriteMirror;
      } else {
        log.warn('Duplicating the stored timeline of the active composition', {
          compositionId: activeId,
          reason: snapshot.reason,
        });
      }
    }

    const requestedName = options?.name?.trim();
    let plan: ReturnType<typeof planCompositionDuplicate>;
    try {
      plan = planCompositionDuplicate({
        compositions: sourceCompositions,
        sourceId: id,
        name: requestedName || `${state.compositions.find((c) => c.id === id)!.name} Copy`,
        createId: generateId,
        createdAt: Date.now(),
      });
    } catch (error) {
      log.warn('Composition duplicate failed', { compositionId: id, error });
      return null;
    }
    if (plan.droppedTransitionCompositionIds.length > 0) {
      log.warn('Duplicate dropped references to missing transition compositions', {
        compositionId: id,
        missingCompositionIds: plan.droppedTransitionCompositionIds,
      });
    }

    set({
      compositions: [
        ...(writesMirror ? sourceCompositions : state.compositions),
        plan.duplicate,
        ...plan.privateCopies,
      ],
    });
    return plan.duplicate;
  },

  removeComposition: (id: string) => {
    const stateBeforeRemoval = get();
    const removedIds = collectPrivateChildCompositionIds(
      stateBeforeRemoval.compositions,
      id,
    );
    removedIds.add(id);
    const removesActiveComposition = stateBeforeRemoval.activeCompositionId !== null
      && removedIds.has(stateBeforeRemoval.activeCompositionId);

    set((state) => {
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

    if (removesActiveComposition) {
      // Removing the active composition also removes its live timeline. Leaving
      // those clips mounted would let later editor or AI actions mutate an
      // orphaned composition that no longer exists in the media library.
      useTimelineStore.getState().clearTimeline();
    }
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
    const timelineDuration = updates.timelineData?.duration;
    const hasDurationUpdate = updates.duration !== undefined || timelineDuration !== undefined;
    const nextDuration = hasDurationUpdate
      ? Math.max(minDuration, updates.duration ?? timelineDuration ?? previousDuration)
      : previousDuration;
    const durationChanged = hasDurationUpdate && nextDuration !== previousDuration;

    if (hasDurationUpdate) {
      normalizedUpdates.duration = nextDuration;
    }

    if (updates.width !== undefined || updates.height !== undefined) {
      const newW = updates.width ?? oldComp.width;
      const newH = updates.height ?? oldComp.height;
      if (newW !== oldComp.width || newH !== oldComp.height) {
        adjustClipTransformsOnResize(get, id, oldComp.width, oldComp.height, newW, newH, normalizedUpdates);
      }
    }

    if (updates.duration !== undefined && durationChanged) {
      normalizedUpdates.timelineData = lockTimelineDuration(
        normalizedUpdates.timelineData ?? oldComp.timelineData,
        nextDuration,
      );
    } else if (timelineDuration !== undefined && timelineDuration !== nextDuration && normalizedUpdates.timelineData) {
      normalizedUpdates.timelineData = {
        ...normalizedUpdates.timelineData,
        duration: nextDuration,
      };
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
