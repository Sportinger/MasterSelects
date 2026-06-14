import type { TimelineToolPreviewGhostRange } from '../storeTypes/toolTypes';
import type { TransitionParticipantPlan, TransitionPlan } from './transitionPlanner';

const EPSILON = 1e-6;

function addAvailableHandleGhostRange(
  ghostRanges: TimelineToolPreviewGhostRange[],
  participant: TransitionParticipantPlan,
  junctionTime: number,
  idPrefix: string,
): void {
  if (participant.handleAvailable <= EPSILON) return;

  const isIncoming = participant.role === 'incoming';
  const startTime = isIncoming
    ? junctionTime - participant.handleAvailable
    : junctionTime;
  const endTime = isIncoming
    ? junctionTime
    : junctionTime + participant.handleAvailable;

  if (Math.abs(endTime - startTime) <= EPSILON) return;

  ghostRanges.push({
    id: `${idPrefix}:${participant.role}:source-handle:${startTime.toFixed(4)}:${endTime.toFixed(4)}`,
    trackId: participant.trackId,
    startTime,
    endTime,
    label: `${participant.handleAvailable.toFixed(1)}s source`,
    variant: 'transition-source-handle',
  });
}

export function buildTransitionToolPreviewGhostRanges(
  plan: TransitionPlan,
  idPrefix: string,
  label: string,
): TimelineToolPreviewGhostRange[] {
  const ghostRanges: TimelineToolPreviewGhostRange[] = [{
    id: `${idPrefix}:transition-preview`,
    trackId: plan.outgoing.trackId,
    startTime: plan.bodyStart,
    endTime: plan.bodyEnd,
    label,
    variant: 'transition-drop',
  }];

  addAvailableHandleGhostRange(ghostRanges, plan.incoming, plan.junctionTime, idPrefix);
  addAvailableHandleGhostRange(ghostRanges, plan.outgoing, plan.junctionTime, idPrefix);

  for (const participant of [plan.outgoing, plan.incoming]) {
    for (const range of participant.coverage) {
      if (range.kind !== 'hold') continue;

      ghostRanges.push({
        id: `${idPrefix}:${participant.role}:hold:${range.startTime.toFixed(4)}:${range.endTime.toFixed(4)}`,
        trackId: participant.trackId,
        startTime: range.startTime,
        endTime: range.endTime,
        label: `+${range.duration.toFixed(1)}s hold`,
        variant: 'transition-hold-fallback',
      });
    }
  }

  return ghostRanges;
}
