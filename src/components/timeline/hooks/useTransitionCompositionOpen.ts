import { useCallback } from 'react';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { useMediaStore, type Composition } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import {
  openTransitionComposition,
  type OpenTransitionCompositionInput,
  type TransitionCompositionAttachment,
  upgradeLegacyTransitionCompositionForPair,
} from '../../../services/timeline/transitionCompositionService';
import { isTransitionCompositionForPair } from '../../../services/timeline/transitionCompositionReuse';

const LEGACY_TRANSITION_UPGRADE_CONFIRMATION = 'Upgrade this legacy transition to mapped sources?\n\nOK: upgrade and open the new composition.\nCancel: open the legacy composition unchanged.';

interface OpenTransitionCompositionOptions {
  explicitUpgrade?: boolean;
}

type TransitionCompositionOpenContext =
  Omit<OpenTransitionCompositionInput, 'outgoingClipId' | 'transitionId' | 'attachTransitionComposition'> & {
    selectTransitionProperties: (clipId: string, edge: 'in' | 'out', transitionId: string) => void;
    attachTransitionComposition: (attachment: TransitionCompositionAttachment) => void;
    invalidateCache: () => void;
    replaceCompositions: (compositions: Composition[]) => void;
  };

function getAttachedLegacyComposition(
  compositions: readonly Composition[],
  parentComposition: Composition | undefined,
  outgoingClipId: string,
  transitionId: string,
  timelineClips: readonly TimelineClip[],
): Composition | undefined {
  const outgoingClip = timelineClips.find((clip) => clip.id === outgoingClipId);
  const transition = outgoingClip?.transitionOut;
  const incomingClip = timelineClips.find((clip) => clip.id === transition?.linkedClipId);
  const composition = transition?.compositionId
    ? compositions.find((candidate) => candidate.id === transition.compositionId)
    : undefined;
  if (
    !parentComposition || !transition || transition.id !== transitionId || !incomingClip || !composition ||
    incomingClip.transitionIn?.id !== transitionId ||
    incomingClip.transitionIn.linkedClipId !== outgoingClipId ||
    incomingClip.transitionIn.compositionId !== composition.id ||
    !isTransitionCompositionForPair(
      composition,
      parentComposition.id,
      transitionId,
      outgoingClipId,
      incomingClip.id,
    ) ||
    (composition.transitionComp?.sourceLayout !== undefined &&
      composition.transitionComp.sourceLayout !== 'legacy-segmented')
  ) {
    return undefined;
  }
  return composition;
}

export function openTransitionCompositionForState(
  context: TransitionCompositionOpenContext,
  outgoingClipId: string,
  transitionId: string,
  { explicitUpgrade = false }: OpenTransitionCompositionOptions = {},
): void {
  const { timelineClips, parentComposition, compositions } = context;
  const transition = timelineClips.find((clip) => clip.id === outgoingClipId)?.transitionOut;
  if (!transition || transition.id !== transitionId) return;

  context.selectTransitionProperties(outgoingClipId, 'out', transitionId);

  const legacyComposition = getAttachedLegacyComposition(
    compositions,
    parentComposition,
    outgoingClipId,
    transitionId,
    timelineClips,
  );
  if (!legacyComposition) {
    openTransitionComposition({
      outgoingClipId,
      transitionId,
      timelineClips,
      serializableClips: context.serializableClips,
      parentComposition,
      compositions,
      createComposition: context.createComposition,
      updateComposition: context.updateComposition,
      openCompositionTab: context.openCompositionTab,
      attachTransitionComposition: (attachment) => {
        context.attachTransitionComposition(attachment);
        context.invalidateCache();
      },
    });
    return;
  }

  const openLegacyComposition = () => context.openCompositionTab(legacyComposition.id, {
    skipAnimation: true,
    playFromTime: legacyComposition.transitionComp?.bodyStart ?? 0,
  });
  if (!explicitUpgrade && !window.confirm(LEGACY_TRANSITION_UPGRADE_CONFIRMATION)) {
    openLegacyComposition();
    return;
  }

  let replaced = false;
  let upgradedCompositionId: string | null = null;
  try {
    upgradedCompositionId = upgradeLegacyTransitionCompositionForPair({
      outgoingClipId,
      transitionId,
      timelineClips,
      serializableClips: context.serializableClips,
      parentComposition,
      compositions,
      replaceCompositions: (nextCompositions) => {
        startBatch('Upgrade transition composition');
        try {
          context.replaceCompositions(nextCompositions);
          replaced = true;
        } finally {
          endBatch();
        }
      },
    });
  } catch {
    openLegacyComposition();
    return;
  }

  if (!replaced || !upgradedCompositionId) {
    openLegacyComposition();
    return;
  }
  context.attachTransitionComposition({
    outgoingClipId,
    incomingClipId: transition.linkedClipId,
    transitionId,
    compositionId: upgradedCompositionId,
  });
  context.invalidateCache();
  context.openCompositionTab(upgradedCompositionId, { skipAnimation: true, playFromTime: 0 });
}

export function useTransitionCompositionOpen(): (outgoingClipId: string, transitionId: string) => void {
  const timelineClips = useTimelineStore((state) => state.clips);
  const getSerializableState = useTimelineStore((state) => state.getSerializableState);
  const selectTransitionProperties = useTimelineStore((state) => state.selectTransitionProperties);
  const invalidateCache = useTimelineStore((state) => state.invalidateCache);
  const compositions = useMediaStore((state) => state.compositions);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const createComposition = useMediaStore((state) => state.createComposition);
  const updateComposition = useMediaStore((state) => state.updateComposition);
  const openCompositionTab = useMediaStore((state) => state.openCompositionTab);

  return useCallback((outgoingClipId, transitionId) => {
    openTransitionCompositionForState({
      timelineClips,
      serializableClips: getSerializableState().clips,
      parentComposition: compositions.find((composition) => composition.id === activeCompositionId),
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
    }, outgoingClipId, transitionId);
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
}
