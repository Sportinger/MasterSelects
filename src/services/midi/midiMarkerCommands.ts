import { useTimelineStore } from '../../stores/timeline';
import type { MarkerMIDIBinding, MarkerMIDIAction } from '../../types/midi';
import { seekTimeline, waitForAnimationFrame } from './midiTimelineSeek';

export async function jumpToMarkerTime(time: number): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  await seekTimeline(time, false);
  timelineStore.setDraggingPlayhead(false);
}

export async function jumpToMarkerAndStopTime(time: number): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const clampedTime = Math.max(0, Math.min(time, timelineStore.duration));

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(clampedTime);
}

export async function playFromMarkerTime(time: number): Promise<void> {
  await seekTimeline(time, true);
}

export async function triggerMarkerMIDIAction(
  action: MarkerMIDIAction,
  time: number
): Promise<void> {
  if (action === 'playFromMarker') {
    await playFromMarkerTime(time);
    return;
  }

  if (action === 'jumpToMarkerAndStop') {
    await jumpToMarkerAndStopTime(time);
    return;
  }

  await jumpToMarkerTime(time);
}

export async function triggerMarkerMIDIBinding(binding: MarkerMIDIBinding): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const marker = timelineStore.markers.find((candidate) => candidate.midiBindings?.some((candidateBinding) => (
    candidateBinding.action === binding.action
    && candidateBinding.channel === binding.channel
    && candidateBinding.note === binding.note
  )));

  if (!marker) {
    return;
  }

  await triggerMarkerMIDIAction(binding.action, marker.time);
}
