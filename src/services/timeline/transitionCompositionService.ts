import type { Composition } from '../../stores/mediaStore/types';
import { generateId } from '../../stores/mediaStore/helpers/importPipeline';
import type { SerializableClip, TimelineClip } from '../../types/timeline';
import type { TransitionCompositionLink } from '../../types/timelineCore';
import { getRuntimeTransition } from '../../transitions';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../stores/timeline/editOperations/transitionPlanner';
import { createTimelineTransitionMediaDurationResolver } from './timelineTransitionMediaDurations';
import { buildMaterializedLightLeakTimelineData } from './transitionCompositionLightLeakTemplate';
import { buildTransitionTimelineData } from './transitionCompositionRecipeTemplate';
import { isTransitionCompositionForPair, reuseExistingTimelineData } from './transitionCompositionReuse';
import { isValidTransitionSourceMap } from './transitionSourceMap';
import {
  getSerializableClip,
  resolveTransitionCompositionMediaDuration,
} from './transitionCompositionSourceClips';

function invalidateCompositionAndParents(compositionId: string): void {
  void import('../compositionRenderer').then(({ compositionRenderer }) => {
    compositionRenderer?.invalidateCompositionAndParents?.(compositionId);
  }).catch(() => undefined);
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

function hasV1MappedSources(composition: Composition): boolean {
  return composition.transitionComp?.sourceLayout === 'mapped-v3' &&
    composition.timelineData?.clips.some((clip) => clip.transitionSourceMap?.version === 1) === true;
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

/**
 * Explicit, one-way migration for an attached pre-v3 segmented transition
 * composition. `replaceCompositions` must commit the supplied array in one store update.
 */
export interface UpgradeLegacyTransitionCompositionInput {
  outgoingClipId: string;
  transitionId: string;
  timelineClips: readonly TimelineClip[];
  serializableClips: readonly SerializableClip[];
  parentComposition: Composition | undefined;
  compositions: readonly Composition[];
  replaceCompositions: (compositions: Composition[]) => void;
}

export function upgradeLegacyTransitionCompositionForPair(
  input: UpgradeLegacyTransitionCompositionInput,
): string | null {
  const {
    outgoingClipId,
    transitionId,
    timelineClips,
    serializableClips,
    parentComposition,
    compositions,
    replaceCompositions,
  } = input;
  if (!parentComposition) return null;

  const activeParent = compositions.find((composition) => composition.id === parentComposition.id);
  const outgoingClip = timelineClips.find((clip) => clip.id === outgoingClipId);
  const transition = outgoingClip?.transitionOut;
  const incomingClip = timelineClips.find((clip) => clip.id === transition?.linkedClipId);
  const legacyComposition = transition?.compositionId
    ? compositions.find((composition) => composition.id === transition.compositionId)
    : undefined;
  const durableOutgoing = activeParent?.timelineData?.clips.find((clip) => clip.id === outgoingClipId);
  const durableIncoming = activeParent?.timelineData?.clips.find((clip) => clip.id === transition?.linkedClipId);
  if (
    !activeParent || !outgoingClip || !transition || transition.id !== transitionId || !incomingClip ||
    !legacyComposition ||
    incomingClip.transitionIn?.id !== transition.id ||
    incomingClip.transitionIn.linkedClipId !== outgoingClip.id ||
    incomingClip.transitionIn.compositionId !== legacyComposition.id ||
    !isTransitionCompositionForPair(
      legacyComposition,
      activeParent.id,
      transition.id,
      outgoingClip.id,
      incomingClip.id,
    ) ||
    (legacyComposition.transitionComp?.sourceLayout !== undefined &&
      legacyComposition.transitionComp.sourceLayout !== 'legacy-segmented') ||
    durableOutgoing?.transitionOut?.id !== transition.id ||
    durableOutgoing.transitionOut.linkedClipId !== incomingClip.id ||
    durableOutgoing.transitionOut.compositionId !== legacyComposition.id ||
    durableIncoming?.transitionIn?.id !== transition.id ||
    durableIncoming.transitionIn.linkedClipId !== outgoingClip.id ||
    durableIncoming.transitionIn.compositionId !== legacyComposition.id
  ) {
    return null;
  }

  const getMediaDuration = createTimelineTransitionMediaDurationResolver();
  const outgoingMediaDuration = resolveTransitionCompositionMediaDuration(
    getSerializableClip(outgoingClip, serializableClips),
    getMediaDuration,
  );
  const incomingMediaDuration = resolveTransitionCompositionMediaDuration(
    getSerializableClip(incomingClip, serializableClips),
    getMediaDuration,
  );
  if (outgoingMediaDuration === null || incomingMediaDuration === null) return null;

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
    getMediaDuration,
  });
  if (!plan) return null;

  const resolvedTransition = { ...transition, duration: plan.resolvedDuration };
  let generated: ReturnType<typeof buildTransitionTimelineData>;
  try {
    generated = transition.type === 'light-leak'
      ? buildMaterializedLightLeakTimelineData({
          outgoingClip,
          incomingClip,
          transition: resolvedTransition,
          plan,
          serializableClips,
          outgoingMediaDuration,
          incomingMediaDuration,
        })
      : buildTransitionTimelineData({
          outgoingClip,
          incomingClip,
          transition: resolvedTransition,
          plan,
          serializableClips,
          outgoingMediaDuration,
          incomingMediaDuration,
        });
  } catch {
    return null;
  }
  const outgoingSources = generated.timelineData.clips.filter((clip) =>
    clip.id === generated.link.linkedOutgoingClipId
  );
  const incomingSources = generated.timelineData.clips.filter((clip) =>
    clip.id === generated.link.linkedIncomingClipId
  );
  if (
    generated.link.sourceLayout !== 'mapped-v3' ||
    !Number.isFinite(generated.timelineData.duration) || generated.timelineData.duration <= 0 ||
    outgoingSources.length !== 1 || incomingSources.length !== 1 ||
    [...outgoingSources, ...incomingSources].some((clip) =>
      clip.startTime !== 0 ||
      clip.duration !== generated.timelineData.duration ||
      clip.transitionSourceMap?.version !== 2 ||
      !isValidTransitionSourceMap(clip.transitionSourceMap)
    )
  ) {
    return null;
  }

  let compositionId: string;
  do {
    compositionId = generateId();
  } while (compositionId === legacyComposition.id || compositions.some((composition) => composition.id === compositionId));

  const timelineData = generated.timelineData;
  const transitionComp = {
    ...generated.link,
    legacyBackupCompositionId: legacyComposition.id,
    parentCompositionId: activeParent.id,
    bodyStart: 0,
    bodyEnd: timelineData.duration,
    paddingBefore: 0,
    paddingAfter: 0,
  } satisfies TransitionCompositionLink;
  const upgradedComposition: Composition = {
    ...legacyComposition,
    id: compositionId,
    duration: timelineData.duration,
    width: activeParent.width,
    height: activeParent.height,
    frameRate: activeParent.frameRate,
    timelineData,
    transitionComp,
  };
  const nextParent: Composition = {
    ...activeParent,
    timelineData: {
      ...activeParent.timelineData!,
      clips: activeParent.timelineData!.clips.map((clip) => {
        if (clip.id === outgoingClip.id && clip.transitionOut?.id === transition.id) {
          return { ...clip, transitionOut: { ...clip.transitionOut, compositionId } };
        }
        if (clip.id === incomingClip.id && clip.transitionIn?.id === transition.id) {
          return { ...clip, transitionIn: { ...clip.transitionIn, compositionId } };
        }
        return clip;
      }),
    },
  };

  replaceCompositions([
    ...compositions.map((composition) => composition.id === activeParent.id ? nextParent : composition),
    upgradedComposition,
  ]);
  invalidateCompositionAndParents(compositionId);
  return compositionId;
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

  const getMediaDuration = createTimelineTransitionMediaDurationResolver();
  const outgoingMediaDuration = resolveTransitionCompositionMediaDuration(
    getSerializableClip(outgoingClip, serializableClips),
    getMediaDuration,
  );
  const incomingMediaDuration = resolveTransitionCompositionMediaDuration(
    getSerializableClip(incomingClip, serializableClips),
    getMediaDuration,
  );
  if (outgoingMediaDuration === null || incomingMediaDuration === null) return null;

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
  if (existingComposition && existingComposition.transitionComp?.sourceLayout !== 'mapped-v3') {
    attachTransitionComposition({
      outgoingClipId: outgoingClip.id,
      incomingClipId: incomingClip.id,
      transitionId: transition.id,
      compositionId: existingComposition.id,
    });
    invalidateCompositionAndParents(existingComposition.id);
    return existingComposition.id;
  }

  // Preserve existing v1 maps; v3 is emitted only for new generation.
  if (existingComposition && hasV1MappedSources(existingComposition)) {
    attachTransitionComposition({
      outgoingClipId: outgoingClip.id,
      incomingClipId: incomingClip.id,
      transitionId: transition.id,
      compositionId: existingComposition.id,
    });
    invalidateCompositionAndParents(existingComposition.id);
    return existingComposition.id;
  }

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
    getMediaDuration,
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
        outgoingMediaDuration,
        incomingMediaDuration,
      })
    : buildTransitionTimelineData({
        outgoingClip,
        incomingClip,
        transition: resolvedTransition,
        plan,
        serializableClips,
        outgoingMediaDuration,
        incomingMediaDuration,
      });
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
    ...(existingComposition?.transitionComp?.legacyBackupCompositionId
      ? { legacyBackupCompositionId: existingComposition.transitionComp.legacyBackupCompositionId }
      : {}),
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
