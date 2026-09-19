import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';

export async function placeSplatOnTimeline(file: File, imported: MediaFile): Promise<string> {
  const media = useMediaStore.getState();
  media.setSourceMonitorFile(null);
  media.setSelection([imported.id]);

  const timeline = useTimelineStore.getState();
  const startTime = timeline.playheadPosition;
  const duration = 10;
  const splatTrackId = timeline.addTrack('video');
  const clipId = await useTimelineStore.getState().addClip(
    splatTrackId,
    file,
    startTime,
    duration,
    imported.id,
    'gaussian-splat',
  );
  if (!clipId) throw new Error('The Gaussian splat could not be placed on the timeline.');

  const updatedTimeline = useTimelineStore.getState();
  const endTime = startTime + duration;
  const hasCamera = updatedTimeline.clips.some((clip) => (
    clip.source?.type === 'camera'
    && startTime < clip.startTime + clip.duration
    && endTime > clip.startTime
  ));
  if (!hasCamera) {
    const cameraTrackId = updatedTimeline.addTrack('video');
    useTimelineStore.getState().addCameraClip(cameraTrackId, startTime, duration, true);
  }
  useTimelineStore.getState().selectClip(clipId);
  return clipId;
}
