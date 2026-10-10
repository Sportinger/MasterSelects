import type { Composition } from '../../types';
import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../../../types/timeline';
import { compositionRenderer } from '../../../../services/compositionRenderer';
import { isProjectStoreSyncInProgress } from '../../../../services/project/projectStoreSyncGuard';
import { getEditorRepositorySession } from '../../../../services/project/repository/transaction/editorMutationRuntime';
import { useTimelineStore } from '../../../timeline';
import {
  syncNestedCompReferenceClip,
  syncTimelineDataNestedCompReferences,
} from './timelineDataPlanner';
import { syncTransitionCompositionTimelineToParent } from './transitionCompositionSync';

/**
 * Write a serialized timeline into its composition's stored `timelineData`.
 *
 * The active composition's `timelineData` is only a mirror of the live
 * timeline store: the composition switch and the periodic timeline autosave
 * refresh it, so between those writes it can be up to one autosave interval
 * old. This is the single mirror write those paths share; readers that need
 * the current content of the active composition use it with
 * `readActiveTimelineSnapshot()` instead of reading the stale mirror.
 */
export function mirrorTimelineDataIntoComposition(
  compositions: readonly Composition[],
  compositionId: string,
  timelineData: CompositionTimelineData,
): Composition[] {
  return syncTransitionCompositionTimelineToParent(
    compositions.map((composition) =>
      composition.id === compositionId
        ? { ...composition, duration: timelineData.duration, timelineData }
        : composition
    ),
    compositionId,
    timelineData,
  );
}

export type ActiveTimelineSnapshot =
  | {
      kind: 'live';
      timelineData: CompositionTimelineData;
      /**
       * False while an editor repository session owns the mirror: it projects
       * every canonical timeline edit into `timelineData` itself, so callers
       * must not write the mirror a second time.
       */
      mayWriteMirror: boolean;
    }
  | { kind: 'unavailable'; reason: string };

/**
 * Serialize the live timeline of the active composition with the canonical
 * timeline serializer (`getSerializableState`, as used by the composition
 * switch and project save).
 *
 * While a timeline restore or project sync holds the store-sync guard the live
 * timeline may be partially restored, so no snapshot is taken; the caller must
 * either wait (`waitForProjectStoreSync`) or fall back to the stored mirror and
 * say so.
 */
export function readActiveTimelineSnapshot(): ActiveTimelineSnapshot {
  if (isProjectStoreSyncInProgress()) {
    return {
      kind: 'unavailable',
      reason: 'a timeline restore or project sync is in progress, so the live timeline may be incomplete',
    };
  }
  return {
    kind: 'live',
    timelineData: useTimelineStore.getState().getSerializableState(),
    mayWriteMirror: getEditorRepositorySession() === null,
  };
}

export type NestedCompReferenceClip =
  Pick<SerializableClip, 'isComposition' | 'compositionId' | 'inPoint' | 'outPoint' | 'duration'> &
  Partial<Pick<SerializableClip, 'sourceType' | 'naturalDuration' | 'waveform'>> &
  Partial<Pick<TimelineClip, 'source'>>;

export function syncInactiveCompositionNestedReferences(
  composition: Composition,
  activeCompositionId: string | null,
  changedCompositionId: string,
  previousDuration: number,
  nextDuration: number,
): Composition {
  if (composition.id === activeCompositionId) {
    return composition;
  }

  return {
    ...composition,
    timelineData: syncTimelineDataNestedCompReferences(
      composition.timelineData,
      changedCompositionId,
      previousDuration,
      nextDuration,
    ),
  };
}

export function syncActiveTimelineNestedCompReferences(
  activeCompositionId: string | null,
  compositionId: string,
  previousDuration: number,
  nextDuration: number,
): void {
  if (!activeCompositionId || activeCompositionId === compositionId) {
    return;
  }

  const timelineStore = useTimelineStore.getState();
  const audioClipIds: string[] = [];
  let changed = false;

  const updatedClips = timelineStore.clips.map((clip) => {
    const updatedClip = syncNestedCompReferenceClip(
      clip,
      compositionId,
      previousDuration,
      nextDuration,
    );
    if (updatedClip !== clip) {
      changed = true;
      if (updatedClip.source?.type === 'audio') {
        audioClipIds.push(updatedClip.id);
      }
    }
    return updatedClip;
  });

  if (!changed) {
    return;
  }

  useTimelineStore.setState({ clips: updatedClips });

  const refreshedTimelineStore = useTimelineStore.getState();
  refreshedTimelineStore.updateDuration();
  refreshedTimelineStore.invalidateCache();
  void refreshedTimelineStore.refreshCompClipNestedData(compositionId);

  for (const clipId of audioClipIds) {
    void refreshedTimelineStore.generateWaveformForClip(clipId);
  }
}

export function invalidateCompositionDurationDependents(compositionId: string): void {
  compositionRenderer.invalidateCompositionAndParents(compositionId);
}
