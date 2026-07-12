import { useCallback } from 'react';
import { useMediaStore, type Composition } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { openTransitionCompositionForState } from './useTransitionCompositionOpen';

function isLegacyTransitionComposition(composition: Composition | undefined): composition is Composition {
  return composition?.transitionComp?.kind === 'transition-comp' &&
    (composition.transitionComp.sourceLayout === undefined ||
      composition.transitionComp.sourceLayout === 'legacy-segmented');
}

function hasTransitionPair(
  clips: readonly TimelineClip[],
  outgoingClipId: string,
  transitionId: string,
): boolean {
  const outgoingClip = clips.find((clip) => clip.id === outgoingClipId);
  return outgoingClip?.transitionOut?.id === transitionId &&
    clips.some((clip) =>
      clip.id === outgoingClip.transitionOut?.linkedClipId &&
      clip.transitionIn?.id === transitionId &&
      clip.transitionIn.linkedClipId === outgoingClip.id
    );
}

function waitForTransitionPair(
  initialClips: readonly TimelineClip[],
  outgoingClipId: string,
  transitionId: string,
): Promise<readonly TimelineClip[] | null> {
  if (hasTransitionPair(initialClips, outgoingClipId, transitionId)) return Promise.resolve(initialClips);

  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    const finish = (clips: readonly TimelineClip[] | null) => {
      window.clearTimeout(timeoutId);
      unsubscribe();
      resolve(clips);
    };
    const timeoutId = window.setTimeout(() => finish(null), 1000);
    unsubscribe = useTimelineStore.subscribe((state) => {
      if (hasTransitionPair(state.clips, outgoingClipId, transitionId)) finish(state.clips);
    });
  });
}

export function useLegacyTransitionCompositionUpgrade(): (() => Promise<void>) | null {
  const compositions = useMediaStore((state) => state.compositions);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const createComposition = useMediaStore((state) => state.createComposition);
  const updateComposition = useMediaStore((state) => state.updateComposition);
  const openCompositionTab = useMediaStore((state) => state.openCompositionTab);
  const timelineClips = useTimelineStore((state) => state.clips);
  const getSerializableState = useTimelineStore((state) => state.getSerializableState);
  const selectTransitionProperties = useTimelineStore((state) => state.selectTransitionProperties);
  const invalidateCache = useTimelineStore((state) => state.invalidateCache);
  const hasActiveLegacyTransition = isLegacyTransitionComposition(
    compositions.find((composition) => composition.id === activeCompositionId),
  );

  const upgrade = useCallback(async () => {
    const legacyComposition = compositions.find((composition) =>
      composition.id === activeCompositionId,
    );
    if (!isLegacyTransitionComposition(legacyComposition)) return;

    const link = legacyComposition.transitionComp;
    if (!link) return;
    const { parentCompositionId, parentOutgoingClipId, parentTransitionId, bodyStart } = link;
    const parentComposition = compositions.find((composition) => composition.id === parentCompositionId);
    if (!parentComposition) return;

    const transitionPair = waitForTransitionPair(timelineClips, parentOutgoingClipId, parentTransitionId);
    openCompositionTab(parentCompositionId, { skipAnimation: true });
    const parentTimelineClips = await transitionPair;
    if (!parentTimelineClips) {
      openCompositionTab(legacyComposition.id, {
        skipAnimation: true,
        playFromTime: bodyStart ?? 0,
      });
      return;
    }
    openTransitionCompositionForState({
      timelineClips: parentTimelineClips,
      serializableClips: getSerializableState().clips,
      parentComposition,
      compositions,
      createComposition,
      updateComposition,
      openCompositionTab,
      selectTransitionProperties,
      attachTransitionComposition: ({ outgoingClipId, incomingClipId, transitionId, compositionId }) => {
        useTimelineStore.setState((state) => ({
          clips: state.clips.map((clip) => {
            if (clip.id === outgoingClipId && clip.transitionOut?.id === transitionId) {
              return { ...clip, transitionOut: { ...clip.transitionOut, compositionId } };
            }
            if (clip.id === incomingClipId && clip.transitionIn?.id === transitionId) {
              return { ...clip, transitionIn: { ...clip.transitionIn, compositionId } };
            }
            return clip;
          }),
        }));
      },
      invalidateCache,
      replaceCompositions: (nextCompositions) => useMediaStore.setState({ compositions: nextCompositions }),
    }, parentOutgoingClipId, parentTransitionId, { explicitUpgrade: true });
  }, [
    activeCompositionId,
    compositions,
    createComposition,
    getSerializableState,
    invalidateCache,
    openCompositionTab,
    selectTransitionProperties,
    timelineClips,
    updateComposition,
  ]);

  return hasActiveLegacyTransition ? upgrade : null;
}
