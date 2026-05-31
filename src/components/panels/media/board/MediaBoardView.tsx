import React from 'react';
import type { Composition, MediaFile, MediaFolder, ProjectItem, SolidItem, TextItem } from '../../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { FileTypeIcon } from '../FileTypeIcon';
import { getItemImportProgress, getItemWaveformProgress, isImportedMediaFileItem } from '../itemTypeGuards';
import { getLabelHex } from '../labelColors';
import { MEDIA_BOARD_GRID_PARALLAX, getMediaBoardGridSize, getMediaBoardUiScale } from './constants';
import { getMediaBoardOrderKey, getMediaBoardTypeLabel, isMediaBoardFolder } from './layout';
import type {
  MediaBoardGroupLayout,
  MediaBoardInsertGapPlacement,
  MediaBoardMarquee,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardVisibleRect,
} from './types';

interface MediaBoardViewProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  canvasInnerRef: React.RefObject<HTMLDivElement | null>;
  overviewCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  viewport: MediaBoardViewport;
  renderLod: MediaBoardRenderLod;
  overviewCanvasStyle: React.CSSProperties;
  isMediaSearchActive: boolean;
  mediaSearchResultCount: number;
  totalItems: number;
  itemCount: number;
  folderCount: number;
  folders: MediaFolder[];
  visibleGroups: MediaBoardGroupLayout[];
  visibleInsertGaps: MediaBoardInsertGapPlacement[];
  visiblePlacements: MediaBoardNodePlacement[];
  visibleRect: MediaBoardVisibleRect;
  focusedOriginalMediaId: string | null;
  videoPosterFallbackIds: Set<string>;
  marquee: MediaBoardMarquee | null;
  selectedIdSet: Set<string>;
  mediaSearchVisibleItemIds: Set<string> | null;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onStartRename: (id: string, currentName: string) => void;
  onOpenAI: () => void;
  onResetLayout: () => void;
  onCanvasWheel: (e: React.WheelEvent<HTMLDivElement>) => void;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  onCanvasDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onCanvasDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onCanvasDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onNodeMouseDown: (e: React.MouseEvent, item: ProjectItem) => void;
  onItemDoubleClick: (item: ProjectItem) => void;
  onItemContextMenu: (e: React.MouseEvent, itemId?: string, parentId?: string | null) => void;
  consumeSuppressedContextMenu: () => boolean;
  onGroupDragOver: (e: React.DragEvent) => void;
  onGroupDrop: (e: React.DragEvent, groupId: string | null) => void;
  onRequestThumbnail: (id: string) => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  buildTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  formatDuration: (seconds: number) => string;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
  children?: React.ReactNode;
}

function getMediaBoardVideoPosterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(0, duration - 0.05), Math.max(0.12, duration * 0.5));
}

function getMediaBoardVideoScrubTime(duration: number, ratio: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return Math.min(Math.max(0, duration - 0.05), duration * clampedRatio);
}

function getPointerRatioInElement(event: React.MouseEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}

function MediaBoardNode({
  placement,
  renderLod,
  viewport,
  visibleRect,
  focusedOriginalMediaId,
  videoPosterFallbackIds,
  selectedIdSet,
  mediaSearchVisibleItemIds,
  onNodeMouseDown,
  onItemDoubleClick,
  onItemContextMenu,
  consumeSuppressedContextMenu,
  onRequestThumbnail,
  refreshFileUrls,
  buildTooltip,
  formatDuration,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
}: Pick<
  MediaBoardViewProps,
  | 'renderLod'
  | 'viewport'
  | 'visibleRect'
  | 'focusedOriginalMediaId'
  | 'videoPosterFallbackIds'
  | 'selectedIdSet'
  | 'mediaSearchVisibleItemIds'
  | 'onNodeMouseDown'
  | 'onItemDoubleClick'
  | 'onItemContextMenu'
  | 'consumeSuppressedContextMenu'
  | 'onRequestThumbnail'
  | 'refreshFileUrls'
  | 'buildTooltip'
  | 'formatDuration'
  | 'getProjectItemIconType'
  | 'getGaussianSplatResolutionLabel'
  | 'getMediaFileContainerLabel'
  | 'getMediaFileCodecLabel'
> & {
  placement: MediaBoardNodePlacement;
}) {
  const { item, layout } = placement;

  const isFolderNode = isMediaBoardFolder(item);
  const isSelected = selectedIdSet.has(item.id);
  const isMediaFile = isImportedMediaFileItem(item);
  const mediaFile = isMediaFile ? item : null;
  const [isVideoHoverPreviewActive, setIsVideoHoverPreviewActive] = React.useState(false);
  const [isVideoPosterReady, setIsVideoPosterReady] = React.useState(false);
  const [videoScrubRatio, setVideoScrubRatio] = React.useState(0.5);
  const videoPreviewRef = React.useRef<HTMLVideoElement | null>(null);
  const videoPosterTargetRef = React.useRef(0);
  const videoScrubRatioRef = React.useRef<number | null>(null);
  const videoScrubFrameRef = React.useRef<number | null>(null);
  const isComp = !isFolderNode && item.type === 'composition';
  const comp = isComp ? (item as Composition) : null;
  const isTextItem = !isFolderNode && item.type === 'text';
  const textItem = isTextItem ? (item as TextItem) : null;
  const isSolidItem = !isFolderNode && item.type === 'solid';
  const solidItem = isSolidItem ? (item as SolidItem) : null;
  const thumbUrl = mediaFile?.thumbnailUrl;
  const videoPreviewUrl = mediaFile?.type === 'video'
    ? mediaFile.proxyVideoUrl || mediaFile.url
    : null;
  const originalUrl = mediaFile?.type === 'image' && mediaFile.url ? mediaFile.url : null;
  const duration = mediaFile?.duration || comp?.duration;
  const importProgress = getItemImportProgress(item);
  const waveformProgress = getItemWaveformProgress(item);
  const labelHex = 'labelColor' in item ? getLabelHex(item.labelColor) : 'transparent';
  const title = buildTooltip(item, false, isComp);
  const splatStatsLabel = mediaFile?.type === 'gaussian-splat'
    ? getGaussianSplatResolutionLabel(mediaFile)
    : null;
  const resolutionLabel = splatStatsLabel ??
    ('width' in item && 'height' in item && item.width && item.height
      ? `${item.width}x${item.height}`
      : comp
        ? `${comp.width}x${comp.height}`
        : null);
  const boardCodecLabel = mediaFile?.type === 'gaussian-splat'
    ? getMediaFileContainerLabel(mediaFile)
    : getMediaFileCodecLabel(mediaFile);
  const isCompactNode = renderLod.compact;
  const hasVideoPreviewSource = Boolean(videoPreviewUrl);
  const shouldRenderVideoPosterFallback = hasVideoPreviewSource
    && videoPosterFallbackIds.has(item.id);
  const shouldRenderThumb = Boolean(thumbUrl && (renderLod.showImages || shouldRenderVideoPosterFallback));
  const shouldRenderVideoPreview = hasVideoPreviewSource
    && (renderLod.showImages || shouldRenderVideoPosterFallback);
  const shouldRenderVideoElement = shouldRenderVideoPreview
    && (isVideoHoverPreviewActive || shouldRenderVideoPosterFallback);
  const isFocusedOriginal = Boolean(originalUrl && focusedOriginalMediaId === item.id);
  const shouldRenderFocusedOriginal = Boolean(
    originalUrl
    && isFocusedOriginal
    && renderLod.showImages
    && originalUrl !== thumbUrl,
  );
  const edgeInset = isFocusedOriginal ? 10 / Math.max(0.001, viewport.zoom) : 0;
  const stickyOverlayStyle = isFocusedOriginal
    ? {
        '--media-board-sticky-left': `${Math.max(0, visibleRect.left - layout.x + edgeInset)}px`,
        '--media-board-sticky-right': `${Math.max(0, layout.x + layout.width - visibleRect.right + edgeInset)}px`,
        '--media-board-sticky-top': `${Math.max(0, visibleRect.top - layout.y + edgeInset)}px`,
        '--media-board-sticky-bottom': `${Math.max(0, layout.y + layout.height - visibleRect.bottom + edgeInset)}px`,
      } as React.CSSProperties
    : null;

  const applyVideoScrubRatio = React.useCallback((ratio: number) => {
    const nextRatio = Math.max(0, Math.min(1, ratio));
    videoScrubRatioRef.current = nextRatio;
    setVideoScrubRatio((currentRatio) => (
      Math.abs(currentRatio - nextRatio) < 0.003 ? currentRatio : nextRatio
    ));
    if (videoScrubFrameRef.current !== null) return;

    videoScrubFrameRef.current = window.requestAnimationFrame(() => {
      videoScrubFrameRef.current = null;
      const video = videoPreviewRef.current;
      const scrubRatio = videoScrubRatioRef.current;
      if (!video || scrubRatio === null) return;

      const videoDuration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : mediaFile?.duration ?? 0;
      const targetTime = getMediaBoardVideoScrubTime(videoDuration, scrubRatio);
      if (targetTime <= 0 && scrubRatio > 0) return;
      if (Math.abs(video.currentTime - targetTime) < 0.04) return;

      video.pause();
      try {
        video.currentTime = targetTime;
      } catch {
        // Some browser/codec combinations reject seeks until metadata is ready.
      }
    });
  }, [mediaFile?.duration]);

  React.useEffect(() => () => {
    if (videoScrubFrameRef.current !== null) {
      window.cancelAnimationFrame(videoScrubFrameRef.current);
    }
  }, []);

  React.useEffect(() => {
    videoPosterTargetRef.current = 0;
    setIsVideoPosterReady(false);
  }, [shouldRenderVideoElement, videoPreviewUrl]);

  React.useEffect(() => {
    if (!shouldRenderVideoElement || isVideoPosterReady || isVideoHoverPreviewActive) return undefined;

    const timeoutId = window.setTimeout(() => {
      const video = videoPreviewRef.current;
      if (!video || video.readyState < 2) return;
      video.pause();
      setIsVideoPosterReady(true);
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [isVideoHoverPreviewActive, isVideoPosterReady, shouldRenderVideoElement]);

  const handleVideoLoadedMetadata = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    if (isVideoHoverPreviewActive) {
      applyVideoScrubRatio(videoScrubRatioRef.current ?? 0.5);
      return;
    }

    const targetTime = getMediaBoardVideoPosterTime(duration);
    videoPosterTargetRef.current = targetTime;

    if (targetTime <= 0) {
      setIsVideoPosterReady(true);
      return;
    }

    try {
      video.currentTime = targetTime;
    } catch {
      // Non-seekable metadata-only videos can still show their first decoded frame.
    }
  }, [applyVideoScrubRatio, isVideoHoverPreviewActive]);

  const handleVideoLoadedData = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (isVideoHoverPreviewActive) {
      video.pause();
      setIsVideoPosterReady(true);
      return;
    }

    const targetTime = videoPosterTargetRef.current;
    if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.12) return;
    video.pause();
    setIsVideoPosterReady(true);
  }, [isVideoHoverPreviewActive]);

  const handleNodeMouseEnter = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!shouldRenderVideoPreview || !mediaFile) return;
    if (!mediaFile.thumbnailUrl) {
      onRequestThumbnail(mediaFile.id);
    }
    setIsVideoHoverPreviewActive(true);
    applyVideoScrubRatio(getPointerRatioInElement(event));
  }, [applyVideoScrubRatio, mediaFile, onRequestThumbnail, shouldRenderVideoPreview]);

  const handleNodeMouseMove = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!shouldRenderVideoPreview || !mediaFile) return;
    if (!isVideoHoverPreviewActive) {
      setIsVideoHoverPreviewActive(true);
    }
    applyVideoScrubRatio(getPointerRatioInElement(event));
  }, [applyVideoScrubRatio, isVideoHoverPreviewActive, mediaFile, shouldRenderVideoPreview]);

  const handleNodeMouseLeave = React.useCallback(() => {
    videoScrubRatioRef.current = null;
    setVideoScrubRatio(0.5);
    const video = videoPreviewRef.current;
    if (video) {
      video.pause();
      const videoDuration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : mediaFile?.duration ?? 0;
      const targetTime = getMediaBoardVideoPosterTime(videoDuration);
      if (targetTime > 0) {
        try {
          video.currentTime = targetTime;
        } catch {
          // Keep the last scrubbed frame when the browser cannot seek back yet.
        }
      }
    }
    setIsVideoHoverPreviewActive(false);
  }, [mediaFile?.duration]);

  if (
    isFolderNode
    || (
      renderLod.overviewCanvas
      && !isSelected
      && !placement.isDraggingPreview
      && !shouldRenderVideoPosterFallback
    )
  ) {
    return null;
  }

  return (
    <div
      key={item.id}
      data-item-id={item.id}
      data-board-group-key={getMediaBoardOrderKey(placement.groupId)}
      data-media-panel-anim-id={item.id}
      className={[
        'media-board-node',
        isSelected ? 'selected' : '',
        mediaFile && mediaNeedsRelink(mediaFile) ? 'no-file' : '',
        importProgress !== null ? 'importing' : '',
        isTextItem ? 'text' : '',
        placement.isDraggingPreview ? 'drag-source-preview' : '',
        isCompactNode ? 'lod-compact' : '',
        thumbUrl && !shouldRenderThumb ? 'lod-thumbnail-paused' : '',
        shouldRenderVideoPreview ? 'has-video-preview' : '',
        shouldRenderVideoPosterFallback ? 'video-poster-fallback' : '',
        shouldRenderVideoPosterFallback && renderLod.overviewCanvas ? 'overview-video-fallback' : '',
        isVideoHoverPreviewActive ? 'video-preview-active' : '',
        isVideoPosterReady ? 'video-poster-ready' : '',
        shouldRenderFocusedOriginal ? 'original-focused' : '',
        mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id) ? 'search-dimmed' : '',
      ].filter(Boolean).join(' ')}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        borderTopColor: labelHex === 'transparent' ? 'var(--border-color)' : labelHex,
        '--media-board-video-scrub-ratio': videoScrubRatio,
        ...stickyOverlayStyle,
      } as React.CSSProperties}
      title={isFocusedOriginal ? undefined : title}
      onMouseEnter={handleNodeMouseEnter}
      onMouseMove={handleNodeMouseMove}
      onMouseLeave={handleNodeMouseLeave}
      onMouseDown={(e) => onNodeMouseDown(e, item)}
      onDoubleClick={() => { onItemDoubleClick(item); }}
      onContextMenu={(e) => {
        if (consumeSuppressedContextMenu()) {
          e.preventDefault();
          return;
        }
        onItemContextMenu(e, item.id);
      }}
    >
      <div className="media-board-node-thumb">
        {isSolidItem && solidItem ? (
          <div className="media-board-solid-preview" style={{ backgroundColor: solidItem.color }} />
        ) : textItem ? (
          <div className="media-board-text-preview" style={{ color: textItem.color, fontFamily: textItem.fontFamily }}>
            {textItem.text}
          </div>
        ) : shouldRenderVideoPreview && mediaFile ? (
          <>
            {shouldRenderThumb ? (
              <img
                className="media-board-node-thumb-image media-board-node-video-poster"
                src={thumbUrl}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
                onError={() => { void refreshFileUrls(mediaFile.id); }}
              />
            ) : (
              <div className="media-board-node-placeholder media-board-node-video-placeholder">
                <FileTypeIcon type="video" large />
              </div>
            )}
            {shouldRenderVideoElement ? (
              <video
                ref={videoPreviewRef}
                className="media-board-node-video-preview"
                src={videoPreviewUrl ?? undefined}
                poster={thumbUrl}
                muted
                playsInline
                loop
                preload={isVideoHoverPreviewActive || shouldRenderVideoPosterFallback ? 'auto' : 'metadata'}
                draggable={false}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onLoadedData={handleVideoLoadedData}
                onSeeked={handleVideoLoadedData}
                onError={() => { void refreshFileUrls(mediaFile.id); }}
              />
            ) : null}
            <span className="media-board-video-scrub-indicator" aria-hidden="true" />
          </>
        ) : shouldRenderThumb || shouldRenderFocusedOriginal ? (
          <>
            {shouldRenderThumb ? (
              <img
                className="media-board-node-thumb-image"
                src={thumbUrl}
                alt=""
                draggable={false}
                loading="eager"
                decoding="async"
                onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
              />
            ) : null}
            {shouldRenderFocusedOriginal ? (
              <img
                className="media-board-node-original-image"
                src={originalUrl ?? undefined}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={mediaFile ? () => { void refreshFileUrls(mediaFile.id); } : undefined}
              />
            ) : null}
          </>
        ) : (
          <div className="media-board-node-placeholder">
            <FileTypeIcon type={isComp ? 'composition' : getProjectItemIconType(item)} large />
          </div>
        )}
        {!isCompactNode && duration ? <span className="media-board-duration">{formatDuration(duration)}</span> : null}
        {!isCompactNode && importProgress !== null ? <span className="media-board-progress">{importProgress}%</span> : null}
        {!isCompactNode && importProgress === null && waveformProgress !== null ? (
          <span className="media-board-waveform-progress" title={`Generating waveform: ${waveformProgress}%`}>
            <span className="waveform-progress-mark">W</span>
            <span>{waveformProgress}%</span>
          </span>
        ) : null}
      </div>
      {!isCompactNode ? (
        <div className="media-board-node-body">
          <div className="media-board-node-name">{item.name}</div>
          <div className="media-board-node-meta">
            <span>{getMediaBoardTypeLabel(item)}</span>
            {resolutionLabel ? <span>{resolutionLabel}</span> : null}
            {boardCodecLabel ? <span>{boardCodecLabel}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MediaBoardView({
  wrapperRef,
  canvasRef,
  canvasInnerRef,
  overviewCanvasRef,
  viewport,
  renderLod,
  overviewCanvasStyle,
  isMediaSearchActive,
  mediaSearchResultCount,
  totalItems,
  itemCount,
  folderCount,
  folders,
  visibleGroups,
  visibleInsertGaps,
  visiblePlacements,
  visibleRect,
  focusedOriginalMediaId,
  videoPosterFallbackIds,
  marquee,
  selectedIdSet,
  mediaSearchVisibleItemIds,
  renamingId,
  renameValue,
  onRenameValueChange,
  onFinishRename,
  onCancelRename,
  onStartRename,
  onOpenAI,
  onResetLayout,
  onCanvasWheel,
  onCanvasMouseDown,
  onCanvasDoubleClick,
  onCanvasContextMenu,
  onCanvasDragOver,
  onCanvasDragLeave,
  onCanvasDrop,
  onNodeMouseDown,
  onItemDoubleClick,
  onItemContextMenu,
  consumeSuppressedContextMenu,
  onGroupDragOver,
  onGroupDrop,
  onRequestThumbnail,
  refreshFileUrls,
  buildTooltip,
  formatDuration,
  getProjectItemIconType,
  getGaussianSplatResolutionLabel,
  getMediaFileContainerLabel,
  getMediaFileCodecLabel,
  children,
}: MediaBoardViewProps) {
  return (
    <div
      className="media-board-wrapper"
      ref={wrapperRef}
      style={{
        '--media-board-grid-x': `${viewport.panX * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-y': `${viewport.panY * MEDIA_BOARD_GRID_PARALLAX}px`,
        '--media-board-grid-size': `${getMediaBoardGridSize(viewport.zoom)}px`,
      } as React.CSSProperties}
    >
      <div className="media-board-toolbar">
        <div className="media-board-toolbar-title">
          <span>Board</span>
          <span>
            {isMediaSearchActive
              ? `${mediaSearchResultCount} of ${totalItems} items`
              : `${itemCount} items in ${folderCount} folders`}
          </span>
        </div>
        <div className="media-board-toolbar-actions">
          <button
            className="btn btn-sm"
            onClick={onOpenAI}
            title="Expand AI generator"
          >
            Generate
          </button>
          <button className="btn btn-sm" onClick={onResetLayout} title="Reset board layout">
            Reset
          </button>
        </div>
      </div>
      <div
        ref={canvasRef}
        className="media-board-canvas"
        onWheel={onCanvasWheel}
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={onCanvasDoubleClick}
        onContextMenu={onCanvasContextMenu}
        onDragOver={onCanvasDragOver}
        onDragLeave={onCanvasDragLeave}
        onDrop={onCanvasDrop}
      >
        <div
          ref={canvasInnerRef}
          className="media-board-canvas-inner"
          style={{
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
            '--media-board-ui-scale': getMediaBoardUiScale(viewport.zoom),
          } as React.CSSProperties}
        >
          {renderLod.overviewCanvas ? (
            <canvas
              ref={overviewCanvasRef}
              className="media-board-overview-canvas"
              style={overviewCanvasStyle}
              aria-hidden="true"
            />
          ) : null}
          {visibleGroups.filter((group) => group.id !== null).map((group) => {
            const folder = group.id ? folders.find((candidate) => candidate.id === group.id) : null;
            if (!folder) return null;
            const isRenamingGroup = group.id !== null && renamingId === group.id;
            return (
              <div
                key={group.id ?? 'root'}
                className={[
                  'media-board-group',
                  'folder-group',
                  `depth-${Math.min(group.depth, 3)}`,
                  selectedIdSet.has(folder.id) ? 'selected' : '',
                  group.isDraggingPreview ? 'drag-source-preview' : '',
                  mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(folder.id) ? 'search-dimmed' : '',
                ].filter(Boolean).join(' ')}
                data-item-id={folder.id}
                data-board-group-key={getMediaBoardOrderKey(group.id)}
                data-media-panel-anim-id={group.id ?? undefined}
                draggable={false}
                style={{
                  left: group.x,
                  top: group.y,
                  width: group.width,
                  height: group.height,
                }}
                onMouseDown={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('input, button')) return;
                  onNodeMouseDown(e, folder);
                }}
                onDoubleClick={() => { onItemDoubleClick(folder); }}
                onContextMenu={(e) => {
                  if (consumeSuppressedContextMenu()) {
                    e.preventDefault();
                    return;
                  }
                  onItemContextMenu(e, folder.id);
                }}
                onDragOver={onGroupDragOver}
                onDrop={(e) => onGroupDrop(e, group.id)}
              >
                <div className="media-board-group-header">
                  {isRenamingGroup ? (
                    <input
                      className="media-board-group-rename"
                      value={renameValue}
                      size={Math.max(1, renameValue.length)}
                      style={{ width: `${Math.max(4, renameValue.length + 1)}ch` }}
                      onChange={(e) => onRenameValueChange(e.target.value)}
                      onBlur={onFinishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onFinishRename();
                        if (e.key === 'Escape') onCancelRename();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span
                      title={group.name}
                      onDoubleClick={(e) => {
                        if (!group.id) return;
                        e.stopPropagation();
                        onStartRename(group.id, folder?.name ?? group.name);
                      }}
                    >
                      {group.name}
                    </span>
                  )}
                  <span>{group.itemCount}</span>
                </div>
              </div>
            );
          })}
          {visibleInsertGaps.map((gap) => (
            <div
              key={gap.id}
              className="media-board-insert-gap"
              style={{
                left: gap.layout.x,
                top: gap.layout.y,
                width: gap.layout.width,
                height: gap.layout.height,
              }}
            />
          ))}
          {visiblePlacements.map((placement) => (
            <MediaBoardNode
              key={placement.item.id}
              placement={placement}
              renderLod={renderLod}
              viewport={viewport}
              visibleRect={visibleRect}
              focusedOriginalMediaId={focusedOriginalMediaId}
              videoPosterFallbackIds={videoPosterFallbackIds}
              selectedIdSet={selectedIdSet}
              mediaSearchVisibleItemIds={mediaSearchVisibleItemIds}
              onNodeMouseDown={onNodeMouseDown}
              onItemDoubleClick={onItemDoubleClick}
              onItemContextMenu={onItemContextMenu}
              consumeSuppressedContextMenu={consumeSuppressedContextMenu}
              onRequestThumbnail={onRequestThumbnail}
              refreshFileUrls={refreshFileUrls}
              buildTooltip={buildTooltip}
              formatDuration={formatDuration}
              getProjectItemIconType={getProjectItemIconType}
              getGaussianSplatResolutionLabel={getGaussianSplatResolutionLabel}
              getMediaFileContainerLabel={getMediaFileContainerLabel}
              getMediaFileCodecLabel={getMediaFileCodecLabel}
            />
          ))}
          {children}
          {marquee && (() => {
            const left = Math.min(marquee.startX, marquee.currentX);
            const top = Math.min(marquee.startY, marquee.currentY);
            const width = Math.abs(marquee.currentX - marquee.startX);
            const height = Math.abs(marquee.currentY - marquee.startY);
            if (width < 2 && height < 2) return null;
            return (
              <div
                className="media-board-marquee"
                style={{ left, top, width, height }}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
