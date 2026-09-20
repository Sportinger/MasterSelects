import { useEffect } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useLandmarkTrackingStore } from '../../stores/landmarkTrackingStore';
import { faceTrackKey } from './preciseFaceSampling';
import { landmarkRuntime } from './landmarkRuntime';
import { loadLandmarkSidecar, saveLandmarkSidecar } from './landmarkSidecar';

/** Restore tracking independently of which inspector is open. */
export function usePreciseFaceTrack(clipId: string) {
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const key = faceTrackKey(clipId);
  const summary = useLandmarkTrackingStore(state => state.summaries[key]);
  const sourceId = clip?.source?.mediaFileId ?? clip?.mediaFileId ?? clipId;
  useEffect(() => {
    let active = true;
    if (!clip) return;
    if (landmarkRuntime.getSeries(key)?.sourceId === sourceId) return;
    void (async () => {
      const cached = await loadLandmarkSidecar(key);
      const series = cached?.sourceId === sourceId ? cached
        : landmarkRuntime.findFaceSeries(sourceId, clip?.inPoint ?? 0, clip?.outPoint ?? 0);
      if (!active || !series?.faceTracking || landmarkRuntime.getSeries(key)?.sourceId === sourceId) return;
      const adopted = series.clipId === key ? series : { ...series, clipId: key };
      if (adopted !== series) await saveLandmarkSidecar(adopted);
      if (!active) return;
      landmarkRuntime.setSeries(adopted);
      useLandmarkTrackingStore.getState().setReady(adopted);
    })().catch(() => { /* A missing/evicted cache can always be regenerated. */ });
    return () => { active = false; };
  }, [key, sourceId, clip?.inPoint, clip?.outPoint]);
  const series = landmarkRuntime.getSeries(key);
  const ready = !!series?.faceTracking && series.sourceId === sourceId;
  return { summary, ready, createdAt: ready ? series.createdAt : undefined };
}
