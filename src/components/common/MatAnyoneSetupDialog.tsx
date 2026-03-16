// MatAnyoneSetupDialog - Multi-step setup wizard for MatAnyone2 AI Video Matting
// Guides the user through installation of Python env, dependencies, and model weights.

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../services/matanyone/MatAnyoneService';

interface MatAnyoneSetupDialogProps {
  onClose: () => void;
}

// --- Icon components ---

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#4ade80" strokeWidth="1.5" />
      <path d="M4.5 8.2l2.1 2.1L11.5 5.7" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#f87171" strokeWidth="1.5" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L1 14h14L8 2z" stroke="#fbbf24" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6v4M8 12v.5" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SuccessBigIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="22" stroke="#4ade80" strokeWidth="2" />
      <path d="M14 24l7 7L34 17" stroke="#4ade80" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: 'matanyone-spin 0.8s linear infinite' }}
    >
      <circle cx="8" cy="8" r="6.5" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
      <path d="M14.5 8a6.5 6.5 0 00-6.5-6.5" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// --- Styles ---

const styles = {
  backdrop: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10002,
    backdropFilter: 'blur(10px)',
    opacity: 1,
    animation: 'welcome-backdrop-in 0.14s ease-out both',
    transition: 'backdrop-filter 120ms ease-out, opacity 120ms ease-out',
  },
  backdropClosing: {
    backdropFilter: 'blur(0px)',
    opacity: 0,
  },
  dialog: {
    background: 'linear-gradient(165deg, rgba(30, 30, 30, 0.95) 0%, rgba(15, 15, 15, 0.98) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    width: 500,
    maxWidth: '90vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.02), 0 40px 80px rgba(0, 0, 0, 0.5), 0 0 120px rgba(0, 0, 0, 0.3)',
    animation: 'welcome-overlay-in 0.16s ease-out both',
    transition: 'opacity 120ms ease-out, transform 120ms ease-out',
    overflow: 'hidden',
  },
  dialogClosing: {
    opacity: 0,
    transform: 'scale(0.96)',
  },
  header: {
    padding: '24px 24px 0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  headerTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.95)',
    letterSpacing: '-0.01em',
  },
  headerSubtitle: {
    margin: 0,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    fontWeight: 400,
  },
  body: {
    padding: '20px 24px',
    flex: 1,
    overflowY: 'auto' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
  },
  description: {
    fontSize: 13,
    lineHeight: 1.5,
    color: 'rgba(255, 255, 255, 0.65)',
    margin: 0,
  },
  requirementsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  requirementItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 1.4,
  },
  requirementIcon: {
    flexShrink: 0,
    marginTop: 1,
  },
  requirementDetail: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.4)',
    marginTop: 2,
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 8,
    background: 'rgba(251, 191, 36, 0.08)',
    border: '1px solid rgba(251, 191, 36, 0.15)',
    fontSize: 12,
    color: 'rgba(251, 191, 36, 0.9)',
    lineHeight: 1.4,
  },
  warningIconWrap: {
    flexShrink: 0,
    marginTop: 1,
  },
  footer: {
    padding: '16px 24px 20px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
  },
  btnPrimary: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: 'rgba(99, 102, 241, 0.9)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s, opacity 0.15s',
    outline: 'none',
  },
  btnSecondary: {
    padding: '8px 20px',
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.1)',
    background: 'rgba(255, 255, 255, 0.04)',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
    outline: 'none',
  },
  btnDanger: {
    padding: '8px 20px',
    borderRadius: 8,
    border: '1px solid rgba(239, 68, 68, 0.2)',
    background: 'rgba(239, 68, 68, 0.1)',
    color: 'rgba(239, 68, 68, 0.9)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
    outline: 'none',
  },
  progressSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  progressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    background: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden' as const,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    background: 'linear-gradient(90deg, #6366f1, #818cf8)',
    transition: 'width 0.3s ease-out',
  },
  progressText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'right' as const,
  },
  logArea: {
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    padding: '10px 12px',
    maxHeight: 180,
    overflowY: 'auto' as const,
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace',
    fontSize: 11,
    lineHeight: 1.6,
    color: 'rgba(255, 255, 255, 0.5)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  successCenter: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 16,
    padding: '20px 0',
  },
  successTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'rgba(255, 255, 255, 0.9)',
    margin: 0,
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px 12px',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
    width: '100%',
    maxWidth: 320,
  },
  infoLabel: {
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'right' as const,
  },
  infoValue: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    padding: '12px 14px',
    borderRadius: 8,
    background: 'rgba(239, 68, 68, 0.08)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'rgba(239, 68, 68, 0.9)',
    margin: 0,
  },
  errorMessage: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'rgba(239, 68, 68, 0.7)',
    margin: 0,
    wordBreak: 'break-word' as const,
  },
  modelInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center' as const,
    margin: 0,
  },
} as const;

// Keyframes injection (done once)
const STYLE_ID = 'matanyone-setup-keyframes';
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes matanyone-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

// --- Component ---

export function MatAnyoneSetupDialog({ onClose }: MatAnyoneSetupDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const {
    setupStatus,
    setupProgress,
    setupStep,
    setupLog,
    errorMessage,
    pythonVersion,
    cudaAvailable,
    cudaVersion,
    gpuName,
    vramMb,
    modelDownloaded,
  } = useMatAnyoneStore();

  // Inject keyframes on mount
  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Check status on mount if not checked yet
  useEffect(() => {
    if (setupStatus === 'not-checked') {
      getMatAnyoneService().checkStatus();
    }
  }, []);

  // Auto-scroll log area to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupLog]);

  const isInstalling = setupStatus === 'installing' || setupStatus === 'downloading-model' || setupStatus === 'starting';

  const handleClose = useCallback(() => {
    if (isClosing || isInstalling) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 120);
  }, [onClose, isClosing, isInstalling]);

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleInstall = useCallback(async () => {
    const service = getMatAnyoneService();
    await service.setup();
    // After setup, if status is model-needed, auto-download
    const currentStatus = useMatAnyoneStore.getState().setupStatus;
    if (currentStatus === 'model-needed') {
      await service.downloadModel();
    }
  }, []);

  const handleRetry = useCallback(async () => {
    useMatAnyoneStore.getState().setError(null);
    useMatAnyoneStore.getState().setSetupStatus('not-installed');
    const service = getMatAnyoneService();
    await service.setup();
    const currentStatus = useMatAnyoneStore.getState().setupStatus;
    if (currentStatus === 'model-needed') {
      await service.downloadModel();
    }
  }, []);

  const handleDownloadModel = useCallback(async () => {
    await getMatAnyoneService().downloadModel();
  }, []);

  // Determine which view to render
  const renderContent = () => {
    switch (setupStatus) {
      case 'not-checked':
      case 'not-installed':
      case 'not-available':
        return renderWelcome();
      case 'installing':
        return renderInstalling();
      case 'model-needed':
        return renderModelNeeded();
      case 'downloading-model':
        return renderDownloadingModel();
      case 'installed':
      case 'ready':
      case 'starting':
        return renderComplete();
      case 'error':
        return renderError();
      default:
        return renderWelcome();
    }
  };

  // --- View 1: Welcome & Prerequisites ---
  const renderWelcome = () => {
    const formatVram = (mb: number | null) => {
      if (mb === null) return '';
      if (mb >= 1024) return ` (${(mb / 1024).toFixed(1)} GB VRAM)`;
      return ` (${mb} MB VRAM)`;
    };

    return (
      <>
        <div style={styles.body}>
          <p style={styles.description}>
            Extract people from video with precise alpha mattes for clean compositing.
            Works with SAM2 masks to automatically generate production-quality alpha channels.
          </p>

          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
              Requirements
            </div>
            <ul style={styles.requirementsList}>
              <li style={styles.requirementItem}>
                <span style={styles.requirementIcon}>
                  {cudaAvailable ? <CheckIcon /> : <CrossIcon />}
                </span>
                <div>
                  <div>NVIDIA GPU with CUDA</div>
                  {gpuName && (
                    <div style={styles.requirementDetail}>
                      {gpuName}{formatVram(vramMb)}
                      {cudaVersion && ` \u00b7 CUDA ${cudaVersion}`}
                    </div>
                  )}
                  {!gpuName && !cudaAvailable && (
                    <div style={styles.requirementDetail}>Not detected</div>
                  )}
                </div>
              </li>
              <li style={styles.requirementItem}>
                <span style={styles.requirementIcon}>
                  <CheckIcon />
                </span>
                <div>
                  <div>~4 GB disk space</div>
                  <div style={styles.requirementDetail}>Python environment + PyTorch</div>
                </div>
              </li>
              <li style={styles.requirementItem}>
                <span style={styles.requirementIcon}>
                  <CheckIcon />
                </span>
                <div>
                  <div>~150 MB for model weights</div>
                  <div style={styles.requirementDetail}>Downloaded from HuggingFace</div>
                </div>
              </li>
            </ul>
          </div>

          {!cudaAvailable && (
            <div style={styles.warningBox}>
              <span style={styles.warningIconWrap}><WarningIcon /></span>
              <span>No NVIDIA GPU detected. CPU mode will be very slow but installation is still possible.</span>
            </div>
          )}

          {setupStatus === 'not-available' && (
            <div style={styles.warningBox}>
              <span style={styles.warningIconWrap}><WarningIcon /></span>
              <span>Native helper is not connected. Please start the native helper first (see Tools menu).</span>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button
            style={styles.btnSecondary}
            onClick={handleClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
          >
            Cancel
          </button>
          <button
            style={{
              ...styles.btnPrimary,
              opacity: setupStatus === 'not-available' ? 0.5 : 1,
              cursor: setupStatus === 'not-available' ? 'not-allowed' : 'pointer',
              padding: '10px 28px',
              fontSize: 14,
            }}
            disabled={setupStatus === 'not-available'}
            onClick={handleInstall}
            onMouseEnter={(e) => {
              if (setupStatus !== 'not-available') {
                e.currentTarget.style.background = 'rgba(99, 102, 241, 1)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)';
            }}
          >
            Install
          </button>
        </div>
      </>
    );
  };

  // --- View 2: Installing ---
  const renderInstalling = () => (
    <>
      <div style={styles.body}>
        <div style={styles.progressSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SpinnerIcon />
            <span style={styles.stepLabel}>{setupStep || 'Setting up environment...'}</span>
          </div>

          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${Math.max(setupProgress, 2)}%` }} />
          </div>
          <div style={styles.progressText}>{Math.round(setupProgress)}%</div>
        </div>

        {setupLog.length > 0 && (
          <div style={styles.logArea}>
            {setupLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.btnSecondary, opacity: 0.5, cursor: 'not-allowed' }}
          disabled
        >
          Cancel
        </button>
      </div>
    </>
  );

  // --- View 3a: Model needed (not yet downloading) ---
  const renderModelNeeded = () => (
    <>
      <div style={styles.body}>
        <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 16, padding: '16px 0' }}>
          <div style={{ fontSize: 32 }}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect x="4" y="8" width="32" height="24" rx="3" stroke="rgba(255,255,255,0.5)" strokeWidth="2" />
              <path d="M16 16l8 4-8 4V16z" fill="rgba(255,255,255,0.5)" />
            </svg>
          </div>
          <p style={{ ...styles.description, textAlign: 'center' }}>
            Environment is set up. Download the model weights to complete installation.
          </p>
          <p style={styles.modelInfo}>~141 MB from HuggingFace</p>
        </div>
      </div>

      <div style={styles.footer}>
        <button
          style={styles.btnSecondary}
          onClick={handleClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        >
          Later
        </button>
        <button
          style={{ ...styles.btnPrimary, padding: '10px 28px' }}
          onClick={handleDownloadModel}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)'; }}
        >
          Download Model
        </button>
      </div>
    </>
  );

  // --- View 3b: Downloading model ---
  const renderDownloadingModel = () => (
    <>
      <div style={styles.body}>
        <div style={styles.progressSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SpinnerIcon />
            <span style={styles.stepLabel}>{setupStep || 'Downloading model weights...'}</span>
          </div>

          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${Math.max(setupProgress, 2)}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={styles.modelInfo}>~141 MB from HuggingFace</span>
            <span style={styles.progressText}>{Math.round(setupProgress)}%</span>
          </div>
        </div>

        {setupLog.length > 0 && (
          <div style={styles.logArea}>
            {setupLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.btnSecondary, opacity: 0.5, cursor: 'not-allowed' }}
          disabled
        >
          Cancel
        </button>
      </div>
    </>
  );

  // --- View 4: Complete ---
  const renderComplete = () => (
    <>
      <div style={styles.body}>
        <div style={styles.successCenter}>
          <SuccessBigIcon />
          <p style={styles.successTitle}>Setup complete! MatAnyone2 is ready.</p>

          <div style={styles.infoGrid}>
            {pythonVersion && (
              <>
                <span style={styles.infoLabel}>Python</span>
                <span style={styles.infoValue}>{pythonVersion}</span>
              </>
            )}
            {cudaAvailable && cudaVersion && (
              <>
                <span style={styles.infoLabel}>CUDA</span>
                <span style={styles.infoValue}>{cudaVersion}</span>
              </>
            )}
            {gpuName && (
              <>
                <span style={styles.infoLabel}>GPU</span>
                <span style={styles.infoValue}>
                  {gpuName}
                  {vramMb !== null && vramMb >= 1024
                    ? ` (${(vramMb / 1024).toFixed(1)} GB)`
                    : vramMb !== null
                      ? ` (${vramMb} MB)`
                      : ''}
                </span>
              </>
            )}
            {modelDownloaded && (
              <>
                <span style={styles.infoLabel}>Model</span>
                <span style={styles.infoValue}>MatAnyone2</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.btnPrimary, padding: '10px 28px' }}
          onClick={handleClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)'; }}
        >
          Close
        </button>
      </div>
    </>
  );

  // --- View 5: Error ---
  const renderError = () => {
    // Show last few log lines for debugging context
    const recentLogs = setupLog.slice(-10);

    return (
      <>
        <div style={styles.body}>
          <div style={styles.errorBox}>
            <p style={styles.errorTitle}>Setup failed</p>
            {errorMessage && <p style={styles.errorMessage}>{errorMessage}</p>}
          </div>

          {recentLogs.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
                Recent log output
              </div>
              <div style={styles.logArea}>
                {recentLogs.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button
            style={styles.btnSecondary}
            onClick={handleClose}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
          >
            Close
          </button>
          <button
            style={styles.btnDanger}
            onClick={handleRetry}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
          >
            Retry
          </button>
        </div>
      </>
    );
  };

  return (
    <div
      style={{
        ...styles.backdrop,
        ...(isClosing ? styles.backdropClosing : {}),
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          ...styles.dialog,
          ...(isClosing ? styles.dialogClosing : {}),
        }}
      >
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.headerTitle}>AI Video Matting</h2>
          <p style={styles.headerSubtitle}>Powered by MatAnyone2</p>
        </div>

        {/* Dynamic content based on status */}
        {renderContent()}
      </div>
    </div>
  );
}
