import { useTimelineStore } from '../../stores/timeline';
import type { MIDITransportAction } from '../../types/midi';
import { waitForAnimationFrame } from './midiTimelineSeek';

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
