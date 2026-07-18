import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { canPlaceLiveInputInActiveComposition, createLiveInputTimelineClip } from '../liveInputTimeline';

export function placeLiveInputOnTimeline(params: {
  item: MediaFile;
  trackId: string;
  startTime: number;
  duration?: number;
}): string | null {
  const state = useTimelineStore.getState();
  const track = state.tracks.find((candidate) => candidate.id === params.trackId);
  const activeCompositionId = useMediaStore.getState().activeCompositionId;
  if (!track || track.type !== 'video' || track.locked || !canPlaceLiveInputInActiveComposition(params.item, activeCompositionId)) return null;
  const clip = createLiveInputTimelineClip(params);
  if (!clip) return null;
  useTimelineStore.setState({ clips: [...state.clips, clip] });
  state.updateDuration();
  state.invalidateCache();
  return clip.id;
}
