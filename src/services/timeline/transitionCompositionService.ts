import type { Composition } from '../../stores/mediaStore/types';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { TransitionCompositionLink } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from './timelineTransitionMediaDurations';
import { buildMaterializedLightLeakTimelineData } from './transitionCompositionLightLeakTemplate';
import { buildTransitionTimelineData } from './transitionCompositionRecipeTemplate';
import { isTransitionCompositionForPair, reuseExistingTimelineData } from './transitionCompositionReuse';

function invalidateCompositionAndParents(compositionId: string): void {
  void import('../compositionRenderer').then(({ compositionRenderer }) => {
    compositionRenderer.invalidateCompositionAndParents(compositionId);
  });
}

function isAttachedTransitionComposition(
  composition: Composition,
  parentCompositionId: string,
  transitionId: string,
): boolean {
  return composition.transitionComp?.kind === 'transition-comp' &&
    composition.transitionComp.parentCompositionId === parentCompositionId &&
    composition.transitionComp.parentTransitionId === transitionId;
}

export interface TransitionCompositionAttachment {
  outgoingClipId: string;
  incomingClipId: string;
  transitionId: string;
  compositionId: string;
}

export interface EnsureTransitionCompositionInput {
  outgoingClipId: string;
  transitionId: string;
  timelineClips: readonly TimelineClip[];
  serializableClips: readonly SerializableClip[];
  parentComposition: Composition | undefined;
  compositions: readonly Composition[];
  createComposition: (name: string, settings?: Partial<Composition>) => Composition;
  updateComposition: (id: string, updates: Partial<Composition>) => void;
  attachTransitionComposition: (attachment: TransitionCompositionAttachment) => void;
}

export interface OpenTransitionCompositionInput extends EnsureTransitionCompositionInput {
  openCompositionTab: (id: string, options?: { skipAnimation?: boolean; playFromTime?: number }) => void;
}

export function ensureTransitionCompositionForPair(input: EnsureTransitionCompositionInput): string | null {
  const {
    outgoingClipId,
    transitionId,
    timelineClips,
    serializableClips,
    parentComposition,
    compositions,
    createComposition,
    updateComposition,
    attachTransitionComposition,
  } = input;
  if (!parentComposition) return null;

  const outgoingClip = timelineClips.find((clip) => clip.id === outgoingClipId);
  const transition = outgoingClip?.transitionOut;
  if (!outgoingClip || !transition || transition.id !== transitionId) return null;

  const incomingClip = timelineClips.find((clip) => clip.id === transition.linkedClipId);
  if (!incomingClip) return null;

  const plan = planTransition({
    outgoingClip,
    incomingClip,
    transitionType: transition.type,
    requestedDuration: transition.duration,
    params: transition.params,
    placement: DEFAULT_TRANSITION_PLACEMENT,
    edgePolicy: 'hold',
    junctionTime: outgoingClip.startTime + outgoingClip.duration,
    bodyOffset: transition.offset ?? 0,
    getMediaDuration: createTimelineTransitionMediaDurationResolver(),
  });
  if (!plan) return null;

  const resolvedTransition = { ...transition, duration: plan.resolvedDuration };
  const generated = transition.type === 'light-leak'
    ? buildMaterializedLightLeakTimelineData({
        outgoingClip,
        incomingClip,
        transition: resolvedTransition,
        plan,
        serializableClips,
      })
    : buildTransitionTimelineData({
        outgoingClip,
        incomingClip,
        transition: resolvedTransition,
        plan,
        serializableClips,
      });
  const existingComposition = (
    transition.compositionId
      ? compositions.find((composition) =>
          composition.id === transition.compositionId &&
          isAttachedTransitionComposition(composition, parentComposition.id, transition.id)
        )
      : undefined
  ) ?? compositions.find((composition) =>
    isTransitionCompositionForPair(
      composition,
      parentComposition.id,
      transition.id,
      outgoingClip.id,
      incomingClip.id,
    )
  );
  const transitionDefinition = getRuntimeTransition(transition.type);
  const compositionName = existingComposition?.name ??
    `Transition - ${transitionDefinition?.name ?? transition.type}`;
  const timelineData = reuseExistingTimelineData(
    existingComposition,
    generated,
    generated.link.materialized === true,
  );
  const transitionComp = {
    ...generated.link,
    parentCompositionId: parentComposition.id,
    bodyStart: 0,
    bodyEnd: timelineData.duration,
    paddingBefore: 0,
    paddingAfter: 0,
  } satisfies TransitionCompositionLink;

  const composition = existingComposition ?? createComposition(compositionName, {
    width: parentComposition.width,
    height: parentComposition.height,
    frameRate: parentComposition.frameRate,
    duration: timelineData.duration,
    timelineData,
    transitionComp,
  });

  if (existingComposition) {
    updateComposition(existingComposition.id, {
      width: parentComposition.width,
      height: parentComposition.height,
      frameRate: parentComposition.frameRate,
      duration: timelineData.duration,
      timelineData,
      transitionComp,
    });
  }

  attachTransitionComposition({
    outgoingClipId: outgoingClip.id,
    incomingClipId: incomingClip.id,
    transitionId: transition.id,
    compositionId: composition.id,
  });
  invalidateCompositionAndParents(composition.id);

  return composition.id;
}

export function openTransitionComposition(input: OpenTransitionCompositionInput): string | null {
  const compositionId = ensureTransitionCompositionForPair(input);
  if (!compositionId) return null;
  const composition = input.compositions.find((candidate) => candidate.id === compositionId);
  input.openCompositionTab(compositionId, {
    skipAnimation: true,
    playFromTime: composition?.transitionComp?.bodyStart ?? 0,
  });
  return compositionId;
}
