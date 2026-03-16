// AI Segment Panel — MatAnyone2 video matting with optional SAM2 mask creation
// Main workflow: Create mask (SAM2 or manual) → Run MatAnyone2 → Get alpha matte

import { useState, useCallback, useEffect } from 'react';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../services/matanyone/MatAnyoneService';
import { useSAM2Store } from '../../stores/sam2Store';
import { getSAM2Service } from '../../services/sam2/SAM2Service';
import { useTimelineStore } from '../../stores/timeline';
import { MatAnyoneSetupDialog } from '../common/MatAnyoneSetupDialog';
import './SAM2Panel.css';

export function SAM2Panel() {
  const [showSetup, setShowSetup] = useState(false);

  // MatAnyone2 state
  const matStatus = useMatAnyoneStore(s => s.setupStatus);
  const matProcessing = useMatAnyoneStore(s => s.isProcessing);
  const matProgress = useMatAnyoneStore(s => s.jobProgress);
  const matCurrentFrame = useMatAnyoneStore(s => s.currentFrame);
  const matTotalFrames = useMatAnyoneStore(s => s.totalFrames);
  const matResult = useMatAnyoneStore(s => s.lastResult);
  const matError = useMatAnyoneStore(s => s.errorMessage);
  const matGpu = useMatAnyoneStore(s => s.gpuName);
  const matCuda = useMatAnyoneStore(s => s.cudaAvailable);

  // SAM2 state (for mask creation)
  const sam2Status = useSAM2Store(s => s.modelStatus);
  const sam2Active = useSAM2Store(s => s.isActive);
  const sam2Processing = useSAM2Store(s => s.isProcessing);
  const sam2Points = useSAM2Store(s => s.points);
  const liveMask = useSAM2Store(s => s.liveMask);
  const maskOpacity = useSAM2Store(s => s.maskOpacity);
  const sam2DownloadProgress = useSAM2Store(s => s.downloadProgress);

  // Timeline
  const selectedClipIds = useTimelineStore(s => s.selectedClipIds);
  const clips = useTimelineStore(s => s.clips);
  const selectedClip = clips.find(c => selectedClipIds.has(c.id));

  // Check MatAnyone2 status on mount
  useEffect(() => {
    if (matStatus === 'not-checked') {
      getMatAnyoneService().checkStatus().catch(() => {});
    }
  }, [matStatus]);

  // SAM2 auto-load
  useEffect(() => {
    if (sam2Status === 'not-downloaded') {
      getSAM2Service().checkAndAutoLoad();
    }
  }, []);

  const isMatReady = matStatus === 'ready';
  const isMatInstalled = matStatus === 'installed' || matStatus === 'ready' || matStatus === 'starting';
  const hasMask = !!liveMask;

  // --- SAM2 handlers ---
  const handleSam2Toggle = useCallback(() => {
    const { setActive, clearPoints } = useSAM2Store.getState();
    if (sam2Active) {
      setActive(false);
      clearPoints();
    } else {
      setActive(true);
    }
  }, [sam2Active]);

  const handleSam2AutoDetect = useCallback(async () => {
    if (!selectedClip) return;
    try {
      const { engine } = await import('../../engine/WebGPUEngine');
      if (!engine) return;
      const pixels = await engine.readPixels();
      if (!pixels) return;
      const { width, height } = engine.getOutputDimensions();
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      await getSAM2Service().autoDetect(imageData, 0);
    } catch (e) {
      console.error('Auto-detect failed:', e);
    }
  }, [selectedClip]);

  const handleSam2Download = useCallback(() => {
    getSAM2Service().downloadModel();
  }, []);

  const handleClearMask = useCallback(() => {
    useSAM2Store.getState().clearPoints();
    useSAM2Store.getState().setLiveMask(null);
    useSAM2Store.getState().clearFrameMasks();
  }, []);

  // --- MatAnyone2 handlers ---
  const handleRunMatAnyone = useCallback(async () => {
    if (!selectedClip) return;
    const clipSource = selectedClip.source;
    if (!clipSource || clipSource.type !== 'video') return;

    const videoPath = (clipSource as { filePath?: string }).filePath;
    if (!videoPath) return;

    const maskData = useSAM2Store.getState().liveMask;
    if (!maskData) return;

    try {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = maskData.width;
      maskCanvas.height = maskData.height;
      const ctx = maskCanvas.getContext('2d');
      if (!ctx) return;

      const imageData = ctx.createImageData(maskData.width, maskData.height);
      for (let i = 0; i < maskData.maskData.length; i++) {
        const val = maskData.maskData[i] > 0 ? 255 : 0;
        imageData.data[i * 4] = val;
        imageData.data[i * 4 + 1] = val;
        imageData.data[i * 4 + 2] = val;
        imageData.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise<Blob | null>(resolve => maskCanvas.toBlob(resolve, 'image/png'));
      if (!blob) return;

      const { NativeHelperClient } = await import('../../services/nativeHelper/NativeHelperClient');
      const maskPath = videoPath.replace(/\.[^.]+$/, '_sam2_mask.png');
      await NativeHelperClient.writeFileBinary(maskPath, blob);

      const outputDir = videoPath.replace(/[/\\][^/\\]+$/, '');
      await getMatAnyoneService().matte({
        videoPath,
        maskPath,
        outputDir,
        sourceClipId: selectedClip.id,
      });
    } catch (e) {
      console.error('MatAnyone2 matting failed:', e);
    }
  }, [selectedClip]);

  const handleStartServer = useCallback(() => {
    getMatAnyoneService().startServer().catch(() => {});
  }, []);

  // --- Render ---
  return (
    <div className="sam2-panel">
      {/* Not installed — show setup prompt */}
      {!isMatInstalled && matStatus !== 'not-checked' && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon" style={{ fontSize: 32 }}>&#x2726;</span>
            <p style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px' }}>AI Video Matting</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              Extract people from video with precise alpha mattes.
              Powered by MatAnyone2.
            </p>
            <button className="sam2-download-btn" onClick={() => setShowSetup(true)}>
              Set Up MatAnyone2
            </button>
            <span className="sam2-size-hint" style={{ marginTop: 8 }}>
              Requires NVIDIA GPU + ~4 GB disk space
            </span>
          </div>
        </div>
      )}

      {/* Installing */}
      {matStatus === 'installing' && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <div className="sam2-spinner" />
            <p>Installing MatAnyone2...</p>
          </div>
        </div>
      )}

      {/* Checking status */}
      {matStatus === 'not-checked' && (
        <div className="sam2-overlay">
          <div className="sam2-loading">
            <div className="sam2-spinner" />
            <span className="sam2-progress-text">Checking status...</span>
          </div>
        </div>
      )}

      {/* Main content when installed */}
      {isMatInstalled && (
        <div className="sam2-content">
          {/* No clip selected */}
          {!selectedClip && (
            <div className="sam2-empty">
              <p>Select a video clip in the timeline to begin</p>
            </div>
          )}

          {selectedClip && (
            <>
              {/* Step 1: Create Mask with SAM2 */}
              <div className="sam2-section">
                <div className="sam2-section-title">Step 1: Create Mask</div>

                {sam2Status === 'ready' ? (
                  <>
                    <div className="sam2-actions">
                      <button
                        className={`sam2-btn ${sam2Active ? 'active' : ''}`}
                        onClick={handleSam2Toggle}
                      >
                        {sam2Active ? '* Active' : 'Activate SAM2'}
                      </button>
                      <button
                        className="sam2-btn primary"
                        onClick={handleSam2AutoDetect}
                        disabled={sam2Processing}
                      >
                        {sam2Processing ? '...' : 'Auto-Detect'}
                      </button>
                    </div>

                    {sam2Points.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {sam2Points.length} point{sam2Points.length !== 1 ? 's' : ''} placed
                        </span>
                        <button className="sam2-btn danger" onClick={handleClearMask} style={{ flex: 'none', padding: '2px 8px', fontSize: 11 }}>
                          Clear
                        </button>
                      </div>
                    )}

                    {hasMask && (
                      <div style={{ marginTop: 4 }}>
                        <div className="sam2-slider-row">
                          <span className="sam2-slider-label">Opacity</span>
                          <input
                            type="range" min={0} max={1} step={0.05}
                            value={maskOpacity}
                            onChange={e => useSAM2Store.getState().setMaskOpacity(parseFloat(e.target.value))}
                          />
                          <span className="sam2-slider-value">{Math.round(maskOpacity * 100)}%</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : sam2Status === 'downloading' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div className="sam2-progress-bar">
                      <div className="sam2-progress-fill" style={{ width: `${sam2DownloadProgress}%` }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Downloading SAM2... {Math.round(sam2DownloadProgress)}%</span>
                  </div>
                ) : (
                  <button className="sam2-btn" onClick={handleSam2Download} style={{ fontSize: 11 }}>
                    Download SAM2 Model (~103 MB)
                  </button>
                )}
              </div>

              {/* Step 2: Run MatAnyone2 */}
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
                      Server not running
                      {matGpu && <> &mdash; {matGpu}</>}
                    </span>
                    <button className="sam2-btn primary" onClick={handleStartServer}>
                      Start Server
                    </button>
                  </div>
                ) : (
                  <>
                    <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Extracts the masked subject with alpha for the entire clip.
                      {matCuda && matGpu && <> Using {matGpu}.</>}
                    </p>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="sam2-btn primary"
                        onClick={handleRunMatAnyone}
                        disabled={matProcessing || !hasMask}
                        style={{ flex: 1 }}
                      >
                        {matProcessing ? 'Processing...' : !hasMask ? 'Create mask first' : 'Run MatAnyone2'}
                      </button>
                      {matProcessing && (
                        <button
                          className="sam2-btn danger"
                          onClick={() => getMatAnyoneService().cancelJob()}
                          style={{ flex: 'none' }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>

                    {/* Progress */}
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

                    {/* Error */}
                    {matError && !matProcessing && (
                      <div style={{
                        padding: '6px 8px', marginTop: 4,
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid var(--danger)',
                        borderRadius: 4, fontSize: 11, color: 'var(--danger)',
                      }}>
                        {matError}
                      </div>
                    )}

                    {/* Result */}
                    {matResult && !matProcessing && (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 4,
                        paddingTop: 6, marginTop: 4,
                        borderTop: '1px solid var(--border-color)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--success)' }}>
                          Matting complete
                        </span>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          <div>{matResult.foregroundPath.split(/[/\\]/).pop()}</div>
                          <div>{matResult.alphaPath.split(/[/\\]/).pop()}</div>
                        </div>
                        <button className="sam2-btn" onClick={() => {
                          console.log('Import matting result:', matResult);
                        }} style={{ marginTop: 2, fontSize: 11 }}>
                          Import to Timeline
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="sam2-status">
        <span className={`sam2-status-dot ${isMatReady ? 'ready' : isMatInstalled ? 'processing' : ''}`} />
        {matStatus === 'not-checked' && 'Checking...'}
        {matStatus === 'not-available' && 'Native Helper required'}
        {matStatus === 'not-installed' && 'Not installed'}
        {matStatus === 'installing' && 'Installing...'}
        {matStatus === 'model-needed' && 'Model download needed'}
        {matStatus === 'downloading-model' && 'Downloading model...'}
        {matStatus === 'installed' && 'Installed (server stopped)'}
        {matStatus === 'starting' && 'Starting server...'}
        {matStatus === 'ready' && (matProcessing ? 'Processing...' : 'Ready')}
        {matStatus === 'error' && 'Error'}
      </div>

      {/* Setup dialog */}
      {showSetup && <MatAnyoneSetupDialog onClose={() => setShowSetup(false)} />}
    </div>
  );
}
