// WelcomeOverlay - First-time user welcome with folder picker
// Shows on first load to ask for proxy/analysis data storage folder

import { useState, useCallback, useEffect } from 'react';
import { pickProxyFolder, getProxyFolderName, isFileSystemAccessSupported, initFileSystemService } from '../../services/fileSystemService';
import { useSettingsStore } from '../../stores/settingsStore';

interface WelcomeOverlayProps {
  onComplete: () => void;
}

export function WelcomeOverlay({ onComplete }: WelcomeOverlayProps) {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore folder handle from IndexedDB on mount
  useEffect(() => {
    initFileSystemService().then(() => {
      setSelectedFolder(getProxyFolderName());
    });
  }, []);

  const isSupported = isFileSystemAccessSupported();

  const handleSelectFolder = useCallback(async () => {
    if (isSelecting) return;
    setIsSelecting(true);
    setError(null);

    try {
      const handle = await pickProxyFolder();
      if (handle) {
        setSelectedFolder(handle.name);
      }
    } catch (e) {
      console.error('[WelcomeOverlay] Failed to select folder:', e);
      setError('Failed to select folder. Please try again.');
    } finally {
      setIsSelecting(false);
    }
  }, [isSelecting]);

  const handleContinue = useCallback(() => {
    useSettingsStore.getState().setHasCompletedSetup(true);
    onComplete();
  }, [onComplete]);


  return (
    <div className="welcome-overlay-backdrop">
      <div className="welcome-overlay">
        {/* Privacy note - top */}
        <p className="welcome-privacy">
          Privacy first. No account needed.<br />
          All data stays on your device.
        </p>

        {/* Title */}
        <h1 className="welcome-title">Welcome to MasterSelects</h1>
        <p className="welcome-subtitle">Professional video editing in your browser</p>

        {/* Folder Selection */}
        <div className="welcome-folder-section">
          {!isSupported ? (
            <p className="welcome-note">
              Proxy files will be stored temporarily in browser memory.
            </p>
          ) : (
            <>
              <p className="welcome-folder-hint">
                Choose where to store proxy files for faster editing
              </p>

              {selectedFolder ? (
                <button
                  className="welcome-folder-selected"
                  onClick={handleSelectFolder}
                  disabled={isSelecting}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="welcome-folder-path">{selectedFolder}</span>
                </button>
              ) : (
                <button
                  className="welcome-select-folder"
                  onClick={handleSelectFolder}
                  disabled={isSelecting}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  {isSelecting ? 'Selecting...' : 'Select Folder'}
                </button>
              )}

              {error && <p className="welcome-error">{error}</p>}
            </>
          )}
        </div>

        {/* Continue Button */}
        <button
          className="welcome-continue"
          onClick={handleContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
