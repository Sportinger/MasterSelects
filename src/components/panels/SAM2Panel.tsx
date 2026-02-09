// SAM 2 AI Segmentation Panel
// Provides controls for SAM2: model download, point-based segmentation, and video propagation

import { useCallback, useEffect } from 'react';
import { useSAM2Store } from '../../stores/sam2Store';
import { useTimelineStore } from '../../stores/timeline';
import { getSAM2Service } from '../../services/sam2/SAM2Service';
import './SAM2Panel.css';

export function SAM2Panel() {
  const {
    modelStatus,
    downloadProgress,
    errorMessage,
    isActive,
    isProcessing,
    points,
    liveMask,
    isPropagating,
    propagationProgress,
    maskOpacity,
    feather,
    inverted,
    setActive,
    removePoint,
    clearPoints,
    setMaskOpacity,
    setFeather,
    setInverted,
  } = useSAM2Store();

  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);
  const selectedClip = clips.find((c) => selectedClipIds.has(c.id));

  const service = getSAM2Service();

  // Auto-load model on mount if cached
  useEffect(() => {
    if (modelStatus === 'not-downloaded') {
      service.checkAndAutoLoad();
    }
  }, []);

  const handleDownload = useCallback(() => {
    service.downloadModel();
  }, []);

  const handleAutoDetect = useCallback(async () => {
    if (!selectedClip) return;

    try {
      const { engine } = await import('../../engine/WebGPUEngine');
      if (!engine) return;

      const pixels = await engine.readPixels();
      if (!pixels) return;

      const { width, height } = engine.getOutputDimensions();
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      await service.autoDetect(imageData, 0);
    } catch (e) {
      console.error('Auto-detect failed:', e);
    }
  }, [selectedClip]);

  const handleToggleActive = useCallback(() => {
    setActive(!isActive);
    if (isActive) {
      // Deactivating — clear points
      clearPoints();
    }
  }, [isActive, setActive, clearPoints]);

  const handleClearMask = useCallback(() => {
    clearPoints();
    useSAM2Store.getState().setLiveMask(null);
    useSAM2Store.getState().clearFrameMasks();
  }, [clearPoints]);

  const handlePropagateForward = useCallback(async () => {
    if (!selectedClip) return;

    const captureFrame = async (_frameIndex: number): Promise<ImageData | null> => {
      try {
        const { engine } = await import('../../engine/WebGPUEngine');
        if (!engine) return null;

        const pixels = await engine.readPixels();
        if (!pixels) return null;

        const { width, height } = engine.getOutputDimensions();
        return new ImageData(new Uint8ClampedArray(pixels), width, height);
      } catch {
        return null;
      }
    };

    // Propagate 150 frames forward (~5 sec at 30fps)
    await service.propagateToRange(captureFrame, 0, 150);
  }, [selectedClip]);

  const handleStopPropagation = useCallback(() => {
    service.stopPropagation();
  }, []);

  const needsDownload = modelStatus === 'not-downloaded' || modelStatus === 'downloading';
  const isLoading = modelStatus === 'loading';
  const isReady = modelStatus === 'ready';
  const hasError = modelStatus === 'error';

  return (
    <div className={`sam2-panel ${needsDownload ? 'needs-download' : ''}`}>
      {/* Download overlay */}
      {needsDownload && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon">✨</span>
            <p>AI Segmentation requires a one-time model download</p>
            <span className="sam2-size-hint">SAM 2 Small — ~103 MB, cached locally</span>

            {modelStatus === 'downloading' ? (
              <>
                <div className="sam2-progress-bar">
                  <div className="sam2-progress-fill" style={{ width: `${downloadProgress}%` }} />
                </div>
                <span className="sam2-progress-text">{Math.round(downloadProgress)}%</span>
              </>
            ) : (
              <button className="sam2-download-btn" onClick={handleDownload}>
                Download Model
              </button>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="sam2-overlay">
          <div className="sam2-loading">
            <div className="sam2-spinner" />
            <span className="sam2-progress-text">Loading model...</span>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="sam2-content">
        {hasError && errorMessage && (
          <div className="sam2-error">
            {errorMessage}
            <button onClick={handleDownload}>Retry</button>
          </div>
        )}

        {isReady && !selectedClip && (
          <div className="sam2-empty">
            <span className="sam2-empty-icon">🎬</span>
            <p>Select a clip in the timeline to begin segmentation</p>
          </div>
        )}

        {isReady && selectedClip && (
          <>
            {/* Mode toggle */}
            <div className="sam2-section">
              <div className="sam2-section-title">Mode</div>
              <div className="sam2-actions">
                <button
                  className={`sam2-btn ${isActive ? 'active' : ''}`}
                  onClick={handleToggleActive}
                >
                  {isActive ? '● Active' : '○ Activate'}
                </button>
                <button
                  className="sam2-btn primary"
                  onClick={handleAutoDetect}
                  disabled={!isReady || isProcessing}
                >
                  {isProcessing ? '...' : '⚡ Auto-Detect'}
                </button>
              </div>
            </div>

            {/* Points list */}
            {points.length > 0 && (
              <div className="sam2-section">
                <div className="sam2-section-title">
                  Points ({points.length})
                </div>
                <div className="sam2-points-list">
                  {points.map((pt, i) => (
                    <div key={i} className="sam2-point-item">
                      <span className={`sam2-point-dot ${pt.label === 1 ? 'foreground' : 'background'}`} />
                      <span>{pt.label === 1 ? '+' : '−'} ({pt.x.toFixed(2)}, {pt.y.toFixed(2)})</span>
                      <button className="sam2-point-remove" onClick={() => removePoint(i)}>×</button>
                    </div>
                  ))}
                </div>
                <button className="sam2-btn danger" onClick={handleClearMask} style={{ flex: 'none' }}>
                  Clear All
                </button>
              </div>
            )}

            {/* Display settings */}
            <div className="sam2-section">
              <div className="sam2-section-title">Display</div>

              <div className="sam2-slider-row">
                <span className="sam2-slider-label">Opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={maskOpacity}
                  onChange={(e) => setMaskOpacity(parseFloat(e.target.value))}
                />
                <span className="sam2-slider-value">{Math.round(maskOpacity * 100)}%</span>
              </div>

              <div className="sam2-slider-row">
                <span className="sam2-slider-label">Feather</span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={feather}
                  onChange={(e) => setFeather(parseInt(e.target.value))}
                />
                <span className="sam2-slider-value">{feather}px</span>
              </div>

              <label className="sam2-checkbox-row">
                <input
                  type="checkbox"
                  checked={inverted}
                  onChange={(e) => setInverted(e.target.checked)}
                />
                Invert Mask
              </label>
            </div>

            {/* Propagation */}
            {liveMask && (
              <div className="sam2-propagation">
                <div className="sam2-section-title">Video Propagation</div>
                {isPropagating ? (
                  <>
                    <div className="sam2-propagation-progress">
                      <div className="sam2-spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                      Propagating... {Math.round(propagationProgress)}%
                    </div>
                    <div className="sam2-progress-bar">
                      <div className="sam2-progress-fill" style={{ width: `${propagationProgress}%` }} />
                    </div>
                    <button className="sam2-btn danger" onClick={handleStopPropagation}>
                      Stop
                    </button>
                  </>
                ) : (
                  <div className="sam2-propagation-btns">
                    <button
                      className="sam2-btn"
                      onClick={handlePropagateForward}
                      disabled={isProcessing}
                    >
                      ▶ Forward
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="sam2-status">
        <span
          className={`sam2-status-dot ${
            isReady ? (isProcessing ? 'processing' : 'ready') : hasError ? 'error' : ''
          }`}
        />
        {modelStatus === 'not-downloaded' && 'Model not downloaded'}
        {modelStatus === 'downloading' && `Downloading... ${Math.round(downloadProgress)}%`}
        {modelStatus === 'downloaded' && 'Downloaded, loading...'}
        {modelStatus === 'loading' && 'Loading model...'}
        {modelStatus === 'ready' && (isProcessing ? 'Processing...' : 'Ready')}
        {modelStatus === 'error' && 'Error'}
      </div>
    </div>
  );
}
