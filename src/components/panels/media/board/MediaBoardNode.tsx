import React from 'react';
import type { Composition, MediaFile, ProjectItem, SolidItem, TextItem } from '../../../../stores/mediaStore';
import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { FileTypeIcon } from '../FileTypeIcon';
import { LiveInputPreviewCanvas } from '../LiveInputPreviewCanvas';
import { MediaWaveformThumb } from '../MediaWaveformThumb';
import { getItemImportProgress, getItemWaveformProgress, isImportedMediaFileItem } from '../itemTypeGuards';
import { getLabelHex } from '../labelColors';
import { getMediaBoardOrderKey, getMediaBoardTypeLabel, isMediaBoardFolder } from './layout';
import type {
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardVisibleRect,
} from './types';

export interface MediaBoardNodeProps {
  placement: MediaBoardNodePlacement;
  renderLod: MediaBoardRenderLod;
  viewport: MediaBoardViewport;
  visibleRect: MediaBoardVisibleRect;
  focusedOriginalMediaId: string | null;
  videoPosterFallbackIds: Set<string>;
  selectedIdSet: Set<string>;
  mediaSearchVisibleItemIds: Set<string> | null;
  onNodeMouseDown: (e: React.MouseEvent, item: ProjectItem) => void;
  onItemDoubleClick: (item: ProjectItem) => void;
  onItemContextMenu: (e: React.MouseEvent, itemId?: string, parentId?: string | null) => void;
  consumeSuppressedContextMenu: () => boolean;
  onRequestThumbnail: (id: string) => void;
  refreshFileUrls: (id: string) => void | Promise<unknown>;
  buildTooltip: (item: ProjectItem, isFolder: boolean, isComp: boolean) => string;
  formatDuration: (seconds: number) => string;
  getProjectItemIconType: (item: ProjectItem | undefined) => string | undefined;
  getGaussianSplatResolutionLabel: (item: ProjectItem) => string | null;
  getMediaFileContainerLabel: (mediaFile: MediaFile | null) => string | undefined;
  getMediaFileCodecLabel: (mediaFile: MediaFile | null) => string | undefined;
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

export function MediaBoardNode({
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
}: MediaBoardNodeProps) {
  const { item, layout } = placement;

  const isFolderNode = isMediaBoardFolder(item);
  const isSelected = selectedIdSet.has(item.id);
  const isMediaFile = isImportedMediaFileItem(item);
  const mediaFile = isMediaFile ? item : null;
  const isLiveInput = Boolean(mediaFile?.liveInput);
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
      && !isLiveInput
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
        ) : isLiveInput && mediaFile ? (
          <>
            <div className="media-board-node-placeholder media-board-node-video-placeholder">
              <FileTypeIcon type="video" large />
            </div>
            <LiveInputPreviewCanvas
              className="media-board-node-live-preview"
              liveInputId={mediaFile.id}
            />
          </>
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
        ) : mediaFile?.type === 'audio' ? (
          <MediaWaveformThumb mediaFile={mediaFile} />
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
