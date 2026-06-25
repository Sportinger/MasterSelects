import type { Composition } from '../../types';
import type { CompositionTimelineData } from '../../../../types/timeline';
import type { TimelineTransition } from '../../../../types/timelineCore';

function updateParentTransition(
  transition: TimelineTransition | undefined,
  linkedClipId: string,
  transitionCompId: string,
  fallbackDuration: number,
): TimelineTransition | undefined {
  if (!transition) return transition;

  return {
    ...transition,
    duration: Math.max(0.0001, fallbackDuration ?? transition.duration),
    linkedClipId,
    compositionId: transitionCompId,
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

  const bodyDuration = Math.max(0.0001, timelineData.duration);
  const nextLink = {
    ...link,
    paddingBefore: 0,
    paddingAfter: 0,
    bodyStart: 0,
    bodyEnd: bodyDuration,
  };
  const nextTransitionTimelineData: CompositionTimelineData = {
    ...timelineData,
    duration: bodyDuration,
    inPoint: 0,
    outPoint: bodyDuration,
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
