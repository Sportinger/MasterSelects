// IndexedDBErrorDialog - Reports unavailable browser storage without assuming corruption.

import { useState, useEffect, useCallback } from 'react';
import './WelcomeOverlay.css';
import './WhatsNewDialog.css';
import './IndexedDBErrorDialog.css';

interface IndexedDBErrorDialogProps {
  onClose: () => void;
}

export function IndexedDBErrorDialog({ onClose }: IndexedDBErrorDialogProps) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 120);
  }, [onClose, isClosing]);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

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
      className={`whats-new-backdrop ${isClosing ? 'closing' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="welcome-overlay indexeddb-error-dialog">
        {/* Warning Icon */}
        <div className="indexeddb-error-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="#f59e0b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Title */}
        <h2 className="indexeddb-error-title">Browser Storage Error</h2>

        {/* Description */}
        <div className="indexeddb-error-content">
          <p className="indexeddb-error-description">
            Browser storage could not be opened. This may be temporary or caused by
            browser permissions or unavailable disk space. Project recovery, cached media
            and settings may be unavailable until storage access is restored.
          </p>

          <div className="indexeddb-error-note">
            <strong>Protect your work before refreshing.</strong> Save or back up your
            current project if possible. Unsaved changes may be lost when the page reloads.
          </div>

          <div className="indexeddb-error-steps">
            <h3>Next steps:</h3>
            <ol>
              <li>Check available disk space and this site's browser storage permissions.</li>
              <li>Save or back up your work before refreshing the page.</li>
              <li>If the problem continues, keep your project files and report the storage error.</li>
            </ol>
          </div>

          <p className="indexeddb-error-alternative">
            Do not clear site data to troubleshoot this error before backing up projects
            stored in this browser. Clearing site data can delete those projects.
          </p>
        </div>

        {/* Buttons */}
        <div className="indexeddb-error-buttons">
          <button className="indexeddb-error-btn secondary" onClick={handleClose}>
            Dismiss
          </button>
          <button className="indexeddb-error-btn primary" onClick={handleRefresh}>
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  );
}
