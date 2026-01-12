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
