import { useEffect } from 'react';
import { landmarkRuntime } from '../../../services/landmarkTracking/landmarkRuntime';
import { loadLandmarkSidecar } from '../../../services/landmarkTracking/landmarkSidecar';
import { landmarkTrackingService } from '../../../services/landmarkTracking/LandmarkTrackingService';
import { useLandmarkTrackingStore } from '../../../stores/landmarkTrackingStore';
import { useTimelineStore } from '../../../stores/timeline';

export function LandmarkTrackingControls({ clipId }: { clipId: string }) {
  const clip = useTimelineStore((state) => state.clips.find((candidate) => candidate.id === clipId));
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const summary = useLandmarkTrackingStore((state) => state.summaries[clipId]);
  const setReady = useLandmarkTrackingStore((state) => state.setReady);
  const video = clip?.source?.videoElement;
  const busy = summary?.status === 'loading' || summary?.status === 'tracking';

  useEffect(() => {
    if (landmarkRuntime.getSeries(clipId)) return;
    void loadLandmarkSidecar(clipId).then((series) => {
      if (!series) return;
      landmarkRuntime.setSeries(series);
      setReady(series);
    });
  }, [clipId, setReady]);

  if (!video) return null;
  const run = () => landmarkTrackingService.trackClip({
    clipId,
    sourceId: clip.source?.mediaFileId,
    video,
    sourceStart: clip.inPoint ?? 0,
    duration: clip.duration,
    kinds: ['hand', 'face', 'pose'],
  }).catch(() => undefined);

  return (
    <div className="landmark-tracking-controls" onPointerUp={event => {
      if (event.target instanceof HTMLElement) event.target.closest('button')?.blur();
    }}>
      <button type="button" className="btn btn-sm" disabled={busy || isPlaying} onClick={() => void run()}>
        {summary?.status === 'ready' ? 'Retrack Landmarks' : 'Track Landmarks'}
      </button>
      {busy && <button type="button" className="btn btn-sm" onClick={() => landmarkTrackingService.cancel()}>Cancel</button>}
      <span className="effect-mode-label">
        {busy ? `${Math.round((summary?.progress ?? 0) * 100)}%` : summary?.status === 'ready' ? `${summary.frameCount} frames` : summary?.message ?? ''}
      </span>
    </div>
  );
}
