import { useSyncExternalStore } from 'react';
import { IconBox, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import type { BrushTimelineSplatState } from '../../../services/photogrammetry/BrushTimelineSplat';
import { brushTimelineSplat } from '../../../services/photogrammetry/brushTimelineSplatRuntime';
import { brushTrainingManager, type BrushTrainingJobSnapshot } from '../../../services/photogrammetry/brushTrainingManager';

function timelineSplatNote(live: BrushTimelineSplatState, active: boolean): string | null {
  if (live.status === 'live') return `Live on the timeline · Step ${live.iteration.toLocaleString()}. Orbit the scene camera in Preview while it trains.`;
  if (live.status === 'placing') return 'Placing the live splat on the timeline…';
  if (live.status === 'final') return 'Final splat is in Media and on the timeline.';
  if (live.status === 'removed') return 'The live timeline splat was removed from Media.';
  if (live.status === 'error') return `Live timeline splat failed: ${live.error}`;
  return active ? 'The splat appears on the timeline with the first training snapshot.' : null;
}

export function ScanTrainingProgress({ job, label, isExporting, onExport }: {
  job: BrushTrainingJobSnapshot; label: string; isExporting: boolean; onExport: () => Promise<void>;
}) {
  const live = useSyncExternalStore(brushTimelineSplat.subscribe, brushTimelineSplat.getSnapshot);
  const training = job.training;
  if (!training) return null;
  const active = ['loading-runtime', 'loading-dataset', 'training', 'paused'].includes(training.phase) && !job.restored;
  const liveNote = timelineSplatNote(live, active);
  const canShowOnTimeline = live.status === 'removed' || live.status === 'error' || (live.status === 'idle' && !active && training.phase !== 'completed');
  const checkpoint = job.checkpoint;
  const progress = Math.min(100, training.iteration / Math.max(1, training.totalIterations) * 100);
  return <section className={`scan-section scan-training ${training.phase}`}>
    <div className="scan-section-heading"><div><strong>{label}</strong><span>{training.iteration.toLocaleString()} / {training.totalIterations.toLocaleString()} steps</span></div><IconBox size={18} /></div>
    <div className="scan-progress"><span style={{ width: `${progress}%` }} /></div>
    <div className="scan-metrics">
      <span><strong>{training.splatCount.toLocaleString()}</strong> splats</span>
      <span><strong>{training.trainViews}</strong> views</span>
      <span><strong>{training.psnr?.toFixed(2) ?? '—'}</strong> PSNR</span>
    </div>
    {training.warning && <p className="scan-inline-note warning">{training.warning}</p>}
    {liveNote && <p className={`scan-inline-note${live.status === 'error' || live.error ? ' warning' : ''}`}>{liveNote}{live.status === 'live' && live.error ? ` Last update failed: ${live.error}` : ''}</p>}
    {job.preset === 'preview' && <p className="scan-inline-note">Draft preset · 500 steps, every fourth image. Fine detail and views outside the captured camera path may remain poor.</p>}
    {job.error && <p className="scan-inline-note warning">{job.error}</p>}
    <p className="scan-inline-note" role="status">
      {checkpoint.state === 'saving' ? 'Saving training checkpoint…'
        : checkpoint.state === 'saved' ? `Checkpoint saved in project · Step ${checkpoint.iteration.toLocaleString()}`
          : checkpoint.state === 'error' ? checkpoint.error : 'No training checkpoint saved yet.'}
      {checkpoint.state === 'error' && <button className="btn btn-sm" onClick={() => brushTrainingManager.retryCheckpoint()}>Retry save</button>}
    </p>
    {job.restored && <p className="scan-inline-note">{training.phase === 'completed' ? 'Completed splat restored from project.'
      : 'Saved splats restored. Resume continues from this step with a fresh optimizer.'}</p>}
    <div className="scan-training-actions">
      {canShowOnTimeline && <button className="btn btn-sm" onClick={() => brushTimelineSplat.showOnTimeline()}>Show on timeline</button>}
      {training.phase === 'training' && <button className="btn btn-sm" onClick={() => brushTrainingManager.pause()}><IconPlayerPause size={13} /> Pause</button>}
      {training.phase === 'paused' && <button className="btn btn-sm" disabled={job.isStarting} onClick={() => brushTrainingManager.resume()}><IconPlayerPlay size={13} /> {job.isStarting ? 'Restoring…' : 'Resume'}</button>}
      {!['completed', 'cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={() => brushTrainingManager.cancel()}>Cancel</button>}
      {['cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={() => brushTrainingManager.reset()}>Reset</button>}
      {training.phase === 'completed' && live.status !== 'final' && <button className="btn btn-export" disabled={isExporting} onClick={() => void onExport()}>{isExporting ? 'Creating PLY…' : 'Add splat to Media'}</button>}
    </div>
  </section>;
}
