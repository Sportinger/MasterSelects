import { ensureTransitionCompositionForPair } from '../../../services/timeline/transitionCompositionService';
import type { Composition } from '../../mediaStore';
import type { TimelineClip, TimelineStore } from '../types';
import type { useMediaStore } from '../../mediaStore';

type TimelineSet = (partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>)) => void;
type TimelineGet = () => TimelineStore;
type MediaStoreHook = typeof useMediaStore;
type MediaState = ReturnType<MediaStoreHook['getState']>;

function getMediaStore(): MediaStoreHook | null {
  return (globalThis as typeof globalThis & {
    __mediaStoreModule?: { useMediaStore: MediaStoreHook };
  }).__mediaStoreModule?.useMediaStore ?? null;
}

function getMediaState(): ReturnType<MediaStoreHook['getState']> | null {
  return getMediaStore()?.getState() ?? null;
}

function getTimelineParentComposition(mediaState: MediaState, get: TimelineGet): Composition {
  const activeComposition = mediaState.compositions.find((composition) => composition.id === mediaState.activeCompositionId);
  if (activeComposition) return activeComposition;

  const outputResolution = (mediaState as MediaState & {
    outputResolution?: { width?: number; height?: number };
  }).outputResolution;
  const timelineState = get();
  return {
    id: 'default',
    name: 'Timeline',
    type: 'composition',
    parentId: null,
    createdAt: 0,
    width: outputResolution?.width ?? 1920,
    height: outputResolution?.height ?? 1080,
    frameRate: 30,
    duration: timelineState.duration,
    backgroundColor: '#000000',
    timelineData: timelineState.getSerializableState(),
  };
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

function isValidTransitionCompositionReference(
  compositions: readonly Composition[],
  parentCompositionId: string,
  outgoingClipId: string,
  incomingClipId: string | undefined,
  transitionId: string,
  compositionId: string | undefined,
): boolean {
  if (!compositionId || !incomingClipId) return false;
  const composition = compositions.find((candidate) => candidate.id === compositionId);
  return composition?.transitionComp?.kind === 'transition-comp' &&
    composition.transitionComp.parentCompositionId === parentCompositionId &&
    composition.transitionComp.parentTransitionId === transitionId &&
    composition.transitionComp.parentOutgoingClipId === outgoingClipId &&
    composition.transitionComp.parentIncomingClipId === incomingClipId;
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
  const parentComposition = getTimelineParentComposition(mediaState, get);
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

export function ensureTransitionCompositionsForActiveTimeline(
  set: TimelineSet,
  get: TimelineGet,
): boolean {
  const mediaState = getMediaState();
  if (!mediaState) return false;
  const parentComposition = getTimelineParentComposition(mediaState, get);
  if (!parentComposition || parentComposition.transitionComp?.kind === 'transition-comp') return false;

  let repaired = false;
  const attachTransitionComposition = ({ outgoingClipId, incomingClipId, transitionId, compositionId }: {
    outgoingClipId: string;
    incomingClipId: string;
    transitionId: string;
    compositionId: string;
  }) => {
    set({
      clips: get().clips.map((candidate) => {
        if (candidate.id === outgoingClipId && candidate.transitionOut?.id === transitionId) {
          if (candidate.transitionOut.compositionId === compositionId) return candidate;
          repaired = true;
          return { ...candidate, transitionOut: { ...candidate.transitionOut, compositionId } };
        }
        if (candidate.id === incomingClipId && candidate.transitionIn?.id === transitionId) {
          if (candidate.transitionIn.compositionId === compositionId) return candidate;
          repaired = true;
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
  };

  for (const clip of get().clips) {
    const transition = clip.transitionOut;
    if (!transition) continue;
    const currentMediaState = getMediaState();
    const currentParent = currentMediaState ? getTimelineParentComposition(currentMediaState, get) : undefined;
    if (!currentMediaState || !currentParent) break;

    if (isValidTransitionCompositionReference(
      currentMediaState.compositions,
      currentParent.id,
      clip.id,
      transition.linkedClipId,
      transition.id,
      transition.compositionId,
    )) {
      continue;
    }

    const beforeCompositionCount = currentMediaState.compositions.length;
    const ensuredId = ensureTransitionCompositionForPair({
      outgoingClipId: clip.id,
      transitionId: transition.id,
      timelineClips: get().clips,
      serializableClips: get().getSerializableState().clips,
      parentComposition: currentParent,
      compositions: currentMediaState.compositions,
      createComposition: currentMediaState.createComposition,
      updateComposition: currentMediaState.updateComposition,
      attachTransitionComposition,
    });
    const afterCompositionCount = getMediaState()?.compositions.length ?? beforeCompositionCount;
    repaired = repaired || ensuredId !== null || afterCompositionCount !== beforeCompositionCount;
  }

  return repaired;
}
