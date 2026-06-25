import { ensureTransitionCompositionForPair } from '../../../services/timeline/transitionCompositionService';
import type { TimelineClip, TimelineStore } from '../types';
import type { useMediaStore } from '../../mediaStore';

type TimelineSet = (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void;
type TimelineGet = () => TimelineStore;
type MediaStoreHook = typeof useMediaStore;

function getMediaStore(): MediaStoreHook | null {
  return (globalThis as typeof globalThis & {
    __mediaStoreModule?: { useMediaStore: MediaStoreHook };
  }).__mediaStoreModule?.useMediaStore ?? null;
}

function getMediaState(): ReturnType<MediaStoreHook['getState']> | null {
  return getMediaStore()?.getState() ?? null;
}

function collectTransitionCompositionIds(clips: readonly TimelineClip[]): Set<string> {
  const ids = new Set<string>();
  for (const clip of clips) {
    if (clip.transitionOut?.compositionId) ids.add(clip.transitionOut.compositionId);
    if (clip.transitionIn?.compositionId) ids.add(clip.transitionIn.compositionId);
  }
  return ids;
}

export function clearTransitionsLinkedToRemovedClips(
  clips: readonly TimelineClip[],
  removedClipIds: ReadonlySet<string>,
): TimelineClip[] {
  return clips.map((clip) => {
    const removeTransitionOut = !!clip.transitionOut?.linkedClipId && removedClipIds.has(clip.transitionOut.linkedClipId);
    const removeTransitionIn = !!clip.transitionIn?.linkedClipId && removedClipIds.has(clip.transitionIn.linkedClipId);
    if (!removeTransitionOut && !removeTransitionIn) return clip;
    return {
      ...clip,
      ...(removeTransitionOut ? { transitionOut: undefined } : {}),
      ...(removeTransitionIn ? { transitionIn: undefined } : {}),
    };
  });
}

function timelineReferencesTransitionComposition(clips: readonly { transitionIn?: { compositionId?: string }; transitionOut?: { compositionId?: string } }[], compositionId: string): boolean {
  return clips.some((clip) =>
    clip.transitionOut?.compositionId === compositionId ||
    clip.transitionIn?.compositionId === compositionId
  );
}

function isReferencedByOtherComposition(compositionId: string, editedParentCompositionId: string | null): boolean {
  return getMediaState()?.compositions.some((composition) => {
    if (composition.id === editedParentCompositionId) return false;
    if (composition.transitionComp?.kind === 'transition-comp') return false;
    return timelineReferencesTransitionComposition(composition.timelineData?.clips ?? [], compositionId);
  }) ?? false;
}

export function removeDetachedTransitionCompositions(
  before: readonly TimelineClip[],
  after: readonly TimelineClip[],
): void {
  const mediaState = getMediaState();
  if (!mediaState) return;
  const editedParentCompositionId = mediaState.activeCompositionId ?? null;
  const afterIds = collectTransitionCompositionIds(after);
  for (const compositionId of collectTransitionCompositionIds(before)) {
    if (afterIds.has(compositionId)) continue;
    if (isReferencedByOtherComposition(compositionId, editedParentCompositionId)) continue;

    const currentMediaState = getMediaState();
    const composition = currentMediaState?.compositions.find((candidate) => candidate.id === compositionId);
    if (composition?.transitionComp?.kind === 'transition-comp') {
      currentMediaState?.removeComposition(compositionId);
    }
  }
}

export function setClipsAndCleanupTransitionComps(
  set: TimelineSet,
  before: readonly TimelineClip[],
  partial: Partial<TimelineStore> & { clips: TimelineClip[] },
): void {
  set(partial);
  removeDetachedTransitionCompositions(before, partial.clips);
}

export function getChangedClipIdsAfterReplacement(
  before: readonly TimelineClip[],
  after: readonly TimelineClip[],
  changedClipIds: readonly string[],
): string[] {
  const previousIds = new Set(before.map((clip) => clip.id));
  return [
    ...changedClipIds,
    ...after.filter((clip) => !previousIds.has(clip.id)).map((clip) => clip.id),
  ];
}

export function ensureTransitionCompositionsForChangedClips(
  set: TimelineSet,
  get: TimelineGet,
  changedClipIds: readonly string[],
  previousClips?: readonly TimelineClip[],
): void {
  const changed = new Set(changedClipIds);
  if (changed.size === 0) return;

  const mediaState = getMediaState();
  if (!mediaState) return;
  const parentComposition = mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId);
  if (!parentComposition) return;

  const serializableClips = get().getSerializableState().clips;
  for (const clip of get().clips) {
    if (!clip.transitionOut) continue;
    if (!changed.has(clip.id) && !changed.has(clip.transitionOut.linkedClipId)) continue;

    ensureTransitionCompositionForPair({
      outgoingClipId: clip.id,
      transitionId: clip.transitionOut.id,
      timelineClips: get().clips,
      serializableClips,
      parentComposition,
      compositions: getMediaState()?.compositions ?? [],
      createComposition: mediaState.createComposition,
      updateComposition: mediaState.updateComposition,
      attachTransitionComposition: ({ outgoingClipId, incomingClipId, transitionId, compositionId }) => {
        set({
          clips: get().clips.map((candidate) => {
            if (candidate.id === outgoingClipId && candidate.transitionOut?.id === transitionId) {
              return { ...candidate, transitionOut: { ...candidate.transitionOut, compositionId } };
            }
            if (candidate.id === incomingClipId && candidate.transitionIn?.id === transitionId) {
              return { ...candidate, transitionIn: { ...candidate.transitionIn, compositionId } };
            }
            return candidate;
          }),
        });
        const currentMediaState = getMediaState();
        const activeCompositionId = currentMediaState?.activeCompositionId;
        if (activeCompositionId) {
          currentMediaState.updateComposition(activeCompositionId, {
            timelineData: get().getSerializableState(),
          });
        }
      },
    });
  }

  if (previousClips) {
    removeDetachedTransitionCompositions(previousClips, get().clips);
  }
}
