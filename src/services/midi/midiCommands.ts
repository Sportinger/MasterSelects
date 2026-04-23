import { useTimelineStore } from '../../stores/timeline';
import type {
  MarkerMIDIBinding,
  MarkerMIDIAction,
  MIDITransportAction,
} from '../../types/midi';

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function seekTimeline(time: number, shouldPlayAfterSeek: boolean): Promise<void> {
  const timelineStore = useTimelineStore.getState();
  const clampedTime = Math.max(0, Math.min(time, timelineStore.duration));
  const wasPlaying = timelineStore.isPlaying;
  const previousSpeed = timelineStore.playbackSpeed;

  if (wasPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(clampedTime);
  await waitForAnimationFrame();

  if (shouldPlayAfterSeek || wasPlaying) {
    await timelineStore.play();
    timelineStore.setPlaybackSpeed(previousSpeed);
  }
}

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

export async function togglePlaybackFromMIDI(): Promise<void> {
  const timelineStore = useTimelineStore.getState();

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    return;
  }

  await timelineStore.play();
}

export async function stopPlaybackFromMIDI(): Promise<void> {
  const timelineStore = useTimelineStore.getState();

  if (timelineStore.isPlaying) {
    timelineStore.pause();
    await waitForAnimationFrame();
  }

  timelineStore.setDraggingPlayhead(false);
  timelineStore.setPlayheadPosition(0);
}

export async function triggerMIDITransportAction(action: MIDITransportAction): Promise<void> {
  if (action === 'stop') {
    await stopPlaybackFromMIDI();
    return;
  }

  await togglePlaybackFromMIDI();
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
