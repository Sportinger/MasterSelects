import type { Composition } from '../../types';
import type { CompositionTimelineData, SerializableClip } from '../../../../types/timeline';
import type { TimelineTransition } from '../../../../types/timelineCore';

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getInnerBodyRange(
  timelineData: CompositionTimelineData,
  outgoingClip: SerializableClip | undefined,
  transition: TimelineTransition | undefined,
  fallbackStart: number,
  fallbackEnd: number,
): { bodyStart: number; bodyEnd: number } {
  if (outgoingClip && transition) {
    const cutTime = outgoingClip.startTime + outgoingClip.duration;
    const halfDuration = Math.max(0.0001, transition.duration) * 0.5;
    const center = cutTime + (transition.offset ?? 0);
    return {
      bodyStart: center - halfDuration,
      bodyEnd: center + halfDuration,
    };
  }

  const bodyStart = finiteNumber(timelineData.inPoint) ? timelineData.inPoint : fallbackStart;
  const bodyEnd = finiteNumber(timelineData.outPoint) && timelineData.outPoint > bodyStart
    ? timelineData.outPoint
    : fallbackEnd;
  return { bodyStart, bodyEnd };
}

function updateParentTransition(
  transition: TimelineTransition | undefined,
  linkedClipId: string,
  transitionCompId: string,
  innerTransition: TimelineTransition | undefined,
  fallbackDuration: number,
): TimelineTransition | undefined {
  if (!transition) return transition;

  return {
    ...transition,
    type: innerTransition?.type ?? transition.type,
    duration: Math.max(0.0001, innerTransition?.duration ?? fallbackDuration ?? transition.duration),
    linkedClipId,
    compositionId: transitionCompId,
    params: innerTransition?.params ?? transition.params,
  };
}

export function syncTransitionCompositionTimelineToParent(
  compositions: readonly Composition[],
  transitionCompId: string | null,
  timelineData: CompositionTimelineData | undefined,
): Composition[] {
  if (!transitionCompId || !timelineData) return [...compositions];

  const transitionComp = compositions.find((composition) => composition.id === transitionCompId);
  const link = transitionComp?.transitionComp;
  if (!transitionComp || link?.kind !== 'transition-comp') return [...compositions];

  const linkedOutgoingClip = timelineData.clips.find((clip) => clip.id === link.linkedOutgoingClipId);
  const innerTransition = linkedOutgoingClip?.transitionOut;
  const bodyRange = getInnerBodyRange(
    timelineData,
    linkedOutgoingClip,
    innerTransition,
    link.bodyStart,
    link.bodyEnd,
  );
  const bodyDuration = Math.max(0.0001, bodyRange.bodyEnd - bodyRange.bodyStart);
  const nextLink = {
    ...link,
    paddingBefore: Math.max(0, bodyRange.bodyStart),
    paddingAfter: Math.max(0, timelineData.duration - bodyRange.bodyEnd),
    bodyStart: bodyRange.bodyStart,
    bodyEnd: bodyRange.bodyEnd,
  };
  const nextTransitionTimelineData: CompositionTimelineData = {
    ...timelineData,
    inPoint: bodyRange.bodyStart,
    outPoint: bodyRange.bodyEnd,
  };

  return compositions.map((composition) => {
    if (composition.id === transitionCompId) {
      return {
        ...composition,
        duration: nextTransitionTimelineData.duration,
        timelineData: nextTransitionTimelineData,
        transitionComp: nextLink,
      };
    }

    if (composition.id !== link.parentCompositionId || !composition.timelineData) {
      return composition;
    }

    let changed = false;
    const clips = composition.timelineData.clips.map((clip) => {
      if (clip.id === link.parentOutgoingClipId && clip.transitionOut?.id === link.parentTransitionId) {
        changed = true;
        return {
          ...clip,
          transitionOut: updateParentTransition(
            clip.transitionOut,
            link.parentIncomingClipId,
            transitionCompId,
            innerTransition,
            bodyDuration,
          ),
        };
      }

      if (clip.id === link.parentIncomingClipId && clip.transitionIn?.id === link.parentTransitionId) {
        changed = true;
        return {
          ...clip,
          transitionIn: updateParentTransition(
            clip.transitionIn,
            link.parentOutgoingClipId,
            transitionCompId,
            innerTransition,
            bodyDuration,
          ),
        };
      }

      return clip;
    });

    return changed
      ? { ...composition, timelineData: { ...composition.timelineData, clips } }
      : composition;
  });
}
