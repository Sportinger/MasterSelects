// AI Segment Panel — MatAnyone2 video matting with mask creation (Paint or SAM2)
// Workflow: Create mask (paint brush or SAM2) → Run MatAnyone2 → Get alpha matte

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../services/matanyone/MatAnyoneService';
import { useSAM2Store } from '../../stores/sam2Store';
import { getSAM2Service } from '../../services/sam2/SAM2Service';
import { useTimelineStore } from '../../stores/timeline';
import { MatAnyoneSetupDialog } from '../common/MatAnyoneSetupDialog';
import './SAM2Panel.css';

type MaskMode = 'paint' | 'sam2';

export function SAM2Panel() {
  const [showSetup, setShowSetup] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskMode>('paint');
  const [isPainting, setIsPainting] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [isEraser, setIsEraser] = useState(false);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasPaintedMask, setHasPaintedMask] = useState(false);

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

  // SAM2 state
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

  // Check MatAnyone2 status on mount (skip if already resolved)
  useEffect(() => {
    const current = useMatAnyoneStore.getState().setupStatus;
    if (current !== 'not-checked') return; // Already resolved (StrictMode re-mount)

    let cancelled = false;
    const tryCheck = async (attempt: number) => {
      if (cancelled) return;
      const s = useMatAnyoneStore.getState().setupStatus;
      if (s !== 'not-checked' && s !== 'not-available') return; // Resolved by another mount

      try {
        await getMatAnyoneService().checkStatus();
      } catch {
        if (!cancelled && attempt < 4) {
          setTimeout(() => tryCheck(attempt + 1), 2000);
        }
      }
    };

    const timeout = setTimeout(() => tryCheck(0), 500);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  // SAM2 auto-load
  useEffect(() => {
    if (sam2Status === 'not-downloaded') {
      getSAM2Service().checkAndAutoLoad();
    }
  }, [sam2Status]);

  const isMatReady = matStatus === 'ready';
  const isMatInstalled = matStatus === 'installed' || matStatus === 'ready' || matStatus === 'starting';
  const hasMask = maskMode === 'paint' ? hasPaintedMask : !!liveMask;
  const showSetupOverlay = matStatus === 'not-installed' || matStatus === 'error';
  const showHelperOverlay = matStatus === 'not-available';

  // --- Paint mask ---
  const initPaintCanvas = useCallback(async () => {
    try {
      const { engine } = await import('../../engine/WebGPUEngine');
      if (!engine) return;
      const { width, height } = engine.getOutputDimensions();

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);
      paintCanvasRef.current = canvas;
    } catch {
      // fallback size
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, 1920, 1080);
      }
      paintCanvasRef.current = canvas;
    }
  }, []);

  // Initialize paint canvas when painting starts
  useEffect(() => {
    if (isPainting && !paintCanvasRef.current) {
      initPaintCanvas();
    }
  }, [initPaintCanvas, isPainting]);

  const addPaintOverlay = useCallback(() => {
    // Find the preview canvas wrapper (contains the WebGPU canvas)
    const wrapper = document.querySelector('.preview-canvas-wrapper');
    if (!wrapper) return;

    const parent = wrapper as HTMLElement;

    // Remove existing overlay
    document.getElementById('mask-paint-overlay')?.remove();

    // Create overlay canvas
    const overlay = document.createElement('canvas');
    overlay.id = 'mask-paint-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.cursor = 'crosshair';
    overlay.style.zIndex = '100';
    overlay.style.pointerEvents = 'auto';

    // Match size
    const rect = parent.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;

    parent.style.position = 'relative';
    parent.appendChild(overlay);

    const ctx = overlay.getContext('2d')!;
    let drawing = false;

    const getPos = (e: MouseEvent) => {
      const r = overlay.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const drawDot = (x: number, y: number) => {
      // Draw on the overlay (visual feedback)
      ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
      ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : 'rgba(74, 222, 128, 0.5)';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();

      // Also draw on the mask canvas (actual mask data)
      const maskCanvas = paintCanvasRef.current;
      if (maskCanvas) {
        const maskCtx = maskCanvas.getContext('2d');
        if (maskCtx) {
          const scaleX = maskCanvas.width / overlay.width;
          const scaleY = maskCanvas.height / overlay.height;
          maskCtx.fillStyle = isEraser ? 'black' : 'white';
          maskCtx.beginPath();
          maskCtx.arc(x * scaleX, y * scaleY, (brushSize / 2) * Math.max(scaleX, scaleY), 0, Math.PI * 2);
          maskCtx.fill();
        }
      }
      setHasPaintedMask(true);
    };

    overlay.addEventListener('mousedown', (e) => {
      drawing = true;
      const { x, y } = getPos(e);
      drawDot(x, y);
    });

    overlay.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const { x, y } = getPos(e);
      drawDot(x, y);
    });

    overlay.addEventListener('mouseup', () => { drawing = false; });
    overlay.addEventListener('mouseleave', () => { drawing = false; });
  }, [brushSize, isEraser]);

  const handlePaintToggle = useCallback(() => {
    if (isPainting) {
      setIsPainting(false);
      // Remove paint overlay from preview
      const overlay = document.getElementById('mask-paint-overlay');
      overlay?.remove();
    } else {
      setIsPainting(true);
      // Deactivate SAM2 if active
      if (sam2Active) {
        useSAM2Store.getState().setActive(false);
      }
      // Add paint overlay to preview canvas
      setTimeout(() => addPaintOverlay(), 50);
    }
  }, [addPaintOverlay, isPainting, sam2Active]);

  const handleClearPaint = useCallback(() => {
    const canvas = paintCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    // Clear overlay
    const overlay = document.getElementById('mask-paint-overlay');
    if (overlay) {
      const ctx = (overlay as HTMLCanvasElement).getContext('2d');
      ctx?.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
    }
    setHasPaintedMask(false);
  }, []);

  // --- SAM2 handlers ---
  const handleSam2Toggle = useCallback(() => {
    const { setActive, clearPoints } = useSAM2Store.getState();
    if (sam2Active) {
      setActive(false);
      clearPoints();
    } else {
      setActive(true);
      // Deactivate paint if active
      if (isPainting) {
        setIsPainting(false);
        document.getElementById('mask-paint-overlay')?.remove();
      }
    }
  }, [sam2Active, isPainting]);

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

  // --- MatAnyone2 handler ---
  const handleRunMatAnyone = useCallback(async () => {
    if (!selectedClip) return;
    const clipSource = selectedClip.source;
    if (!clipSource || clipSource.type !== 'video') {
      useMatAnyoneStore.getState().setError('Selected clip is not a video');
      return;
    }

    // Try multiple sources for the file path
    let videoPath = (clipSource as { filePath?: string }).filePath;

    // If no filePath on source, check mediaStore for absolutePath
    if (!videoPath) {
      const { useMediaStore } = await import('../../stores/mediaStore');
      const mediaFiles = useMediaStore.getState().files;
      const mediaFile = mediaFiles.find(f => f.id === selectedClip.mediaFileId);
      videoPath = mediaFile?.absolutePath;
    }

    if (!videoPath) {
      useMatAnyoneStore.getState().setError(
        'No file path available. The video must be imported from disk (not dragged from browser). ' +
        'Try re-importing the file with the Native Helper running.'
      );
      return;
    }

    try {
      let maskBlob: Blob | null = null;

      if (maskMode === 'paint') {
        // Use painted mask
        const canvas = paintCanvasRef.current;
        if (!canvas) return;
        maskBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      } else {
        // Use SAM2 mask
        const maskData = useSAM2Store.getState().liveMask;
        if (!maskData) return;

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
        maskBlob = await new Promise<Blob | null>(resolve => maskCanvas.toBlob(resolve, 'image/png'));
      }

      if (!maskBlob) return;

      const { NativeHelperClient } = await import('../../services/nativeHelper/NativeHelperClient');
      const maskPath = videoPath.replace(/\.[^.]+$/, '_mask.png');
      await NativeHelperClient.writeFileBinary(maskPath, maskBlob);

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
  }, [selectedClip, maskMode]);

  const handleStartServer = useCallback(() => {
    getMatAnyoneService().startServer().catch(() => {});
  }, []);

  // Cleanup paint overlay on unmount
  useEffect(() => {
    return () => {
      document.getElementById('mask-paint-overlay')?.remove();
    };
  }, []);

  // --- Render ---
  return (
    <div className="sam2-panel">
      {/* Native helper unavailable */}
      {showHelperOverlay && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon" style={{ fontSize: 32 }}>&#x26A1;</span>
            <p style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px' }}>Native Helper Required</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              MatAnyone2 is installed, but the Native Helper is not connected right now.
            </p>
            <button className="sam2-download-btn" onClick={() => getMatAnyoneService().checkStatus().catch(() => {})}>
              Retry Connection
            </button>
          </div>
        </div>
      )}

      {/* Not installed / setup error */}
      {showSetupOverlay && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <span className="sam2-icon" style={{ fontSize: 32 }}>&#x2726;</span>
            <p style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px' }}>
              {matStatus === 'error' ? 'MatAnyone2 Setup Error' : 'AI Video Matting'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {matStatus === 'error'
                ? (matError || 'The MatAnyone2 setup needs attention.')
                : 'Extract people from video with precise alpha mattes.'}
            </p>
            <button className="sam2-download-btn" onClick={() => setShowSetup(true)}>
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

      {/* Installing */}
      {matStatus === 'installing' && (
        <div className="sam2-overlay">
          <div className="sam2-overlay-content">
            <div className="sam2-spinner" />
            <p>Installing MatAnyone2...</p>
          </div>
        </div>
      )}

      {/* Checking */}
      {matStatus === 'not-checked' && (
        <div className="sam2-overlay">
          <div className="sam2-loading">
            <div className="sam2-spinner" />
            <span className="sam2-progress-text">Checking...</span>
          </div>
        </div>
      )}

      {/* Main content */}
      {isMatInstalled && (
        <div className="sam2-content">
          {!selectedClip && (
            <div className="sam2-empty">
              <p>Select a video clip to begin</p>
            </div>
          )}

          {selectedClip && (
            <>
              {/* Step 1: Create Mask */}
              <div className="sam2-section">
                <div className="sam2-section-title">Step 1: Create Mask</div>

                {/* Mode tabs */}
                <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                  <button
                    className={`sam2-btn ${maskMode === 'paint' ? 'active' : ''}`}
                    onClick={() => setMaskMode('paint')}
                    style={{ flex: 1, fontSize: 11 }}
                  >
                    Paint (no download)
                  </button>
                  <button
                    className={`sam2-btn ${maskMode === 'sam2' ? 'active' : ''}`}
                    onClick={() => setMaskMode('sam2')}
                    style={{ flex: 1, fontSize: 11 }}
                  >
                    SAM2 (auto)
                  </button>
                </div>

                {maskMode === 'paint' ? (
                  <>
                    <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      Paint roughly over the subject. MatAnyone2 will refine the edges.
                    </p>

                    <div className="sam2-actions">
                      <button
                        className={`sam2-btn ${isPainting ? 'active' : ''}`}
                        onClick={handlePaintToggle}
                        style={{ flex: 1 }}
                      >
                        {isPainting ? 'Stop Painting' : 'Start Painting'}
                      </button>
                      {hasPaintedMask && (
                        <button className="sam2-btn danger" onClick={handleClearPaint} style={{ flex: 'none' }}>
                          Clear
                        </button>
                      )}
                    </div>

                    {isPainting && (
                      <div style={{ marginTop: 6 }}>
                        <div className="sam2-slider-row">
                          <span className="sam2-slider-label">Brush</span>
                          <input
                            type="range" min={5} max={150} step={1}
                            value={brushSize}
                            onChange={e => {
                              setBrushSize(parseInt(e.target.value));
                              // Re-add overlay with new brush size
                              document.getElementById('mask-paint-overlay')?.remove();
                              setTimeout(() => addPaintOverlay(), 10);
                            }}
                          />
                          <span className="sam2-slider-value">{brushSize}px</span>
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={isEraser}
                            onChange={e => {
                              setIsEraser(e.target.checked);
                              document.getElementById('mask-paint-overlay')?.remove();
                              setTimeout(() => addPaintOverlay(), 10);
                            }}
                          />
                          Eraser mode
                        </label>
                      </div>
                    )}

                    {hasPaintedMask && !isPainting && (
                      <span style={{ fontSize: 11, color: 'var(--success)', marginTop: 4, display: 'block' }}>
                        Mask ready
                      </span>
                    )}
                  </>
                ) : (
                  /* SAM2 mode */
                  <>
                    {sam2Status === 'ready' ? (
                      <>
                        <div className="sam2-actions">
                          <button
                            className={`sam2-btn ${sam2Active ? 'active' : ''}`}
                            onClick={handleSam2Toggle}
                          >
                            {sam2Active ? 'Active' : 'Activate'}
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
                              {sam2Points.length} point{sam2Points.length !== 1 ? 's' : ''}
                            </span>
                            <button className="sam2-btn danger" onClick={handleClearMask} style={{ flex: 'none', padding: '2px 8px', fontSize: 11 }}>
                              Clear
                            </button>
                          </div>
                        )}

                        {liveMask && (
                          <div className="sam2-slider-row" style={{ marginTop: 4 }}>
                            <span className="sam2-slider-label">Opacity</span>
                            <input
                              type="range" min={0} max={1} step={0.05}
                              value={maskOpacity}
                              onChange={e => useSAM2Store.getState().setMaskOpacity(parseFloat(e.target.value))}
                            />
                            <span className="sam2-slider-value">{Math.round(maskOpacity * 100)}%</span>
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
                      <>
                        <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          Click to place points on the subject. More precise than paint but requires model download.
                        </p>
                        <button className="sam2-btn" onClick={handleSam2Download} style={{ fontSize: 11 }}>
                          Download SAM2 Model (~103 MB)
                        </button>
                      </>
                    )}
                  </>
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
                      Server not running{matGpu && <> &mdash; {matGpu}</>}
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
                        padding: '6px 8px', marginTop: 4,
                        background: 'rgba(231, 76, 60, 0.1)',
                        border: '1px solid var(--danger)',
                        borderRadius: 4, fontSize: 11, color: 'var(--danger)',
                      }}>
                        {matError}
                      </div>
                    )}

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

      {showSetup && <MatAnyoneSetupDialog onClose={() => setShowSetup(false)} />}
    </div>
  );
}
