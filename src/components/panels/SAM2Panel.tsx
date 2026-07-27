// AI Segment Panel — MatAnyone2 video matting with mask creation (Paint or SAM2)
// Workflow: Create mask (paint brush or SAM2) → Run MatAnyone2 → Get alpha matte

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../services/matanyone/MatAnyoneService';
import { useSAM2Store } from '../../stores/sam2Store';
import { getSAM2Service } from '../../services/sam2/SAM2Service';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { requireMediaFileImportResult } from '../../stores/mediaStore/helpers/importResult';
import { renderHostPort } from '../../services/render/renderHostPort';
import { MatAnyoneSetupDialog } from '../common/MatAnyoneSetupDialog';
import {
  buildMatAnyoneProjectFileName,
  createMatAnyoneJobDir,
  getMatAnyoneFramePlan,
  getMatAnyoneSourceDimensions,
  getOrCreateMattingMediaFolder,
  joinNativePath,
  readNativeFileAsFile,
  resolveMatAnyoneVideoPath,
} from './sam2/MatAnyoneFileHelpers';
import {
  createSourceSpaceMaskPng,
  readPaintMask,
} from './sam2/MatAnyoneMaskPreparation';
import { MaskCreationSection, type MaskMode } from './sam2/MaskCreationSection';
import { MatAnyoneRunSection } from './sam2/MatAnyoneRunSection';
import { MatAnyoneOverlays, MatAnyoneStatusBar } from './sam2/MatAnyoneStatusViews';
import type { LayerSourceRect } from '../../types/layers';
import type { ClipTransform } from '../../types/timelineCore';
import './SAM2Panel.css';

type MaskOrigin = {
  clipId: string;
  timelineTime: number;
  transform: ClipTransform;
  sourceRect?: LayerSourceRect;
};

function captureMaskOrigin(clipId: string): MaskOrigin | null {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find(candidate => candidate.id === clipId);
  if (!clip) return null;
  const timelineTime = timeline.playheadPosition;
  return {
    clipId,
    timelineTime,
    transform: structuredClone(timeline.getInterpolatedTransform(clipId, timelineTime - clip.startTime)),
    sourceRect: clip.sourceRect ? structuredClone(clip.sourceRect) : undefined,
  };
}

export function SAM2Panel() {
  const [showSetup, setShowSetup] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskMode>('paint');
  const [isPainting, setIsPainting] = useState(false);
  const [brushSize, setBrushSize] = useState(40);
  const [isEraser, setIsEraser] = useState(false);
  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hasPaintedMask, setHasPaintedMask] = useState(false);
  const [isImportingMatte, setIsImportingMatte] = useState(false);
  const [matImportError, setMatImportError] = useState<string | null>(null);
  const [maskOrigin, setMaskOrigin] = useState<MaskOrigin | null>(null);

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
  const setMatError = useMatAnyoneStore(s => s.setError);

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
  const selectedClipId = selectedClip?.id;

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

  useEffect(() => {
    setMatImportError(null);
    setIsImportingMatte(false);
  }, [matResult?.foregroundPath, matResult?.alphaPath]);

  useEffect(() => {
    paintCanvasRef.current = null;
    setHasPaintedMask(false);
    setMaskOrigin(null);
    setIsPainting(false);
    document.getElementById('mask-paint-overlay')?.remove();
    const sam2 = useSAM2Store.getState();
    sam2.clearPoints();
    sam2.setLiveMask(null);
    sam2.clearFrameMasks();
  }, [selectedClipId]);

  useEffect(() => {
    if (!liveMask || !selectedClipId) return;
    setMaskOrigin(captureMaskOrigin(selectedClipId));
  }, [liveMask, selectedClipId]);

  const isMatReady = matStatus === 'ready';
  const isMatInstalled = matStatus === 'installed' || matStatus === 'model-needed'
    || matStatus === 'ready' || matStatus === 'starting';
  const hasMask = maskMode === 'paint' ? hasPaintedMask : !!liveMask;
  const showSetupOverlay = matStatus === 'not-installed' || matStatus === 'model-needed'
    || matStatus === 'gpu-required' || matStatus === 'error';
  const showHelperOverlay = matStatus === 'not-available';

  // --- Paint mask ---
  const initPaintCanvas = useCallback(async () => {
    try {
      const { width, height } = renderHostPort.getOutputDimensions();

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
      if (selectedClip) {
        setMaskOrigin(current => current ?? captureMaskOrigin(selectedClip.id));
      }
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
  }, [brushSize, isEraser, selectedClip]);

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
    setMaskOrigin(null);
  }, []);

  const refreshPaintOverlay = useCallback((delayMs: number) => {
    document.getElementById('mask-paint-overlay')?.remove();
    setTimeout(() => addPaintOverlay(), delayMs);
  }, [addPaintOverlay]);

  const handleBrushSizeChange = useCallback((value: number) => {
    setBrushSize(value);
    refreshPaintOverlay(10);
  }, [refreshPaintOverlay]);

  const handleEraserChange = useCallback((enabled: boolean) => {
    setIsEraser(enabled);
    refreshPaintOverlay(10);
  }, [refreshPaintOverlay]);

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
      setMaskOrigin(captureMaskOrigin(selectedClip.id));
      const pixels = await renderHostPort.readPixels();
      if (!pixels) return;
      const { width, height } = renderHostPort.getOutputDimensions();
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
    setMaskOrigin(null);
  }, []);

  const handleMaskOpacityChange = useCallback((value: number) => {
    useSAM2Store.getState().setMaskOpacity(value);
  }, []);

  // --- MatAnyone2 handler ---
  const handleRunMatAnyone = useCallback(async () => {
    if (!selectedClip) return;
    const clipSource = selectedClip.source;
    if (!clipSource || clipSource.type !== 'video') {
      setMatError('Selected clip is not a video');
      return;
    }

    if (!maskOrigin || maskOrigin.clipId !== selectedClip.id) {
      setMatError(
        'The mask does not belong to this clip. Create a new mask on the frame where matting should begin.'
      );
      return;
    }

    const videoPath = await resolveMatAnyoneVideoPath(selectedClip);

    if (!videoPath) {
      setMatError(
        'No file path available. Could not locate the original video or stage a temporary helper copy. ' +
        'Try re-importing the file with the Native Helper running.'
      );
      return;
    }

    try {
      const timeline = useTimelineStore.getState();
      if (timeline.clipKeyframes.get(selectedClip.id)?.some(keyframe => keyframe.property === 'speed')) {
        throw new Error('Variable-speed clips must be baked before MatAnyone2 processing.');
      }
      const sourceDimensions = getMatAnyoneSourceDimensions(selectedClip);
      if (!sourceDimensions) {
        throw new Error('The source video dimensions are not available yet. Reload the clip and try again.');
      }

      const framePlan = getMatAnyoneFramePlan(selectedClip, maskOrigin.timelineTime);
      const previewMask = maskMode === 'paint'
        ? (() => {
            const canvas = paintCanvasRef.current;
            if (!canvas) throw new Error('The painted mask is no longer available.');
            return readPaintMask(canvas);
          })()
        : (() => {
            const maskData = useSAM2Store.getState().liveMask;
            if (!maskData) throw new Error('The SAM2 mask is no longer available.');
            return {
              width: maskData.width,
              height: maskData.height,
              values: maskData.maskData,
            };
          })();

      const maskBlob = await createSourceSpaceMaskPng(previewMask, {
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
        outputWidth: previewMask.width,
        outputHeight: previewMask.height,
        transform: maskOrigin.transform,
        sourceRect: maskOrigin.sourceRect,
      });

      const { NativeHelperClient } = await import('../../services/nativeHelper/NativeHelperClient');
      const jobDir = await createMatAnyoneJobDir(NativeHelperClient, selectedClip.id);
      if (!jobDir) {
        setMatError('Could not create a MatAnyone2 output folder.');
        return;
      }

      const maskPath = joinNativePath(jobDir, 'mask.png');
      const maskWritten = await NativeHelperClient.writeFileBinary(maskPath, maskBlob);
      if (!maskWritten) {
        setMatError('Could not write MatAnyone2 mask image for the native helper.');
        return;
      }

      const maskFile = await NativeHelperClient.exists(maskPath);
      if (!maskFile.exists || maskFile.kind !== 'file') {
        setMatError('MatAnyone2 mask image was not written to disk.');
        return;
      }

      await getMatAnyoneService().matte({
        videoPath,
        maskPath,
        outputDir: jobDir,
        ...framePlan,
        sourceClipId: selectedClip.id,
      });
    } catch (e) {
      console.error('MatAnyone2 matting failed:', e);
      setMatError(
        `MatAnyone2 matting failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }, [selectedClip, maskMode, maskOrigin, setMatError]);

  const handleImportMattingResult = useCallback(async () => {
    if (!matResult || isImportingMatte) return;

    setIsImportingMatte(true);
    setMatImportError(null);

    try {
      const { NativeHelperClient } = await import('../../services/nativeHelper/NativeHelperClient');
      const folderId = getOrCreateMattingMediaFolder();

      const foregroundFile = await readNativeFileAsFile(NativeHelperClient, matResult.foregroundPath);
      const foregroundMedia = requireMediaFileImportResult(
        await useMediaStore.getState().importFile(foregroundFile, folderId, {
          forceCopyToProject: true,
          projectFileName: buildMatAnyoneProjectFileName(matResult, matResult.foregroundPath),
        }),
        'MatAnyone foreground import',
      );
      useMediaStore.getState().moveToFolder([foregroundMedia.id], folderId);

      if (!foregroundMedia.file) {
        throw new Error(`Imported media is not ready: ${foregroundMedia.name}`);
      }

      const timelineBefore = useTimelineStore.getState();
      const sourceClip = timelineBefore.clips.find(clip => clip.id === matResult.sourceClipId) ?? selectedClip;
      if (!sourceClip) {
        throw new Error('Source clip is no longer available.');
      }

      const targetTrackId = timelineBefore.addTrack('video');
      const beforeClipIds = new Set(useTimelineStore.getState().clips.map(clip => clip.id));
      const timelineStartTime = matResult.timelineStartTime ?? sourceClip.startTime;
      const sourceDuration = matResult.sourceDuration ?? sourceClip.duration;
      const timelineDuration = matResult.timelineDuration ?? sourceClip.duration;
      await useTimelineStore.getState().addClip(
        targetTrackId,
        foregroundMedia.file,
        timelineStartTime,
        sourceDuration,
        foregroundMedia.id,
      );

      const timelineAfterAdd = useTimelineStore.getState();
      const addedVideoClip = timelineAfterAdd.clips.find(clip =>
        !beforeClipIds.has(clip.id) &&
        clip.source?.type === 'video' &&
        clip.source.mediaFileId === foregroundMedia.id
      );

      if (addedVideoClip) {
        const timeline = useTimelineStore.getState();
        timeline.updateClipTransform(addedVideoClip.id, structuredClone(sourceClip.transform));

        const latestClip = useTimelineStore.getState().clips.find(clip => clip.id === addedVideoClip.id);
        const matteDuration = Math.max(0.01, Math.min(
          sourceDuration,
          latestClip?.source?.naturalDuration ?? latestClip?.duration ?? sourceDuration,
        ));
        timeline.trimClip(addedVideoClip.id, 0, matteDuration);

        if (latestClip?.linkedClipId) {
          useTimelineStore.getState().removeClip(latestClip.linkedClipId);
        }

        useTimelineStore.getState().updateClip(addedVideoClip.id, {
          name: `Matte - ${sourceClip.name}`,
          duration: timelineDuration,
          speed: matResult.sourceSpeed ?? sourceClip.speed,
          sourceRect: sourceClip.sourceRect ? structuredClone(sourceClip.sourceRect) : undefined,
        });
        useTimelineStore.getState().selectClip(addedVideoClip.id);
      }

      console.info('Imported MatAnyone2 result', {
        foregroundMediaId: foregroundMedia.id,
        alphaSidecarPath: matResult.alphaPath,
        folderId,
      });
    } catch (e) {
      console.error('Importing MatAnyone2 result failed:', e);
      setMatImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsImportingMatte(false);
    }
  }, [isImportingMatte, matResult, selectedClip]);

  const handleStartServer = useCallback(() => {
    getMatAnyoneService().startServer().catch(() => {});
  }, []);

  const handleCancelJob = useCallback(() => {
    getMatAnyoneService().cancelJob();
  }, []);

  const handleRetryConnection = useCallback(() => {
    getMatAnyoneService().checkStatus().catch(() => {});
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
      <MatAnyoneOverlays
        matStatus={matStatus}
        matError={matError}
        showHelperOverlay={showHelperOverlay}
        showSetupOverlay={showSetupOverlay}
        onOpenSetup={() => setShowSetup(true)}
        onRetryConnection={handleRetryConnection}
      />

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
              <MaskCreationSection
                maskMode={maskMode}
                setMaskMode={setMaskMode}
                isPainting={isPainting}
                brushSize={brushSize}
                isEraser={isEraser}
                hasPaintedMask={hasPaintedMask}
                sam2Status={sam2Status}
                sam2Active={sam2Active}
                sam2Processing={sam2Processing}
                sam2PointCount={sam2Points.length}
                hasLiveMask={!!liveMask}
                maskOpacity={maskOpacity}
                sam2DownloadProgress={sam2DownloadProgress}
                onPaintToggle={handlePaintToggle}
                onClearPaint={handleClearPaint}
                onBrushSizeChange={handleBrushSizeChange}
                onEraserChange={handleEraserChange}
                onSam2Toggle={handleSam2Toggle}
                onSam2AutoDetect={handleSam2AutoDetect}
                onSam2Download={handleSam2Download}
                onClearMask={handleClearMask}
                onMaskOpacityChange={handleMaskOpacityChange}
              />

              <MatAnyoneRunSection
                isMatReady={isMatReady}
                isMatStarting={matStatus === 'starting'}
                matGpu={matGpu}
                matCuda={matCuda}
                matProcessing={matProcessing}
                matProgress={matProgress}
                matCurrentFrame={matCurrentFrame}
                matTotalFrames={matTotalFrames}
                matError={matError}
                matResult={matResult}
                hasMask={hasMask}
                isImportingMatte={isImportingMatte}
                matImportError={matImportError}
                onStartServer={handleStartServer}
                onRunMatAnyone={handleRunMatAnyone}
                onCancelJob={handleCancelJob}
                onImportMattingResult={handleImportMattingResult}
              />
            </>
          )}
        </div>
      )}

      <MatAnyoneStatusBar
        matStatus={matStatus}
        isMatReady={isMatReady}
        isMatInstalled={isMatInstalled}
        matProcessing={matProcessing}
      />

      {showSetup && <MatAnyoneSetupDialog onClose={() => setShowSetup(false)} />}
    </div>
  );
}
