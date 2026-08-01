import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { compositionRenderer } from '../../../compositionRenderer';
import { Logger } from '../../../logger';
import { waitForTimeout } from './timing';

const log = Logger.create('AITool:StressTest');

async function waitForCompositionReady(compositionId: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const mediaState = useMediaStore.getState();
    const timelineState = useTimelineStore.getState();
    const composition = mediaState.compositions.find((entry) => entry.id === compositionId);
    const timelineDataTracks = composition?.timelineData?.tracks ?? [];
    const active = mediaState.activeCompositionId === compositionId;
    const tracksReady = timelineDataTracks.length === 0 || (
      timelineState.tracks.length === timelineDataTracks.length &&
      timelineDataTracks.every((track, index) => timelineState.tracks[index]?.id === track.id)
    );

    if (active && tracksReady) {
      return true;
    }

    await waitForTimeout(25);
  }

  return false;
}

export async function openComposition(compositionId: string): Promise<void> {
  const mediaStore = useMediaStore.getState();
  await mediaStore.openCompositionTab(compositionId, { skipAnimation: true });
  const ready = await waitForCompositionReady(compositionId);
  if (!ready) {
    log.warn('Timed out waiting for fixture composition switch', { compositionId });
  }
}

export function saveActiveTimelineToComposition(compositionId: string, durationSeconds: number): void {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();
  const timelineData = {
    ...timelineStore.getSerializableState(),
    duration: durationSeconds,
    durationLocked: true,
  };

  mediaStore.updateComposition(compositionId, {
    duration: durationSeconds,
    timelineData,
  });
  compositionRenderer.invalidateCompositionAndParents(compositionId);
}

export function getVideoTracks(): { top: string; middle: string; base: string } {
  const timelineStore = useTimelineStore.getState();
  const videoTracks = timelineStore.tracks.filter((track) => track.type === 'video');
  if (videoTracks.length < 2) {
    timelineStore.addTrack('video');
  }
  const refreshedVideoTracks = useTimelineStore.getState().tracks.filter((track) => track.type === 'video');
  const top = refreshedVideoTracks[0];
  const middle = refreshedVideoTracks[1] ?? top;
  const base = refreshedVideoTracks[refreshedVideoTracks.length - 1] ?? top;

  if (!top || !base) {
    throw new Error('Fixture timeline has no video tracks');
  }

  return {
    top: top.id,
    middle: middle.id,
    base: base.id,
  };
}
