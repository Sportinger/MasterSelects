import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import type { FlashBoardNode as FlashBoardNodeType } from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';
import { getFlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import { clampNodeWidth, resolveFlashBoardNodeDisplaySize } from './nodeSizing';

interface FlashBoardNodeProps {
  node: FlashBoardNodeType;
  isSelected: boolean;
  isOverlapOutlined?: boolean;
  zoom: number;
  onContextMenu: (e: React.MouseEvent, nodeId: string) => void;
}

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface ResizeHandleGeometry {
  anchorX: number;
  anchorY: number;
  handleX: number;
  handleY: number;
}

interface ResizeSession {
  direction: ResizeDirection;
  anchorWorldX: number;
  anchorWorldY: number;
  anchorX: number;
  anchorY: number;
  aspectRatio: number;
  projectorX: number;
  projectorY: number;
  projectorDenominator: number;
  widthOffset: number;
  canvasLeft: number;
  canvasTop: number;
  panX: number;
  panY: number;
  zoom: number;
}

const RESIZE_HANDLES: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const RESIZE_HANDLE_GEOMETRY: Record<ResizeDirection, ResizeHandleGeometry> = {
  n: { anchorX: 0.5, anchorY: 1, handleX: 0.5, handleY: 0 },
  ne: { anchorX: 0, anchorY: 1, handleX: 1, handleY: 0 },
  e: { anchorX: 0, anchorY: 0.5, handleX: 1, handleY: 0.5 },
  se: { anchorX: 0, anchorY: 0, handleX: 1, handleY: 1 },
  s: { anchorX: 0.5, anchorY: 0, handleX: 0.5, handleY: 1 },
  sw: { anchorX: 1, anchorY: 0, handleX: 0, handleY: 1 },
  w: { anchorX: 1, anchorY: 0.5, handleX: 0, handleY: 0.5 },
  nw: { anchorX: 1, anchorY: 1, handleX: 0, handleY: 0 },
};

function formatPreviewTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function FlashBoardNode({
  node,
  isSelected,
  isOverlapOutlined = false,
  zoom,
  onContextMenu,
}: FlashBoardNodeProps) {
  const activeBoard = useFlashBoardStore(selectActiveBoard);
  const moveNode = useFlashBoardStore((s) => s.moveNode);
  const resizeNode = useFlashBoardStore((s) => s.resizeNode);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);
  const openComposer = useFlashBoardStore((s) => s.openComposer);

  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const resizeRef = useRef<ResizeSession | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [videoPreviewState, setVideoPreviewState] = useState(() => ({
    mediaId: node.result?.mediaFileId ?? null,
    currentTime: 0,
    duration: node.result?.duration ?? 0,
    isPlaying: false,
  }));

  const status = node.job?.status ?? (node.kind === 'reference' ? 'completed' : 'draft');
  const prompt = node.request?.prompt;
  const provider = node.request?.providerId;
  const durationLabel = node.request?.duration ? `${node.request.duration}s` : null;
  const modeLabel = node.request?.mode ? node.request.mode.toUpperCase() : null;
  const resolutionLabel = node.request?.imageSize ?? null;
  const aspectRatioLabel = node.request?.aspectRatio ?? null;
  const soundLabel = node.request?.generateAudio ? 'Sound' : null;
  const multiShotLabel = node.request?.multiShots ? 'Multi-shot' : null;
  const startReferenceLabel = node.request?.startMediaFileId ? 'Start ref' : null;
  const endReferenceLabel = node.request?.endMediaFileId ? 'End ref' : null;
  const referenceFrameLabel = node.request?.referenceMediaFileIds?.length ? 'Reference frame' : null;
  const priceLabel = node.request
    ? getFlashBoardPriceEstimate({
      service: node.request.service,
      providerId: node.request.providerId,
      outputType: node.request.outputType,
      mode: node.request.mode,
      duration: node.request.duration,
      imageSize: node.request.imageSize,
      generateAudio: node.request.generateAudio,
      multiShots: node.request.multiShots,
    })?.compactLabel ?? null
    : null;
  const detailTokens = [
    modeLabel,
    durationLabel,
    resolutionLabel,
    aspectRatioLabel,
    soundLabel,
    multiShotLabel,
    startReferenceLabel,
    endReferenceLabel,
    referenceFrameLabel,
    priceLabel,
  ].filter(Boolean) as string[];
  const isActive = status === 'queued' || status === 'processing';
  const startedAt = node.job?.startedAt;
  const elapsedMs = startedAt ? Math.max(0, now - startedAt) : 0;
  const elapsedLabel = elapsedMs >= 60_000
    ? `${Math.floor(elapsedMs / 60_000)}m ${Math.floor((elapsedMs % 60_000) / 1000)}s`
    : `${Math.floor(elapsedMs / 1000)}s`;
  const statusLabel =
    status === 'queued'
      ? 'Queued'
      : status === 'processing'
        ? 'Generating'
        : status === 'completed'
          ? 'Done'
          : status === 'failed'
            ? 'Failed'
            : status === 'canceled'
              ? 'Canceled'
              : 'Draft';

  useEffect(() => {
    if (!isActive || !startedAt) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isActive, startedAt]);

  // Get thumbnail for reference/completed nodes
  const mediaFileId = node.result?.mediaFileId;
  const mediaFile = useMediaStore((s) => {
    if (!mediaFileId) return undefined;
    return s.files.find((f) => f.id === mediaFileId);
  });
  const mediaType = mediaFile?.type ?? node.result?.mediaType;
  const isVideoPreview = mediaType === 'video' && Boolean(mediaFile?.url);
  const videoUrl = isVideoPreview ? mediaFile?.url : undefined;
  const thumbnailUrl = !isVideoPreview ? (mediaFile?.thumbnailUrl || mediaFile?.url) : mediaFile?.thumbnailUrl;
  const mediaName = mediaFile?.name;
  const isReference = node.kind === 'reference';
  const hasPreview = Boolean(videoUrl || thumbnailUrl);
  const previewTitle = isReference ? mediaName || 'Reference asset' : prompt || 'No prompt yet';
  const showMeta = Boolean(provider || detailTokens.length > 0 || startedAt || status === 'failed');
  const { aspectRatio: lockedAspectRatio, width: displayWidth, height: displayHeight } =
    resolveFlashBoardNodeDisplaySize(node, mediaFile);
  const panX = activeBoard?.viewport.panX ?? 0;
  const panY = activeBoard?.viewport.panY ?? 0;
  const videoStateMatchesMedia = videoPreviewState.mediaId === mediaFileId;
  const resolvedVideoCurrentTime = videoStateMatchesMedia ? videoPreviewState.currentTime : 0;
  const resolvedVideoDuration = videoStateMatchesMedia
    ? videoPreviewState.duration
    : (mediaFile?.duration ?? node.result?.duration ?? 0);
  const resolvedIsVideoPlaying = videoStateMatchesMedia ? videoPreviewState.isPlaying : false;

  const getBoardPointer = useCallback((clientX: number, clientY: number, canvasLeft: number, canvasTop: number) => ({
    x: (clientX - canvasLeft - panX) / zoom,
    y: (clientY - canvasTop - panY) / zoom,
  }), [panX, panY, zoom]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideoPreview) {
      return;
    }

    const handleTimeUpdate = () => {
      setVideoPreviewState((prev) => ({
        mediaId: mediaFileId ?? null,
        currentTime: video.currentTime,
        duration: prev.mediaId === mediaFileId ? prev.duration : (mediaFile?.duration ?? node.result?.duration ?? 0),
        isPlaying: prev.mediaId === mediaFileId ? prev.isPlaying : !video.paused,
      }));
    };
    const handleLoadedMetadata = () => {
      setVideoPreviewState((prev) => ({
        mediaId: mediaFileId ?? null,
        currentTime: prev.mediaId === mediaFileId ? prev.currentTime : 0,
        duration: video.duration || mediaFile?.duration || node.result?.duration || 0,
        isPlaying: prev.mediaId === mediaFileId ? prev.isPlaying : !video.paused,
      }));
    };
    const handlePlay = () => {
      setVideoPreviewState((prev) => ({
        mediaId: mediaFileId ?? null,
        currentTime: prev.mediaId === mediaFileId ? prev.currentTime : video.currentTime,
        duration: prev.mediaId === mediaFileId ? prev.duration : (video.duration || mediaFile?.duration || node.result?.duration || 0),
        isPlaying: true,
      }));
    };
    const handlePause = () => {
      setVideoPreviewState((prev) => ({
        mediaId: mediaFileId ?? null,
        currentTime: prev.mediaId === mediaFileId ? prev.currentTime : video.currentTime,
        duration: prev.mediaId === mediaFileId ? prev.duration : (video.duration || mediaFile?.duration || node.result?.duration || 0),
        isPlaying: false,
      }));
    };
    const handleEnded = () => {
      setVideoPreviewState({
        mediaId: mediaFileId ?? null,
        currentTime: video.duration || 0,
        duration: video.duration || mediaFile?.duration || node.result?.duration || 0,
        isPlaying: false,
      });
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
      video.pause();
    };
  }, [isVideoPreview, mediaFile?.duration, mediaFileId, node.result?.duration, videoUrl]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    setSelectedNodes([node.id]);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      nodeX: node.position.x,
      nodeY: node.position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (ev.clientX - dragRef.current.startX) / zoom;
      const dy = (ev.clientY - dragRef.current.startY) / zoom;
      moveNode(node.id, {
        x: dragRef.current.nodeX + dx,
        y: dragRef.current.nodeY + dy,
      });
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [node.id, node.position.x, node.position.y, zoom, moveNode, setSelectedNodes]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, direction: ResizeDirection) => {
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    const canvasElement = (e.currentTarget as HTMLElement | null)?.closest('.flashboard-canvas');
    if (!canvasElement) {
      return;
    }

    const canvasRect = canvasElement.getBoundingClientRect();
    const pointer = getBoardPointer(e.clientX, e.clientY, canvasRect.left, canvasRect.top);
    const geometry = RESIZE_HANDLE_GEOMETRY[direction];
    const anchorWorldX = node.position.x + displayWidth * geometry.anchorX;
    const anchorWorldY = node.position.y + displayHeight * geometry.anchorY;
    const projectorX = geometry.handleX - geometry.anchorX;
    const projectorY = (geometry.handleY - geometry.anchorY) / lockedAspectRatio;
    const projectorDenominator = projectorX * projectorX + projectorY * projectorY;
    const projectedWidth = projectorDenominator > 0
      ? (
        ((pointer.x - anchorWorldX) * projectorX) +
        ((pointer.y - anchorWorldY) * projectorY)
      ) / projectorDenominator
      : displayWidth;

    setSelectedNodes([node.id]);
    resizeRef.current = {
      direction,
      anchorWorldX,
      anchorWorldY,
      anchorX: geometry.anchorX,
      anchorY: geometry.anchorY,
      aspectRatio: lockedAspectRatio,
      projectorX,
      projectorY,
      projectorDenominator,
      widthOffset: displayWidth - projectedWidth,
      canvasLeft: canvasRect.left,
      canvasTop: canvasRect.top,
      panX,
      panY,
      zoom,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const session = resizeRef.current;
      if (!session) return;

      const nextPointer = {
        x: (ev.clientX - session.canvasLeft - session.panX) / session.zoom,
        y: (ev.clientY - session.canvasTop - session.panY) / session.zoom,
      };
      const nextProjectedWidth = session.projectorDenominator > 0
        ? (
          ((nextPointer.x - session.anchorWorldX) * session.projectorX) +
          ((nextPointer.y - session.anchorWorldY) * session.projectorY)
        ) / session.projectorDenominator
        : displayWidth;
      const nextWidth = clampNodeWidth(nextProjectedWidth + session.widthOffset);
      const nextHeight = nextWidth / session.aspectRatio;
      const nextPosition = {
        x: session.anchorWorldX - session.anchorX * nextWidth,
        y: session.anchorWorldY - session.anchorY * nextHeight,
      };

      moveNode(node.id, nextPosition);
      resizeNode(node.id, {
        width: nextWidth,
        height: nextHeight,
      });
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [displayHeight, displayWidth, getBoardPointer, lockedAspectRatio, moveNode, node.id, node.position.x, node.position.y, panX, panY, resizeNode, setSelectedNodes, zoom]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.kind === 'generation') {
      openComposer(node.id);
    }
  }, [node.id, node.kind, openComposer]);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedNodeIds.length === 0 || !selectedNodeIds.includes(node.id)) {
      setSelectedNodes([node.id]);
    }
    onContextMenu(e, node.id);
  }, [node.id, selectedNodeIds, setSelectedNodes, onContextMenu]);

  // DnD: allow dragging completed/reference nodes to timeline
  const handleDragStart = useCallback((e: React.DragEvent) => {
    if (!mediaFileId) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.dataTransfer.setData('application/x-media-file-id', mediaFileId);
    e.dataTransfer.effectAllowed = 'copy';
  }, [mediaFileId]);

  const handleNodeDragStart = useCallback((e: React.DragEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.flashboard-node-drag-handle, .flashboard-node-resize-handle, .flashboard-node-resize-zone')) {
      return;
    }
    e.preventDefault();
  }, []);

  const stopNodeInteraction = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const toggleVideoPlayback = () => {
    const video = videoRef.current;
    if (!video || !isVideoPreview) {
      return;
    }

    if (video.paused) {
      void video.play().catch(() => {
        setVideoPreviewState((prev) => ({
          mediaId: mediaFileId ?? null,
          currentTime: prev.mediaId === mediaFileId ? prev.currentTime : 0,
          duration: prev.mediaId === mediaFileId ? prev.duration : (mediaFile?.duration ?? node.result?.duration ?? 0),
          isPlaying: false,
        }));
      });
      return;
    }

    video.pause();
  };

  const handleVideoSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    const nextTime = Number(e.target.value);

    setVideoPreviewState((prev) => ({
      mediaId: mediaFileId ?? null,
      currentTime: nextTime,
      duration: prev.mediaId === mediaFileId ? prev.duration : (mediaFile?.duration ?? node.result?.duration ?? 0),
      isPlaying: prev.mediaId === mediaFileId ? prev.isPlaying : !video?.paused,
    }));
    if (!video) {
      return;
    }

    video.currentTime = nextTime;
  };

  useEffect(() => {
    if (Math.abs(node.size.width - displayWidth) < 0.01 && Math.abs(node.size.height - displayHeight) < 0.01) {
      return;
    }

    resizeNode(node.id, {
      width: displayWidth,
      height: displayHeight,
    });
  }, [displayHeight, displayWidth, node.id, node.size.height, node.size.width, resizeNode]);

  return (
    <div
      className={`flashboard-node ${status} ${isSelected ? 'selected' : ''} ${isReference ? 'reference' : ''} ${hasPreview ? 'has-preview' : ''} ${isVideoPreview ? 'has-video-preview' : ''} ${isOverlapOutlined ? 'overlap-outlined' : ''}`}
      data-flashboard-node-id={node.id}
      style={{
        left: node.position.x,
        top: node.position.y,
        width: displayWidth,
        height: displayHeight,
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleRightClick}
      onDragStart={handleNodeDragStart}
    >
      {RESIZE_HANDLES.map((direction) => (
        <div
          key={direction}
          className={`flashboard-node-resize-zone ${direction}`}
          onMouseDown={(e) => handleResizeMouseDown(e, direction)}
        />
      ))}
      <div className="flashboard-node-body">
        {hasPreview ? (
          <>
            {isVideoPreview && videoUrl ? (
              <div className="flashboard-node-preview">
                <video
                  ref={videoRef}
                  className="flashboard-node-video"
                  src={videoUrl}
                  poster={mediaFile?.thumbnailUrl}
                  preload="metadata"
                  playsInline
                />
              </div>
            ) : thumbnailUrl ? (
              <div className="flashboard-node-preview">
                <img className="flashboard-node-thumbnail" src={thumbnailUrl} alt="" draggable={false} />
              </div>
            ) : null}
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            {isVideoPreview && (
              <div
                className="flashboard-node-video-controls"
                onMouseDown={stopNodeInteraction}
                onClick={stopNodeInteraction}
                onDoubleClick={stopNodeInteraction}
              >
                <button
                  className="flashboard-node-video-play"
                  type="button"
                  onClick={toggleVideoPlayback}
                  title={resolvedIsVideoPlaying ? 'Pause' : 'Play'}
                >
                  {resolvedIsVideoPlaying ? '||' : '>'}
                </button>
                <input
                  className="flashboard-node-video-slider"
                  type="range"
                  min={0}
                  max={resolvedVideoDuration || 0}
                  step={Math.max((resolvedVideoDuration || 0) / 200, 0.01)}
                  value={Math.min(resolvedVideoCurrentTime, resolvedVideoDuration || resolvedVideoCurrentTime)}
                  onChange={handleVideoSeek}
                  disabled={resolvedVideoDuration <= 0}
                />
                <div className="flashboard-node-video-time">
                  {formatPreviewTime(resolvedVideoCurrentTime)} / {formatPreviewTime(resolvedVideoDuration)}
                </div>
              </div>
            )}
            <div className="flashboard-node-overlay">
              <div className="flashboard-node-overlay-body">
                <div className={`flashboard-node-prompt ${!prompt && !isReference ? 'empty' : ''}`}>
                  {previewTitle}
                </div>
                {showMeta && (
                  <>
                    {provider && !isReference && (
                      <div className="flashboard-node-provider">{provider}</div>
                    )}
                    {detailTokens.length > 0 && (
                      <div className="flashboard-node-details">
                        {detailTokens.map((token) => (
                          <span key={token} className="flashboard-node-detail-pill">{token}</span>
                        ))}
                      </div>
                    )}
                    {(isActive || status === 'completed' || status === 'failed' || status === 'canceled') && (
                      <div className="flashboard-node-meta">
                        <span>{statusLabel}</span>
                        {startedAt && <span>{elapsedLabel}</span>}
                      </div>
                    )}
                    {status === 'failed' && node.job?.error && (
                      <div className="flashboard-node-error" title={node.job.error}>
                        {node.job.error}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        ) : isReference && mediaName ? (
          <>
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            <div className="flashboard-node-content">
              <div className="flashboard-node-prompt">{mediaName}</div>
            </div>
          </>
        ) : (
          <div className="flashboard-node-content">
            {mediaFileId && (
              <div
                className="flashboard-node-drag-handle"
                title="Drag to timeline"
                draggable
                onDragStart={handleDragStart}
                onMouseDown={(e) => e.stopPropagation()}
              >
                +
              </div>
            )}
            <div className={`flashboard-node-prompt ${!prompt ? 'empty' : ''}`}>
              {prompt || 'No prompt yet'}
            </div>
            {provider && (
              <div className="flashboard-node-provider">{provider}</div>
            )}
            {detailTokens.length > 0 && (
              <div className="flashboard-node-details">
                {detailTokens.map((token) => (
                  <span key={token} className="flashboard-node-detail-pill">{token}</span>
                ))}
              </div>
            )}
            {(isActive || status === 'completed') && (
              <div className="flashboard-node-meta">
                <span>{statusLabel}</span>
                {startedAt && <span>{elapsedLabel}</span>}
              </div>
            )}
          </div>
        )}
        {status === 'processing' && node.job?.progress != null && (
          <div className={`flashboard-node-progress ${hasPreview ? 'overlay' : ''}`}>
            <div
              className="flashboard-node-progress-bar"
              style={{ width: `${Math.round(node.job.progress * 100)}%` }}
            />
          </div>
        )}
        {status === 'failed' && node.job?.error && (
          <div className="flashboard-node-error" title={node.job.error}>
            {node.job.error}
          </div>
        )}
      </div>
      <div
        className="flashboard-node-resize-handle"
        title="Resize"
        onMouseDown={(e) => handleResizeMouseDown(e, 'se')}
      />
    </div>
  );
}
