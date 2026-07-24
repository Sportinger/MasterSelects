import type { MatAnyoneResultLike } from './MatAnyoneFileHelpers';

type MatAnyoneRunSectionProps = {
  isMatReady: boolean;
  isMatStarting: boolean;
  matGpu: string | null;
  matCuda: boolean;
  matProcessing: boolean;
  matProgress: number;
  matCurrentFrame: number;
  matTotalFrames: number;
  matError: string | null;
  matResult: MatAnyoneResultLike | null;
  hasMask: boolean;
  isImportingMatte: boolean;
  matImportError: string | null;
  onStartServer: () => void;
  onRunMatAnyone: () => void;
  onCancelJob: () => void;
  onImportMattingResult: () => void;
};

export function MatAnyoneRunSection({
  isMatReady,
  isMatStarting,
  matGpu,
  matCuda,
  matProcessing,
  matProgress,
  matCurrentFrame,
  matTotalFrames,
  matError,
  matResult,
  hasMask,
  isImportingMatte,
  matImportError,
  onStartServer,
  onRunMatAnyone,
  onCancelJob,
  onImportMattingResult,
}: MatAnyoneRunSectionProps) {
  return (
    <div className="sam2-section" style={{
      background: 'var(--bg-tertiary)',
      borderRadius: 6,
      padding: 8,
      border: '1px solid var(--border-color)',
    }}>
      <div className="sam2-section-title">Step 2: Run MatAnyone2</div>

      {!isMatReady ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Server not running{matGpu && <> &mdash; {matGpu}</>}
          </span>
          <button className="sam2-btn primary" onClick={onStartServer} disabled={isMatStarting}>
            {isMatStarting ? 'Starting Server...' : 'Start Server'}
          </button>
        </div>
      ) : (
        <>
          <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Extracts the masked subject as a transparent WebM for the selected clip segment.
            {matCuda && matGpu && <> Using {matGpu}.</>}
          </p>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="sam2-btn primary"
              onClick={onRunMatAnyone}
              disabled={matProcessing || !hasMask}
              style={{ flex: 1 }}
            >
              {matProcessing ? 'Processing...' : !hasMask ? 'Create mask first' : 'Run MatAnyone2'}
            </button>
            {matProcessing && (
              <button
                className="sam2-btn danger"
                onClick={onCancelJob}
                style={{ flex: 'none' }}
              >
                Cancel
              </button>
            )}
          </div>

          {matProcessing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <div className="sam2-progress-bar">
                <div className="sam2-progress-fill" style={{ width: `${matProgress}%` }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {Math.round(matProgress)}%
                {matTotalFrames > 0 && <> &mdash; Frame {matCurrentFrame}/{matTotalFrames}</>}
              </span>
            </div>
          )}

          {matError && !matProcessing && (
            <div style={{
              padding: '6px 8px',
              marginTop: 4,
              background: 'rgba(231, 76, 60, 0.1)',
              border: '1px solid var(--danger)',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--danger)',
            }}>
              {matError}
            </div>
          )}

          {matResult && !matProcessing && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingTop: 6,
              marginTop: 4,
              borderTop: '1px solid var(--border-color)',
            }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--success)' }}>
                Matting complete
              </span>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                <div>{matResult.foregroundPath.split(/[/\\]/).pop()}</div>
                <div>{matResult.alphaPath.split(/[/\\]/).pop()}</div>
              </div>
              <button
                className="sam2-btn"
                onClick={onImportMattingResult}
                disabled={isImportingMatte}
                style={{ marginTop: 2, fontSize: 11 }}
              >
                {isImportingMatte ? 'Importing...' : 'Import to Timeline'}
              </button>
              {matImportError && (
                <div style={{
                  padding: '6px 8px',
                  marginTop: 2,
                  background: 'rgba(231, 76, 60, 0.1)',
                  border: '1px solid var(--danger)',
                  borderRadius: 4,
                  fontSize: 11,
                  color: 'var(--danger)',
                }}>
                  {matImportError}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
