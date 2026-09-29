import { useEffect, useState } from 'react';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { useTimelineStore } from '../../stores/timeline';
import { flockRuntime } from '../../engine/flock/runtime/flockRuntimeApi';
import { rendersFlock } from '../../services/flock/flockEffect';
import { sceneModelLoadProgress } from '../../services/render/sceneModelLoadProgress';
import { scenePreparationStatus, type ScenePreparationStatus } from './scenePreparationStatus';
import './PreviewScenePreparationOverlay.css';

export function PreviewScenePreparationOverlay({ clips, tracks }: { clips: TimelineClip[]; tracks: TimelineTrack[] }) {
  const [progress, setProgress] = useState<ScenePreparationStatus | null>(null);
  useEffect(() => {
    let waitingSince = 0;
    const update = () => {
      const time = useTimelineStore.getState().playheadPosition;
      const visible = new Set(tracks.filter(track => track.visible).map(track => track.id));
      const active = clips.filter(clip => visible.has(clip.trackId) && time >= clip.startTime && time < clip.startTime + clip.duration);
      const modelUrls = new Set(active.map(clip => clip.source?.modelUrl).filter(Boolean));
      const next = scenePreparationStatus(
        active.filter(rendersFlock).map(clip => ({ name: clip.name, status: flockRuntime.getStatus(clip.id) })),
        sceneModelLoadProgress.snapshot().filter(model => modelUrls.has(model.url)),
      );
      if (!next) waitingSince = 0;
      else if (!waitingSince) waitingSince = Date.now();
      const shown = next && (next.error || Date.now() - waitingSince >= 350) ? next : null;
      setProgress(previous => JSON.stringify(previous) === JSON.stringify(shown) ? previous : shown);
    };
    update();
    const unsubscribe = flockRuntime.subscribe(update);
    const timer = window.setInterval(update, 150);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [clips, tracks]);
  if (!progress) return null;
  return (
    <div className={`preview-splat-progress-overlay preview-scene-preparation ${progress.error ? 'error' : ''}`} role="status" aria-live="polite">
      <div className="preview-splat-progress-header"><span>{progress.label}</span><span>{progress.percent === null ? '' : `${progress.percent}%`}</span></div>
      <div className="preview-splat-progress-name">{progress.detail}</div>
      {!progress.error && <div className="preview-splat-progress-track" role="progressbar" aria-label={progress.label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined}>
        <div className={`preview-splat-progress-fill ${progress.percent === null ? 'indeterminate' : ''}`}
          style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
      </div>}
    </div>
  );
}
