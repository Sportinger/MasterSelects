import { IconPlayerStop, IconRoute } from '@tabler/icons-react';
import { useSyncExternalStore } from 'react';
import { cameraSolvingManager } from '../../services/photogrammetry/cameraSolvingManager';
import './CameraSolveJobOverlay.css';

export function CameraSolveJobOverlay() {
  const job = useSyncExternalStore(
    cameraSolvingManager.subscribe,
    cameraSolvingManager.getSnapshot,
    cameraSolvingManager.getSnapshot,
  );
  const solvingActive = Boolean(job.solving && ![
    'completed', 'cancelled', 'error',
  ].includes(job.solving.phase));
  if (!job.sampling && !job.isStarting && !solvingActive) return null;

  const current = job.sampling?.current ?? job.solving?.current ?? 0;
  const total = job.sampling?.total ?? job.solving?.total ?? 0;
  const progress = total > 0 ? Math.max(0, Math.min(100, current / total * 100)) : 0;
  const detail = job.sampling
    ? `Extracting frame ${job.sampling.current} of ${job.sampling.total}`
    : job.solving?.message ?? 'Preparing browser vision';

  return (
    <aside className="camera-solve-job-overlay" role="status" aria-live="polite">
      <IconRoute className="camera-solve-job-icon" size={20} />
      <div className="camera-solve-job-content">
        <div className="camera-solve-job-heading">
          <strong>Camera Solve</strong>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="camera-solve-job-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="camera-solve-job-detail">{detail}</span>
      </div>
      <button
        type="button"
        className="camera-solve-job-cancel"
        onClick={() => cameraSolvingManager.cancel()}
        aria-label="Cancel camera solve"
        title="Cancel camera solve"
      >
        <IconPlayerStop size={15} />
      </button>
    </aside>
  );
}
