import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { resolveGaussianSplatSettingsForSource } from '../../engine/gaussian/types';
import type { SolvedCameraPath } from './cameraSolvePoses';

export async function placeSplatOnTimeline(file: File, imported: MediaFile, trainingCamera?: SolvedCameraPath | null): Promise<string> {
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
  const pose = trainingCamera?.poses[0];
  if (pose && trainingCamera) {
    const clip = updatedTimeline.clips.find(candidate => candidate.id === clipId)!;
    const settings = resolveGaussianSplatSettingsForSource(clip.source?.gaussianSplatSettings, { fileName: file.name });
    // The loader already converts COLMAP to editor coordinates. A second PLY
    // orientation flip would separate the trained scene from its solved camera.
    settings.render.orientationPreset = 'default';
    settings.render.nearPlane = 0.001;
    updatedTimeline.updateClip(clipId, { source: { ...clip.source!, gaussianSplatSettings: settings } });
    const cameraTrackId = updatedTimeline.addTrack('video');
    // Scene cameras resolve from the bottom-most visible video track. Keep the
    // previous cameras intact, but make the newly imported capture view active.
    const bottomTrack = useTimelineStore.getState().tracks.filter(track => track.type === 'video' && track.id !== cameraTrackId).at(-1);
    if (bottomTrack) useTimelineStore.getState().reorderTrack(cameraTrackId, bottomTrack.id, true);
    const cameraId = useTimelineStore.getState().addCameraClip(cameraTrackId, startTime, duration, true);
    if (!cameraId) throw new Error('The training camera could not be placed on the timeline.');
    const camera = useTimelineStore.getState().clips.find(candidate => candidate.id === cameraId)!;
    useTimelineStore.getState().updateClip(cameraId, {
      name: 'Training Camera',
      source: { ...camera.source!, cameraSettings: { ...camera.source?.cameraSettings,
        fov: trainingCamera.fovDegrees, near: 0.001, far: 1000,
        resolutionWidth: trainingCamera.width, resolutionHeight: trainingCamera.height } },
    });
    useTimelineStore.getState().updateClipTransform(cameraId, { position: pose.position, rotation: pose.rotation });
  } else if (!hasCamera) {
    const cameraTrackId = updatedTimeline.addTrack('video');
    useTimelineStore.getState().addCameraClip(cameraTrackId, startTime, duration, true);
  }
  useTimelineStore.getState().selectClip(clipId);
  return clipId;
}
