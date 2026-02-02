// InfoDialog - About MasterSelects info overlay
// Same style as WelcomeOverlay

import { useState, useEffect, useCallback } from 'react';
import { APP_VERSION } from '../../version';

interface InfoDialogProps {
  onClose: () => void;
}

export function InfoDialog({ onClose }: InfoDialogProps) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose, isClosing]);

  // Handle Escape key to close
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

  return (
    <div
      className={`welcome-overlay-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="welcome-overlay">
        {/* Privacy tagline */}
        <div className="welcome-tagline">
          <span className="welcome-tag-local">Local</span>
          <span className="welcome-tag-dot">·</span>
          <span className="welcome-tag-private">Private</span>
          <span className="welcome-tag-dot">·</span>
          <span className="welcome-tag-free">Free</span>
        </div>

        {/* Title */}
        <h1 className="welcome-title">
          <span className="welcome-title-master">Master</span>
          <span className="welcome-title-selects">Selects</span>
        </h1>

        <p className="welcome-subtitle">Video editing in your browser</p>

        {/* Info Card */}
        <div className="welcome-folder-card">
          <div className="info-content">
            <p className="info-description">
              MasterSelects is a browser-based video editor powered by WebGPU.
              All processing happens locally on your device - your files never leave your computer.
            </p>

            <div className="info-features">
              <div className="info-feature">
                <span className="info-feature-icon">GPU</span>
                <span>WebGPU accelerated rendering</span>
              </div>
              <div className="info-feature">
                <span className="info-feature-icon">37</span>
                <span>Blend modes</span>
              </div>
              <div className="info-feature">
                <span className="info-feature-icon">AI</span>
                <span>AI-powered editing tools</span>
              </div>
              <div className="info-feature">
                <span className="info-feature-icon">4K</span>
                <span>High resolution export</span>
              </div>
            </div>

            <div className="info-version">
              Version {APP_VERSION}
            </div>

            <a
              href="https://github.com/Sportinger/MASterSelects"
              target="_blank"
              rel="noopener noreferrer"
              className="info-github-link"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              <span>View on GitHub</span>
            </a>
          </div>
        </div>

        {/* Close button */}
        <button className="welcome-enter" onClick={handleClose}>
          <span>Close</span>
          <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
