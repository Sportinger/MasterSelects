import { useTimelineStore } from '../../stores/timeline';

export function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

export async function seekTimeline(time: number, shouldPlayAfterSeek: boolean): Promise<void> {
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
