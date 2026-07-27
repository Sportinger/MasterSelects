import type { MatAnyoneSetupStatus } from '../../../stores/matanyoneStore';

type MatAnyoneOverlaysProps = {
  matStatus: MatAnyoneSetupStatus;
  matError: string | null;
  showHelperOverlay: boolean;
  showSetupOverlay: boolean;
  onOpenSetup: () => void;
  onRetryConnection: () => void;
};

type MatAnyoneStatusBarProps = {
  matStatus: MatAnyoneSetupStatus;
  isMatReady: boolean;
  isMatInstalled: boolean;
  matProcessing: boolean;
};

export function MatAnyoneOverlays({
  matStatus,
  matError,
  showHelperOverlay,
  showSetupOverlay,
  onOpenSetup,
  onRetryConnection,
}: MatAnyoneOverlaysProps) {
  return (
    <>
      {showHelperOverlay && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon" style={{ fontSize: 32 }}>&#x26A1;</span>
            <p style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px' }}>Native Helper Required</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              MatAnyone2 is installed, but the Native Helper is not connected right now.
            </p>
            <button className="sam2-download-btn" onClick={onRetryConnection}>
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {showSetupOverlay && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon" style={{ fontSize: 32 }}>&#x2726;</span>
            <p style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px' }}>
              {matStatus === 'error'
                ? 'MatAnyone2 Setup Error'
                : matStatus === 'gpu-required' ? 'NVIDIA CUDA GPU Required' : 'AI Video Matting'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {matStatus === 'error'
                ? (matError || 'The MatAnyone2 setup needs attention.')
                : matStatus === 'gpu-required'
                  ? 'CPU fallback is disabled. Check the NVIDIA driver and Native Helper permissions.'
                : 'Extract people from video with precise alpha mattes.'}
            </p>
            <button className="sam2-download-btn" onClick={onOpenSetup}>
              {matStatus === 'error' ? 'Open Setup' : 'Set Up MatAnyone2'}
            </button>
            {matStatus !== 'error' && (
              <span className="sam2-size-hint" style={{ marginTop: 8 }}>
                Requires NVIDIA GPU + ~4 GB disk space
              </span>
            )}
          </div>
        </div>
      )}

      {matStatus === 'installing' && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <div className="sam2-spinner" />
            <p>Installing MatAnyone2...</p>
          </div>
        </div>
      )}

      {matStatus === 'not-checked' && (
        <div className="sam2-overlay">
          <div className="sam2-loading">
            <div className="sam2-spinner" />
            <span className="sam2-progress-text">Checking...</span>
          </div>
        </div>
      )}
    </>
  );
}

export function MatAnyoneStatusBar({
  matStatus,
  isMatReady,
  isMatInstalled,
  matProcessing,
}: MatAnyoneStatusBarProps) {
  return (
    <div className="sam2-status">
      <span className={`sam2-status-dot ${isMatReady ? 'ready' : isMatInstalled ? 'processing' : ''}`} />
      {matStatus === 'not-checked' && 'Checking...'}
      {matStatus === 'not-available' && 'Native Helper required'}
      {matStatus === 'not-installed' && 'Not installed'}
      {matStatus === 'gpu-required' && 'NVIDIA CUDA GPU required'}
      {matStatus === 'installing' && 'Installing...'}
      {matStatus === 'model-needed' && 'Model download needed'}
      {matStatus === 'downloading-model' && 'Downloading model...'}
      {matStatus === 'installed' && 'Installed (server stopped)'}
      {matStatus === 'starting' && 'Starting server...'}
      {matStatus === 'ready' && (matProcessing ? 'Processing...' : 'Ready')}
      {matStatus === 'error' && 'Error'}
    </div>
  );
}
