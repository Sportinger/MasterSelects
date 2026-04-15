import { memo, type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { selectActiveBoard, type FlashBoardMediaReferenceUsage } from '../../../stores/flashboardStore/selectors';
import type {
  FlashBoardComposerReferenceRole,
  FlashBoardNode as FlashBoardNodeType,
} from '../../../stores/flashboardStore/types';
import { useMediaStore } from '../../../stores/mediaStore';
import { getFlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import { clampNodeWidth, resolveFlashBoardNodeDisplaySize } from './nodeSizing';

interface FlashBoardNodeProps {
  node: FlashBoardNodeType;
  isSelected: boolean;
  isOverlapOutlined?: boolean;
  zoom: number;
  referenceUsage?: FlashBoardMediaReferenceUsage;
  hoveredComposerReferenceRole?: FlashBoardComposerReferenceRole;
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

interface DragSession {
  startX: number;
  startY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  latestClientX: number;
  latestClientY: number;
  canvasLeft: number;
  canvasTop: number;
  canvasWidth: number;
  canvasHeight: number;
  hasDragged: boolean;
  anchorNodeStartX: number;
  anchorNodeStartY: number;
  selectedNodeStartPositions: Array<{
    id: string;
    x: number;
    y: number;
  }>;
}

const RESIZE_HANDLES: ResizeDirection[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const NODE_DRAG_THRESHOLD = 4;
const NODE_DRAG_AUTO_PAN_COVERAGE = 0.74;
const NODE_DRAG_AUTO_PAN_MIN_EDGE = 260;
const NODE_DRAG_AUTO_PAN_MAX_EDGE = 560;
const NODE_DRAG_AUTO_PAN_BASE_SPEED = 520;
const NODE_DRAG_AUTO_PAN_MAX_SPEED = 1100;
const NODE_DRAG_AUTO_PAN_EXPONENT = 3;
const NODE_FOCUS_PADDING = 64;
const NODE_FOCUS_MIN_ZOOM = 0.1;
const NODE_FOCUS_MAX_ZOOM = 3.5;
const NODE_DRAG_AUTO_PAN_MIN_SCALE = 0.75;
const NODE_DRAG_AUTO_PAN_MAX_SCALE = 2.1;
const NODE_REFERENCE_MIN_SCREEN_SCALE = 0.58;
const NODE_REFERENCE_MAX_SCREEN_SCALE = 1.9;
const NODE_REFERENCE_SCREEN_SCALE_EXPONENT = 0.7;

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

function getNodeDragAutoPanScale(zoom: number): number {
  return Math.min(
    NODE_DRAG_AUTO_PAN_MAX_SCALE,
    Math.max(NODE_DRAG_AUTO_PAN_MIN_SCALE, Math.pow(1 / Math.max(zoom, 0.1), 0.7)),
  );
}

function getNodeDragAutoPanEdgeSize(axisSize: number): number {
  return Math.min(
    NODE_DRAG_AUTO_PAN_MAX_EDGE,
    Math.max(NODE_DRAG_AUTO_PAN_MIN_EDGE, axisSize * (NODE_DRAG_AUTO_PAN_COVERAGE / 2)),
  );
}

function getReferenceShadowScale(zoom: number): number {
  const safeZoom = Math.max(zoom, 0.1);
  const targetScreenScale = Math.min(
    NODE_REFERENCE_MAX_SCREEN_SCALE,
    Math.max(NODE_REFERENCE_MIN_SCREEN_SCALE, Math.pow(safeZoom, NODE_REFERENCE_SCREEN_SCALE_EXPONENT)),
  );

  return targetScreenScale / safeZoom;
}

function computeAutoPanVelocity(pointer: number, minEdge: number, maxEdge: number, edgeSize: number, zoom: number): number {
  const maxSpeed = Math.min(
    NODE_DRAG_AUTO_PAN_MAX_SPEED,
    NODE_DRAG_AUTO_PAN_BASE_SPEED * getNodeDragAutoPanScale(zoom),
  );
  const distanceToMin = pointer - minEdge;
  if (distanceToMin < edgeSize) {
    const normalized = 1 - Math.min(1, Math.max(0, distanceToMin / edgeSize));
    return (normalized ** NODE_DRAG_AUTO_PAN_EXPONENT) * maxSpeed;
  }

  const distanceToMax = maxEdge - pointer;
  if (distanceToMax < edgeSize) {
    const normalized = 1 - Math.min(1, Math.max(0, distanceToMax / edgeSize));
    return -(normalized ** NODE_DRAG_AUTO_PAN_EXPONENT) * maxSpeed;
  }

  return 0;
}

function buildReferenceRoleShadow(
  role: FlashBoardComposerReferenceRole,
  options: {
    index: number;
    peak: boolean;
    emphasis: 'base' | 'hover';
  },
): string {
  const { index, peak, emphasis } = options;
  const ringSize = (emphasis === 'hover' ? 8 : 5) + (index * (emphasis === 'hover' ? 6 : 5));
  const outerRingSize = ringSize + (emphasis === 'hover' ? 4 : 3);
  const glowRingSize = outerRingSize + (emphasis === 'hover' ? 4 : 3);
  const blurSize = (peak ? (emphasis === 'hover' ? 44 : 32) : (emphasis === 'hover' ? 34 : 24)) + (index * 10);
  const haloSize = (peak ? (emphasis === 'hover' ? 78 : 58) : (emphasis === 'hover' ? 60 : 44)) + (index * 12);

  const scaleVar = 'var(--flashboard-reference-shadow-scale, 1)';

  if (role === 'start') {
    return `0 0 0 calc(${ringSize}px * ${scaleVar}) rgba(61, 181, 88, ${peak ? '1' : '0.98'}), 0 0 0 calc(${outerRingSize}px * ${scaleVar}) rgba(61, 181, 88, ${emphasis === 'hover' ? '0.46' : '0.3'}), 0 0 0 calc(${glowRingSize}px * ${scaleVar}) rgba(61, 181, 88, ${emphasis === 'hover' ? '0.22' : '0.14'}), 0 0 calc(${blurSize}px * ${scaleVar}) rgba(61, 181, 88, ${peak ? (emphasis === 'hover' ? '0.88' : '0.68') : (emphasis === 'hover' ? '0.62' : '0.46')}), 0 0 calc(${haloSize}px * ${scaleVar}) rgba(61, 181, 88, ${peak ? (emphasis === 'hover' ? '0.5' : '0.34') : (emphasis === 'hover' ? '0.34' : '0.22')})`;
  }
  if (role === 'end') {
    return `0 0 0 calc(${ringSize}px * ${scaleVar}) rgba(210, 74, 65, ${peak ? '1' : '0.98'}), 0 0 0 calc(${outerRingSize}px * ${scaleVar}) rgba(210, 74, 65, ${emphasis === 'hover' ? '0.46' : '0.3'}), 0 0 0 calc(${glowRingSize}px * ${scaleVar}) rgba(210, 74, 65, ${emphasis === 'hover' ? '0.22' : '0.14'}), 0 0 calc(${blurSize}px * ${scaleVar}) rgba(210, 74, 65, ${peak ? (emphasis === 'hover' ? '0.88' : '0.68') : (emphasis === 'hover' ? '0.62' : '0.46')}), 0 0 calc(${haloSize}px * ${scaleVar}) rgba(210, 74, 65, ${peak ? (emphasis === 'hover' ? '0.5' : '0.34') : (emphasis === 'hover' ? '0.34' : '0.22')})`;
  }
  return `0 0 0 calc(${ringSize}px * ${scaleVar}) rgba(63, 129, 230, ${peak ? '1' : '0.98'}), 0 0 0 calc(${outerRingSize}px * ${scaleVar}) rgba(63, 129, 230, ${emphasis === 'hover' ? '0.46' : '0.3'}), 0 0 0 calc(${glowRingSize}px * ${scaleVar}) rgba(63, 129, 230, ${emphasis === 'hover' ? '0.22' : '0.14'}), 0 0 calc(${blurSize}px * ${scaleVar}) rgba(63, 129, 230, ${peak ? (emphasis === 'hover' ? '0.88' : '0.68') : (emphasis === 'hover' ? '0.62' : '0.46')}), 0 0 calc(${haloSize}px * ${scaleVar}) rgba(63, 129, 230, ${peak ? (emphasis === 'hover' ? '0.5' : '0.34') : (emphasis === 'hover' ? '0.34' : '0.22')})`;
}

function FlashBoardNodeComponent({
  node,
  isSelected,
  isOverlapOutlined = false,
  zoom,
  referenceUsage,
  hoveredComposerReferenceRole,
  onContextMenu,
}: FlashBoardNodeProps) {
  const activeBoard = useFlashBoardStore(selectActiveBoard);
  const moveNode = useFlashBoardStore((s) => s.moveNode);
  const resizeNode = useFlashBoardStore((s) => s.resizeNode);
  const updateViewport = useFlashBoardStore((s) => s.updateViewport);
  const selectedNodeIds = useFlashBoardStore((s) => s.selectedNodeIds);
  const setSelectedNodes = useFlashBoardStore((s) => s.setSelectedNodes);

  const dragRef = useRef<DragSession | null>(null);
  const dragAutoPanFrameRef = useRef<number | null>(null);
  const dragAutoPanStateRef = useRef({ velocityX: 0, velocityY: 0, lastTimestamp: 0 });
  const resizeRef = useRef<ResizeSession | null>(null);
  const suppressContextMenuRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastVideoPreviewTimeRef = useRef(0);
  const [isHovered, setIsHovered] = useState(false);
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
  const referenceRoles = [
    referenceUsage?.start ? 'start' as const : null,
    referenceUsage?.end ? 'end' as const : null,
    referenceUsage?.reference ? 'reference' as const : null,
  ].filter((role): role is 'start' | 'end' | 'reference' => Boolean(role));
  const { aspectRatio: lockedAspectRatio, width: displayWidth, height: displayHeight } =
    resolveFlashBoardNodeDisplaySize(node, mediaFile);
  const panX = activeBoard?.viewport.panX ?? 0;
  const panY = activeBoard?.viewport.panY ?? 0;
  const activeBoardId = activeBoard?.id ?? null;
  const uiScale = zoom > 1 ? 1 / zoom : 1;
  const referenceShadowScale = getReferenceShadowScale(zoom);
  const videoStateMatchesMedia = videoPreviewState.mediaId === mediaFileId;
  const resolvedVideoCurrentTime = videoStateMatchesMedia ? videoPreviewState.currentTime : 0;
  const resolvedVideoDuration = videoStateMatchesMedia
    ? videoPreviewState.duration
    : (mediaFile?.duration ?? node.result?.duration ?? 0);
  const resolvedIsVideoPlaying = videoStateMatchesMedia ? videoPreviewState.isPlaying : false;
  const shouldRenderLiveVideo = isVideoPreview && (resolvedIsVideoPlaying || isHovered || isSelected || !thumbnailUrl);
  const hasReferenceRole = referenceRoles.length > 0;
  const isComposerReferenceHovered = Boolean(hoveredComposerReferenceRole);
  const selectedShadow = isSelected ? '0 0 0 1px var(--accent)' : null;
  const buildReferenceShadow = (peak: boolean, emphasis: 'base' | 'hover', roles: FlashBoardComposerReferenceRole[]) => roles.map((role, index) => (
    buildReferenceRoleShadow(role, { index, peak, emphasis })
  )).join(', ');
  const nodeShadowRest = [
    selectedShadow,
    hasReferenceRole ? buildReferenceShadow(false, 'base', referenceRoles) : null,
    isComposerReferenceHovered && hoveredComposerReferenceRole
      ? buildReferenceShadow(false, 'hover', [hoveredComposerReferenceRole])
      : null,
  ].filter(Boolean).join(', ') || undefined;
  const nodeShadowPeak = [
    selectedShadow,
    hasReferenceRole ? buildReferenceShadow(true, 'base', referenceRoles) : null,
    isComposerReferenceHovered && hoveredComposerReferenceRole
      ? buildReferenceShadow(true, 'hover', [hoveredComposerReferenceRole])
      : null,
  ].filter(Boolean).join(', ') || undefined;
  const nodeStyle = {
    left: node.position.x,
    top: node.position.y,
    width: displayWidth,
    height: displayHeight,
    '--flashboard-ui-scale': uiScale,
    '--flashboard-reference-shadow-scale': referenceShadowScale,
    '--flashboard-node-shadow-rest': nodeShadowRest,
    '--flashboard-node-shadow-peak': nodeShadowPeak,
    boxShadow: nodeShadowRest,
  } as CSSProperties;

  useEffect(() => {
    lastVideoPreviewTimeRef.current = videoStateMatchesMedia ? videoPreviewState.currentTime : 0;
  }, [videoStateMatchesMedia, videoPreviewState.currentTime]);

  const getBoardPointer = useCallback((clientX: number, clientY: number, canvasLeft: number, canvasTop: number) => ({
    x: (clientX - canvasLeft - panX) / zoom,
    y: (clientY - canvasTop - panY) / zoom,
  }), [panX, panY, zoom]);

  const stopDragAutoPan = useCallback(() => {
    if (dragAutoPanFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoPanFrameRef.current);
      dragAutoPanFrameRef.current = null;
    }
    dragAutoPanStateRef.current = { velocityX: 0, velocityY: 0, lastTimestamp: 0 };
  }, []);

  const syncDraggedNodeToPointer = useCallback((session: DragSession, viewportOverride?: { panX: number; panY: number; zoom: number }) => {
    const boardState = useFlashBoardStore.getState();
    const boardForDrag = activeBoardId
      ? boardState.boards.find((candidate) => candidate.id === activeBoardId)
      : null;
    const viewport = viewportOverride ?? boardForDrag?.viewport;
    if (!viewport) {
      return;
    }

    const anchorX = ((session.latestClientX - session.canvasLeft - viewport.panX) / viewport.zoom) - session.pointerOffsetX;
    const anchorY = ((session.latestClientY - session.canvasTop - viewport.panY) / viewport.zoom) - session.pointerOffsetY;
    const deltaX = anchorX - session.anchorNodeStartX;
    const deltaY = anchorY - session.anchorNodeStartY;

    session.selectedNodeStartPositions.forEach((selectedNode) => {
      moveNode(selectedNode.id, {
        x: selectedNode.x + deltaX,
        y: selectedNode.y + deltaY,
      });
    });
  }, [activeBoardId, moveNode, node.id]);

  const startDragAutoPan = useCallback(() => {
    if (dragAutoPanFrameRef.current !== null) {
      return;
    }

    const tick = (timestamp: number) => {
      const session = dragRef.current;
      if (!session || !activeBoardId) {
        stopDragAutoPan();
        return;
      }

      const boardState = useFlashBoardStore.getState();
      const boardForDrag = boardState.boards.find((candidate) => candidate.id === activeBoardId);
      if (!boardForDrag) {
        stopDragAutoPan();
        return;
      }

      const { lastTimestamp } = dragAutoPanStateRef.current;
      const edgeSizeX = getNodeDragAutoPanEdgeSize(session.canvasWidth);
      const edgeSizeY = getNodeDragAutoPanEdgeSize(session.canvasHeight);
      const velocityX = computeAutoPanVelocity(
        session.latestClientX,
        session.canvasLeft,
        session.canvasLeft + session.canvasWidth,
        edgeSizeX,
        boardForDrag.viewport.zoom,
      );
      const velocityY = computeAutoPanVelocity(
        session.latestClientY,
        session.canvasTop,
        session.canvasTop + session.canvasHeight,
        edgeSizeY,
        boardForDrag.viewport.zoom,
      );
      dragAutoPanStateRef.current.velocityX = velocityX;
      dragAutoPanStateRef.current.velocityY = velocityY;
      if (Math.abs(velocityX) < 0.01 && Math.abs(velocityY) < 0.01) {
        dragAutoPanFrameRef.current = null;
        dragAutoPanStateRef.current.lastTimestamp = 0;
        return;
      }

      const deltaSeconds = (lastTimestamp > 0
        ? Math.min(32, timestamp - lastTimestamp)
        : 16) / 1000;
      dragAutoPanStateRef.current.lastTimestamp = timestamp;

      const nextPanX = boardForDrag.viewport.panX + (velocityX * deltaSeconds);
      const nextPanY = boardForDrag.viewport.panY + (velocityY * deltaSeconds);
      const nextViewport = {
        panX: nextPanX,
        panY: nextPanY,
        zoom: boardForDrag.viewport.zoom,
      };

      updateViewport(activeBoardId, nextViewport);
      syncDraggedNodeToPointer(session, nextViewport);

      dragAutoPanFrameRef.current = window.requestAnimationFrame(tick);
    };

    dragAutoPanFrameRef.current = window.requestAnimationFrame(tick);
  }, [activeBoardId, stopDragAutoPan, syncDraggedNodeToPointer, updateViewport]);

  const updateDragAutoPan = useCallback((session: DragSession) => {
    const boardState = useFlashBoardStore.getState();
    const boardForDrag = activeBoardId
      ? boardState.boards.find((candidate) => candidate.id === activeBoardId)
      : null;
    const currentZoom = boardForDrag?.viewport.zoom ?? zoom;
    const edgeSizeX = getNodeDragAutoPanEdgeSize(session.canvasWidth);
    const edgeSizeY = getNodeDragAutoPanEdgeSize(session.canvasHeight);

    dragAutoPanStateRef.current.velocityX = computeAutoPanVelocity(
      session.latestClientX,
      session.canvasLeft,
      session.canvasLeft + session.canvasWidth,
      edgeSizeX,
      currentZoom,
    );
    dragAutoPanStateRef.current.velocityY = computeAutoPanVelocity(
      session.latestClientY,
      session.canvasTop,
      session.canvasTop + session.canvasHeight,
      edgeSizeY,
      currentZoom,
    );

    if (Math.abs(dragAutoPanStateRef.current.velocityX) < 0.01 && Math.abs(dragAutoPanStateRef.current.velocityY) < 0.01) {
      stopDragAutoPan();
      return;
    }

    startDragAutoPan();
  }, [activeBoardId, startDragAutoPan, stopDragAutoPan, zoom]);

  useEffect(() => () => {
    stopDragAutoPan();
  }, [stopDragAutoPan]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideoPreview || !shouldRenderLiveVideo) {
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
      const resumeTime = lastVideoPreviewTimeRef.current;
      if (resumeTime > 0 && Number.isFinite(resumeTime)) {
        try {
          video.currentTime = Math.min(resumeTime, video.duration || resumeTime);
        } catch {
          // Ignore seek errors during metadata load; slider state still reflects last known time.
        }
      }
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
  }, [isVideoPreview, mediaFile?.duration, mediaFileId, node.result?.duration, shouldRenderLiveVideo, videoUrl]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();

    const canvasElement = (e.currentTarget as HTMLElement | null)?.closest('.flashboard-canvas');
    const canvasRect = canvasElement?.getBoundingClientRect();
    if (!canvasRect || !activeBoardId) {
      return;
    }

    const boardState = useFlashBoardStore.getState();
    const boardForDrag = boardState.boards.find((candidate) => candidate.id === activeBoardId);
    if (!boardForDrag) {
      return;
    }
    const draggedSelectionIds = selectedNodeIds.includes(node.id) ? selectedNodeIds : [node.id];
    if (!selectedNodeIds.includes(node.id) || selectedNodeIds.length <= 1) {
      setSelectedNodes(draggedSelectionIds);
    }
    const pointer = {
      x: (e.clientX - canvasRect.left - boardForDrag.viewport.panX) / boardForDrag.viewport.zoom,
      y: (e.clientY - canvasRect.top - boardForDrag.viewport.panY) / boardForDrag.viewport.zoom,
    };
    const selectedNodeStartPositions = boardForDrag.nodes
      .filter((candidate) => draggedSelectionIds.includes(candidate.id))
      .map((candidate) => ({
        id: candidate.id,
        x: candidate.position.x,
        y: candidate.position.y,
      }));

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      pointerOffsetX: pointer.x - node.position.x,
      pointerOffsetY: pointer.y - node.position.y,
      latestClientX: e.clientX,
      latestClientY: e.clientY,
      canvasLeft: canvasRect.left,
      canvasTop: canvasRect.top,
      canvasWidth: canvasRect.width,
      canvasHeight: canvasRect.height,
      hasDragged: false,
      anchorNodeStartX: node.position.x,
      anchorNodeStartY: node.position.y,
      selectedNodeStartPositions,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      const session = dragRef.current;
      if (!session) return;
      session.latestClientX = ev.clientX;
      session.latestClientY = ev.clientY;
      const dragDistance = Math.hypot(
        ev.clientX - session.startX,
        ev.clientY - session.startY,
      );
      if (!session.hasDragged && dragDistance >= NODE_DRAG_THRESHOLD) {
        session.hasDragged = true;
        suppressContextMenuRef.current = true;
      }
      if (!session.hasDragged) {
        return;
      }
      syncDraggedNodeToPointer(session);
      updateDragAutoPan(session);
    };

    const handleMouseUp = () => {
      if (dragRef.current?.hasDragged) {
        suppressContextMenuRef.current = true;
      }
      stopDragAutoPan();
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [activeBoardId, node.id, node.position.x, node.position.y, selectedNodeIds, setSelectedNodes, stopDragAutoPan, syncDraggedNodeToPointer, updateDragAutoPan]);

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
    if (!activeBoard) {
      return;
    }
    const canvasElement = (e.currentTarget as HTMLElement | null)?.closest('.flashboard-canvas');
    const canvasRect = canvasElement?.getBoundingClientRect();
    if (!canvasRect) {
      return;
    }

    const availableWidth = Math.max(120, canvasRect.width - (NODE_FOCUS_PADDING * 2));
    const availableHeight = Math.max(120, canvasRect.height - (NODE_FOCUS_PADDING * 2));
    const fitZoom = Math.min(
      availableWidth / Math.max(displayWidth, 1),
      availableHeight / Math.max(displayHeight, 1),
    );
    const targetZoom = Math.max(
      NODE_FOCUS_MIN_ZOOM,
      Math.min(NODE_FOCUS_MAX_ZOOM, fitZoom),
    );
    const centerX = node.position.x + (displayWidth / 2);
    const centerY = node.position.y + (displayHeight / 2);

    updateViewport(activeBoard.id, {
      zoom: targetZoom,
      panX: (canvasRect.width / 2) - (centerX * targetZoom),
      panY: (canvasRect.height / 2) - (centerY * targetZoom),
    });
  }, [activeBoard, displayHeight, displayWidth, node.position.x, node.position.y, updateViewport]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.stopPropagation();
    setSelectedNodes([node.id]);
  }, [node.id, setSelectedNodes]);

  const handleRightClick = useCallback((e: React.MouseEvent) => {
    if (suppressContextMenuRef.current) {
      suppressContextMenuRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
      className={`flashboard-node ${status} ${isSelected ? 'selected' : ''} ${isReference ? 'reference' : ''} ${hasPreview ? 'has-preview' : ''} ${isVideoPreview ? 'has-video-preview' : ''} ${isOverlapOutlined ? 'overlap-outlined' : ''} ${hasReferenceRole ? 'has-reference-role' : ''} ${isComposerReferenceHovered ? 'composer-reference-hovered' : ''}`}
      data-flashboard-node-id={node.id}
      style={nodeStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
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
            {shouldRenderLiveVideo && videoUrl ? (
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
                <img className="flashboard-node-thumbnail" src={thumbnailUrl} alt="" draggable={false} loading="lazy" />
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

export const FlashBoardNode = memo(FlashBoardNodeComponent);
FlashBoardNode.displayName = 'FlashBoardNode';
