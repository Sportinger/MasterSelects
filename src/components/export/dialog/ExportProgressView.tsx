import type { ExportProgress } from '../../../engine/export';
import { formatTime } from './exportDialogFormat';

interface ExportProgressViewProps {
  progress: ExportProgress | null;
  onCancel: () => void;
}

export function ExportProgressView({ progress, onCancel }: ExportProgressViewProps) {
  return (
    <>
      <div className="export-progress">
        <div className="export-phase">
          {progress?.phase === 'video' && 'Encoding video frames...'}
          {progress?.phase === 'audio' && (
            <>
              Processing audio: {progress.audioPhase}
              {progress.audioPhase && ` (${progress.audioPercent}%)`}
            </>
          )}
          {progress?.phase === 'muxing' && 'Finalizing...'}
        </div>

        <div className="export-progress-bar">
          <div
            className="export-progress-fill"
            style={{ width: `${progress?.percent ?? 0}%` }}
          />
        </div>
        <div className="export-progress-info">
          {progress?.phase === 'video' ? (
            <span>
              Frame {progress?.currentFrame ?? 0} / {progress?.totalFrames ?? 0}
            </span>
          ) : (
            <span>Audio processing</span>
          )}
          <span>{(progress?.percent ?? 0).toFixed(1)}%</span>
        </div>
        {progress && progress.phase === 'video' && progress.estimatedTimeRemaining > 0 && (
          <div className="export-eta">
            ETA: {formatTime(progress.estimatedTimeRemaining)}
          </div>
        )}
      </div>

      <div className="export-actions">
        <button className="export-cancel" onClick={onCancel}>
          Cancel Export
        </button>
      </div>
    </>
  );
}
