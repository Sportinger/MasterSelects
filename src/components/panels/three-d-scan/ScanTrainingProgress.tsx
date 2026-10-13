import { IconBox, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { brushPreviewRuntime } from '../../../services/photogrammetry/brushPreviewRuntime';
import { brushTrainingManager, type BrushTrainingJobSnapshot } from '../../../services/photogrammetry/brushTrainingManager';

export function ScanTrainingProgress({ job, label, isExporting, onExport }: {
  job: BrushTrainingJobSnapshot; label: string; isExporting: boolean; onExport: () => Promise<void>;
}) {
  const training = job.training;
  if (!training) return null;
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
      <button className="btn btn-sm" onClick={() => brushPreviewRuntime.setVisible(true)}>Live in Preview</button>
      {training.phase === 'training' && <button className="btn btn-sm" onClick={() => brushTrainingManager.pause()}><IconPlayerPause size={13} /> Pause</button>}
      {training.phase === 'paused' && <button className="btn btn-sm" disabled={job.isStarting} onClick={() => brushTrainingManager.resume()}><IconPlayerPlay size={13} /> {job.isStarting ? 'Restoring…' : 'Resume'}</button>}
      {!['completed', 'cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={() => brushTrainingManager.cancel()}>Cancel</button>}
      {['cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={() => brushTrainingManager.reset()}>Reset</button>}
      {training.phase === 'completed' && <button className="btn btn-export" disabled={isExporting} onClick={() => void onExport()}>{isExporting ? 'Creating PLY…' : 'Add splat to Media'}</button>}
    </div>
  </section>;
}
