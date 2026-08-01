import type { ExportProgress } from '../../engine/export';
import type { FFmpegProgress } from '../../engine/ffmpeg';
import type { EncoderType } from './useExportState';

interface ExportProgressViewProps {
  encoder: EncoderType;
  progress: ExportProgress | null;
  ffmpegProgress: FFmpegProgress | null;
  exportPhase: 'idle' | 'rendering' | 'audio' | 'encoding';
  usesBrowserProgress: boolean;
  isImageSequenceMode: boolean;
  isGifMode: boolean;
  formatTime: (seconds: number) => string;
  onCancel: () => void;
}

export function ExportProgressView({
  encoder,
  progress,
  ffmpegProgress,
  exportPhase,
  usesBrowserProgress,
  isImageSequenceMode,
  isGifMode,
  formatTime,
  onCancel,
}: ExportProgressViewProps) {
  const progressPercent = (encoder === 'webcodecs' || encoder === 'htmlvideo')
    ? (progress?.percent ?? 0)
    : (ffmpegProgress?.percent ?? 0);

  return (
    <div className="export-progress-container" role="status" aria-label="Export progress">
      <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
        {usesBrowserProgress ? (
          <>
            {progress?.phase === 'video' && (
              isImageSequenceMode
                ? 'Rendering image sequence...'
                : isGifMode
                  ? 'Encoding GIF frames...'
                  : 'Encoding video frames...'
            )}
            {progress?.phase === 'audio' && (
              <>Processing audio: {progress.audioPhase} ({progress.audioPercent}%)</>
            )}
            {progress?.phase === 'muxing' && (isImageSequenceMode ? 'Finalizing sequence...' : 'Finalizing...')}
          </>
        ) : (
          <>
            {exportPhase === 'rendering' && 'Rendering frames...'}
            {exportPhase === 'audio' && 'Processing audio...'}
            {exportPhase === 'encoding' && (isGifMode ? 'Encoding GIF (please wait)...' : 'Encoding video (please wait)...')}
          </>
        )}
      </div>

      <div
        className="export-progress-bar"
        role="progressbar"
        aria-label="Export progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.max(0, Math.min(100, progressPercent))}
      >
        <div
          className="export-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="export-progress-info">
        {usesBrowserProgress ? (
          <>
            {progress?.phase === 'video' ? (
              <span>Frame {progress?.currentFrame ?? 0} / {progress?.totalFrames ?? 0}</span>
            ) : progress?.phase === 'muxing' ? (
              <span>{isImageSequenceMode ? 'Packaging sequence' : 'Finalizing'}</span>
            ) : (
              <span>Audio processing</span>
            )}
            <span>{(progress?.percent ?? 0).toFixed(1)}%</span>
          </>
        ) : (
          <>
            <span>Frame {ffmpegProgress?.frame ?? 0}</span>
            <span>{(ffmpegProgress?.percent ?? 0).toFixed(1)}%</span>
          </>
        )}
      </div>
      {usesBrowserProgress && progress && progress.phase === 'video' && progress.estimatedTimeRemaining > 0 && (
        <div className="export-eta">
          ETA: {formatTime(progress.estimatedTimeRemaining)}
        </div>
      )}
      <button className="btn export-cancel-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
