// Source Monitor - previews raw media files before timeline placement.

import './SourceMonitor.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  getAudioWaveformStatus,
  getSourceWaveformChannels,
  drawSourceAudioWaveformCanvas,
} from './sourceAudioWaveform';
import {
  clearTimelinePlacementCommandPreview,
  runTimelinePlacementCommand,
} from '../../services/timelinePlacementCommands';
import { useMediaStore, type MediaFile } from '../../stores/mediaStore';
import { startMediaFileWaveformGeneration } from '../../stores/mediaStore/helpers/mediaWaveformHelpers';
import type { TimelinePlacementMode } from '../../stores/timeline/editOperations/types';
import { SourceMonitorImageCrop } from './sourceMonitor/SourceMonitorImageCrop';
import { useAnnotationStore } from '../../stores/annotationStore';
import {
  SourceMonitorTransportControls,
  type SourceTimelineDragKind,
} from './sourceMonitor/SourceMonitorTransportControls';
import { useSourceMonitorImageCrop } from './sourceMonitor/useSourceMonitorImageCrop';
import { useSourceMonitorKeyboard } from './sourceMonitor/useSourceMonitorKeyboard';
import { useSourceMonitorTransport } from './sourceMonitor/useSourceMonitorTransport';
import {
  clampTime,
  createTimelineTicks,
  MIN_MARK_GAP_SECONDS,
} from './sourceMonitor/sourceMonitorTimecode';
import { flags } from '../../engine/featureFlags';
import { selectRuntimeFrameProviderPlan } from '../../services/mediaRuntime/providerSelection';
import { TurboResSourceMonitorCanvas } from './sourceMonitor/TurboResSourceMonitorCanvas';
import { usePreviewTransportPortal } from './PreviewTransportPortalContext';

const SOURCE_MONITOR_MAX_ZOOM = 128;
const IMAGE_SOURCE_MONITOR_ZOOM_STEP = 0.001;

interface SourceMonitorProps {
  file: MediaFile;
  autoplayRequestId?: number;
  onClose: () => void;
}

interface SourceViewportState {
  fileId: string;
  panX: number;
  panY: number;
  zoom: number;
}

function getNextSourceZoom(current: number, deltaY: number): number {
  return Math.max(1, Math.min(SOURCE_MONITOR_MAX_ZOOM, current * Math.exp(-deltaY * IMAGE_SOURCE_MONITOR_ZOOM_STEP)));
}

function getDefaultSourceViewport(fileId: string): SourceViewportState {
  return { fileId, panX: 0, panY: 0, zoom: 1 };
}

function updateMediaFileWaveformCache(
  id: string,
  updates: Partial<Pick<MediaFile, 'audioAnalysisRefs' | 'waveform' | 'waveformChannels' | 'waveformProgress' | 'waveformStatus'>>,
): void {
  useMediaStore.setState((state) => ({
    files: state.files.map((entry) => (
      entry.id === id
        ? { ...entry, ...updates }
        : entry
    )),
  }));
}

export function SourceMonitor({ file, autoplayRequestId = 0, onClose }: SourceMonitorProps) {
  const {
    externalSourceControls,
    sourceControlsTarget,
  } = usePreviewTransportPortal();
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioWaveformRef = useRef<HTMLDivElement>(null);
  const audioWaveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourcePanDragRef = useRef<{
    fileId: string;
    startPanX: number;
    startPanY: number;
    startX: number;
    startY: number;
    zoom: number;
  } | null>(null);

  const isVideo = file.type === 'video';
  const isAudio = file.type === 'audio';
  const isImage = file.type === 'image';
  const isPlayable = isVideo || isAudio;
  const sourceProviderPlan = selectRuntimeFrameProviderPlan({
    videoCodecId: file.videoCodecId,
    turboResEnabled: flags.turboResProRes,
  });
  const turboResFourCC = sourceProviderPlan.backend === 'turbores' || sourceProviderPlan.backend === 'hap'
    ? sourceProviderPlan.fourCC
    : null;
  const useTurboResVideo = isVideo && turboResFourCC !== null && file.file instanceof File;
  const fps = file.fps || 30;

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [sourceViewportState, setSourceViewportState] = useState(() => getDefaultSourceViewport(file.id));
  const [pendingPlacementMode, setPendingPlacementMode] = useState<TimelinePlacementMode | null>(null);
  const inPoint = useMediaStore(state => state.sourceMonitorInPoint);
  const outPoint = useMediaStore(state => state.sourceMonitorOutPoint);
  const setSourceMonitorInPoint = useMediaStore(state => state.setSourceMonitorInPoint);
  const setSourceMonitorOutPoint = useMediaStore(state => state.setSourceMonitorOutPoint);
  const clearSourceMonitorInOut = useMediaStore(state => state.clearSourceMonitorInOut);
  const sourceSeekRequest = useAnnotationStore(state => state.sourceSeekRequest);
  const reportSourcePlayback = useAnnotationStore(state => state.reportSourcePlayback);
  const clearSourcePlayback = useAnnotationStore(state => state.clearSourcePlayback);
  const {
    currentTime,
    currentTimeRef,
    isPlaying,
    mediaRef,
    pauseSource,
    playSource,
    seekSourceMonitor,
    setCurrentTime,
    setIsPlaying,
    stopSource,
    timelineDuration,
    togglePlayback,
    turboResMonitorRef,
  } = useSourceMonitorTransport({
    autoplayRequestId,
    file,
    inPoint,
    isImage,
    isPlayable,
    isScrubbing,
    outPoint,
    useTurboResVideo,
  });
  const imageCrop = useSourceMonitorImageCrop(file, isImage);
  const sourceViewport = sourceViewportState.fileId === file.id
    ? sourceViewportState
    : getDefaultSourceViewport(file.id);
  const sourceViewportStyle = { transform: `translate(${sourceViewport.panX}px, ${sourceViewport.panY}px) scale(${sourceViewport.zoom})` };
  const effectiveInPoint = clampTime(inPoint ?? 0, timelineDuration);
  const effectiveOutPoint = clampTime(outPoint ?? timelineDuration, timelineDuration);
  const hasMarkedRange = timelineDuration > 0 && (inPoint !== null || outPoint !== null) && effectiveOutPoint > effectiveInPoint;
  const progress = timelineDuration > 0 ? (clampTime(currentTime, timelineDuration) / timelineDuration) * 100 : 0;
  const rangeLeft = timelineDuration > 0 ? (effectiveInPoint / timelineDuration) * 100 : 0;
  const rangeRight = timelineDuration > 0 ? (effectiveOutPoint / timelineDuration) * 100 : 100;
  const rangeWidth = Math.max(0, rangeRight - rangeLeft);
  const markedDuration = timelineDuration > 0
    ? Math.max(0, effectiveOutPoint - effectiveInPoint)
    : 0;
  const showSourceTimingControls = !isImage && timelineDuration > 0;
  const timelineTicks = useMemo(() => createTimelineTicks(timelineDuration, fps), [fps, timelineDuration]);
  useEffect(() => {
    reportSourcePlayback({
      fileId: file.id,
      time: currentTime,
      duration: timelineDuration,
      fps,
    });
  }, [currentTime, file.id, fps, reportSourcePlayback, timelineDuration]);

  useEffect(() => () => clearSourcePlayback(file.id), [clearSourcePlayback, file.id]);

  useEffect(() => {
    if (!sourceSeekRequest || sourceSeekRequest.fileId !== file.id) return;
    seekSourceMonitor(sourceSeekRequest.time);
  }, [file.id, seekSourceMonitor, sourceSeekRequest]);
  const audioWaveformStatus = useMemo(
    () => getAudioWaveformStatus(file, isAudio),
    [file, isAudio],
  );
  const audioWaveformChannels = useMemo(
    () => getSourceWaveformChannels(file),
    [file],
  );

  useEffect(() => {
    if (!isAudio || (file.waveform?.length ?? 0) > 0) return;
    startMediaFileWaveformGeneration(
      file,
      updateMediaFileWaveformCache,
      (id) => useMediaStore.getState().files.find((entry) => entry.id === id),
    );
  }, [file, isAudio]);

  useEffect(() => {
    if (!isAudio) return undefined;

    const canvas = audioWaveformCanvasRef.current;
    const container = audioWaveformRef.current;
    if (!canvas || !container) return undefined;

    let frameId = 0;
    let debounceTimer = 0;
    const render = () => {
      frameId = 0;
      drawSourceAudioWaveformCanvas(canvas, audioWaveformChannels, audioWaveformStatus);
    };
    const scheduleRender = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (typeof window.requestAnimationFrame === 'function') {
        frameId = window.requestAnimationFrame(render);
      } else {
        render();
      }
    };
    // Resize fires every frame of a view-switch animation; debounce so the
    // expensive waveform repaints once after the transition settles instead of
    // stuttering through it (the canvas just stretches smoothly meanwhile).
    const scheduleDebouncedRender = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(scheduleRender, 140);
    };

    scheduleRender();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(scheduleDebouncedRender);
      observer.observe(container);
      return () => {
        if (frameId) window.cancelAnimationFrame(frameId);
        if (debounceTimer) window.clearTimeout(debounceTimer);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleDebouncedRender);
    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      if (debounceTimer) window.clearTimeout(debounceTimer);
      window.removeEventListener('resize', scheduleDebouncedRender);
    };
  }, [audioWaveformChannels, audioWaveformStatus, isAudio]);

  const {
    handlePointerEnter,
    handlePointerLeave,
    rootRef,
  } = useSourceMonitorKeyboard({
    isPlayable,
    onClose,
    togglePlayback,
  });

  const getTimeFromElementClientX = useCallback((element: HTMLElement | null, clientX: number) => {
    if (!element || timelineDuration <= 0) return 0;
    const rect = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return fraction * timelineDuration;
  }, [timelineDuration]);

  const updateTimelineDrag = useCallback((kind: SourceTimelineDragKind, clientX: number) => {
    const time = getTimeFromElementClientX(timelineRef.current, clientX);
    if (kind === 'in') {
      setSourceMonitorInPoint(Math.min(time, Math.max(0, effectiveOutPoint - MIN_MARK_GAP_SECONDS)));
      return;
    }
    if (kind === 'out') {
      setSourceMonitorOutPoint(Math.max(time, effectiveInPoint + MIN_MARK_GAP_SECONDS));
      return;
    }
    seekSourceMonitor(time);
  }, [
    effectiveInPoint,
    effectiveOutPoint,
    getTimeFromElementClientX,
    seekSourceMonitor,
    setSourceMonitorInPoint,
    setSourceMonitorOutPoint,
  ]);

  const startAudioWaveformDrag = useCallback((event: ReactPointerEvent) => {
    if (timelineDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setIsScrubbing(true);
    seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, event.clientX));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, moveEvent.clientX));
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      seekSourceMonitor(getTimeFromElementClientX(audioWaveformRef.current, upEvent.clientX));
      setIsScrubbing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [getTimeFromElementClientX, seekSourceMonitor, timelineDuration]);

  const startTimelineDrag = useCallback((kind: SourceTimelineDragKind, event: ReactPointerEvent) => {
    if (timelineDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setIsScrubbing(kind === 'playhead');
    updateTimelineDrag(kind, event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateTimelineDrag(kind, moveEvent.clientX);
    };
    const handlePointerUp = (upEvent: PointerEvent) => {
      updateTimelineDrag(kind, upEvent.clientX);
      setIsScrubbing(false);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [timelineDuration, updateTimelineDrag]);

  const runSourcePlacementCommand = useCallback((mode: TimelinePlacementMode) => {
    if (pendingPlacementMode !== null) return;
    clearTimelinePlacementCommandPreview(mode);
    setPendingPlacementMode(mode);
    void runTimelinePlacementCommand(mode).finally(() => {
      setPendingPlacementMode(null);
    });
  }, [pendingPlacementMode]);

  const handleSourceWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isVideo && (!isImage || imageCrop.cropMode)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left - rect.width / 2;
    const mouseY = event.clientY - rect.top - rect.height / 2;
    setSourceViewportState((current) => {
      const base = current.fileId === file.id ? current : getDefaultSourceViewport(file.id);
      const zoom = getNextSourceZoom(base.zoom, event.deltaY);
      if (zoom === 1) return getDefaultSourceViewport(file.id);
      const scale = zoom / base.zoom;
      return {
        fileId: file.id,
        panX: mouseX - scale * (mouseX - base.panX),
        panY: mouseY - scale * (mouseY - base.panY),
        zoom,
      };
    });
  }, [file.id, imageCrop.cropMode, isImage, isVideo]);

  const startSourcePan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((!isVideo && (!isImage || imageCrop.cropMode)) || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    sourcePanDragRef.current = {
      fileId: file.id,
      startPanX: sourceViewport.panX,
      startPanY: sourceViewport.panY,
      startX: event.clientX,
      startY: event.clientY,
      zoom: sourceViewport.zoom,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const drag = sourcePanDragRef.current;
      if (!drag) return;
      setSourceViewportState({
        fileId: drag.fileId,
        panX: drag.startPanX + moveEvent.clientX - drag.startX,
        panY: drag.startPanY + moveEvent.clientY - drag.startY,
        zoom: drag.zoom,
      });
    };
    const handlePointerUp = () => {
      sourcePanDragRef.current = null;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  }, [file.id, imageCrop.cropMode, isImage, isVideo, sourceViewport.panX, sourceViewport.panY, sourceViewport.zoom]);

  const transportControls = (
    <SourceMonitorTransportControls
      clearInOut={clearSourceMonitorInOut}
      cropMode={imageCrop.cropMode}
      currentTime={currentTime}
      external={externalSourceControls}
      fps={fps}
      hasMarkedRange={hasMarkedRange}
      inPoint={inPoint}
      isImage={isImage}
      isPlayable={isPlayable}
      isPlaying={isPlaying}
      markedDuration={markedDuration}
      onPause={pauseSource}
      onPlay={playSource}
      onRunPlacementCommand={runSourcePlacementCommand}
      onSetInPoint={setSourceMonitorInPoint}
      onSetOutPoint={setSourceMonitorOutPoint}
      onStartTimelineDrag={startTimelineDrag}
      onStop={stopSource}
      onToggleCrop={imageCrop.toggleImageCrop}
      outPoint={outPoint}
      pendingPlacementMode={pendingPlacementMode}
      progress={progress}
      rangeLeft={rangeLeft}
      rangeRight={rangeRight}
      rangeWidth={rangeWidth}
      showTimingControls={showSourceTimingControls}
      timelineDuration={timelineDuration}
      timelineRef={timelineRef}
      timelineTicks={timelineTicks}
    />
  );

  return (
    <div
      ref={rootRef}
      className={`source-monitor${externalSourceControls ? ' source-monitor-external-controls' : ''}`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        className="source-monitor-media"
        onWheel={handleSourceWheel}
        onPointerDown={startSourcePan}
        onAuxClick={(event) => {
          if ((isImage || isVideo) && event.button === 1) event.preventDefault();
        }}
      >
        {isVideo ? (
          useTurboResVideo ? (
            <TurboResSourceMonitorCanvas
              key={file.id}
              ref={turboResMonitorRef}
              file={file}
              sourceFile={file.file!}
              fourCC={turboResFourCC!}
              style={sourceViewportStyle}
              onTimeChange={(time) => {
                currentTimeRef.current = time;
                setCurrentTime(time);
              }}
              onPlayingChange={setIsPlaying}
              onTogglePlayback={togglePlayback}
            />
          ) : (
            <video
              ref={(node) => { mediaRef.current = node; }}
              src={file.url}
              className="source-monitor-video"
              style={sourceViewportStyle}
              onClick={togglePlayback}
              autoPlay
              playsInline
            />
          )
        ) : isAudio ? (
          <>
            <audio
              ref={(node) => { mediaRef.current = node; }}
              src={file.url}
              className="source-monitor-audio-element"
              preload="metadata"
              aria-label="Audio source player"
            />
            <div className="source-monitor-audio-editor">
              <div
                ref={audioWaveformRef}
                className={`source-monitor-audio-waveform status-${audioWaveformStatus}`}
                aria-label="Audio waveform"
                onPointerDown={startAudioWaveformDrag}
              >
                <canvas
                  ref={audioWaveformCanvasRef}
                  className="source-monitor-audio-waveform-canvas"
                  aria-hidden="true"
                />
                <div className="source-monitor-audio-db-grid" aria-hidden="true">
                  <span style={{ top: '12.5%' }} />
                  <span style={{ top: '25%' }} />
                  <span style={{ top: '37.5%' }} />
                  <span style={{ top: '62.5%' }} />
                  <span style={{ top: '75%' }} />
                  <span style={{ top: '87.5%' }} />
                </div>
                <div
                  className="source-monitor-audio-waveform-range"
                  style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }}
                />
                <div className="source-monitor-audio-waveform-playhead" style={{ left: `${progress}%` }} />
                {(['L', 'R'] as const).map((channel) => (
                  <div className="source-monitor-audio-channel" key={channel}>
                    <span className="source-monitor-audio-channel-label">{channel}</span>
                  </div>
                ))}
                <div className="source-monitor-audio-file-name" title={file.name}>
                  {file.name}
                </div>
              </div>
            </div>
          </>
        ) : isImage && imageCrop.cropMode ? (
          <SourceMonitorImageCrop
            key={file.id}
            file={file}
            busy={imageCrop.cropBusy}
            error={imageCrop.cropError}
            onApply={imageCrop.applyImageCrop}
            onCancel={imageCrop.cancelImageCrop}
          />
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className="source-monitor-image"
            style={sourceViewportStyle}
          />
        )}

      </div>

      {externalSourceControls
        ? sourceControlsTarget && createPortal(transportControls, sourceControlsTarget)
        : transportControls}
    </div>
  );
}
