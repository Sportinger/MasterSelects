import { useTimelineStore } from '../../../stores/timeline';
import { useLandmarkTrackingStore } from '../../../stores/landmarkTrackingStore';
import { faceTrackKey } from '../../../services/landmarkTracking/preciseFaceSampling';
import { preciseFaceTracking } from '../../../services/landmarkTracking/preciseFaceTracking';
import { landmarkRuntime } from '../../../services/landmarkTracking/landmarkRuntime';
import { usePreciseFaceTrack } from '../../../services/landmarkTracking/usePreciseFaceTrack';
import './preciseFaceTracking.css';
import { FaceStabilizationControls } from './FaceStabilizationControls';
import { useState } from 'react';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

export function PreciseFaceTrackingControls({ clipId }: { clipId: string }) {
  const [mode, setMode] = useState<'independent' | 'video'>('independent');
  const clip = useTimelineStore(state => state.clips.find(c => c.id === clipId));
  const key = faceTrackKey(clipId);
  const summary = useLandmarkTrackingStore(state => state.summaries[key]);
  const visible = useLandmarkTrackingStore(state => state.faceOverlay[clipId] ?? false);
  const smoothing = useLandmarkTrackingStore(state => state.faceSmoothing);
  const anyBusy = useLandmarkTrackingStore(state => Object.entries(state.summaries).some(([id, s]) =>
    id.startsWith('face:') && (s.status === 'loading' || s.status === 'tracking')));
  const busy = summary?.status === 'loading' || summary?.status === 'tracking';
  const sourceId = clip?.source?.mediaFileId ?? clip?.mediaFileId ?? clipId;
  usePreciseFaceTrack(clipId);
  if (!clip || clip.source?.type !== 'video' || clip.source.liveInputId) return null;
  const run = async () => {
    const original = clip;
    const ownedUrl = clip.file?.size ? URL.createObjectURL(clip.file) : null;
    try {
      await preciseFaceTracking.track({ clipId, sourceId, file: clip.file, mode,
        url: ownedUrl ?? clip.source?.videoElement?.currentSrc ?? '', from: clip.inPoint, to: clip.outPoint,
        isCurrent: () => {
          const current = useTimelineStore.getState().clips.find(c => c.id === clipId);
          return !!current && (current.source?.mediaFileId ?? current.mediaFileId ?? current.id) === sourceId
            && current.inPoint === original.inPoint && current.outPoint === original.outPoint;
        },
      });
    } catch (error) {
      useLandmarkTrackingStore.getState().setSummary(key, { message: String(error) });
    } finally { if (ownedUrl) URL.revokeObjectURL(ownedUrl); }
  };
  const series = landmarkRuntime.getSeries(key);
  const hasTrack = !!series?.faceTracking && series.sourceId === sourceId;
  return <section className="precise-face-controls" aria-label="Precise face tracking"
    onPointerUp={event => {
      const target = event.target;
      if (target instanceof Element) target.closest<HTMLElement>('button, select, input')?.blur();
    }}>
    <strong>Precise face tracking</strong>
    <span>Every source frame · one face · 478 landmarks</span>
    <ResolveInspectorRow label="Detection">
      <InspectorSelect ariaLabel="Face detection mode" value={mode} disabled={anyBusy}
        onChange={value => setMode(value as 'independent' | 'video')}
        options={[{ value: 'independent', label: 'Independent frames' }, { value: 'video', label: 'Smooth video' }]} />
    </ResolveInspectorRow>
    <span>Independent frames avoids temporal tracking lag; may show more jitter. Retrack, then re-bake cables to apply.</span>
    <div>
      <button type="button" disabled={anyBusy} onClick={() => void run()}>
        {hasTrack ? 'Retrack face precisely' : 'Track face precisely'}
      </button>
      {busy && <button type="button" onClick={() => preciseFaceTracking.cancel()}>Cancel face tracking</button>}
    </div>
    {busy && <progress aria-label="Face tracking progress" value={summary.progress} max={1} />}
    <output aria-live="polite">{busy ? `${summary.message ?? 'Tracking'} · ${Math.round(summary.progress * 100)}%`
      : summary?.message ?? (hasTrack ? `${series.faceTracking!.detectedFrames}/${series.frames.length} frames with face · 478 points` : '')}</output>
    {hasTrack && <>
      <span>Current track: {series.faceTracking?.mode === 'independent' ? 'independent frames' : 'smooth video'}</span>
      <label><input type="checkbox" checked={visible}
        onChange={event => useLandmarkTrackingStore.getState().setFaceOverlay(clipId, event.target.checked)} />Show face control net (preview only)</label>
      <label>Extra smoothing <input aria-label="Face smoothing" type="range" min="0" max="1" step="0.05" value={smoothing}
        onChange={event => useLandmarkTrackingStore.getState().setFaceSmoothing(Number(event.target.value))} />{Math.round(smoothing * 100)}%</label>
      <span>Pink: lips · cyan: eyes · amber: brows · green: outline. Missing detections are hidden.</span>
      <FaceStabilizationControls key={clipId} clipId={clipId} disabled={anyBusy} />
    </>}
  </section>;
}
