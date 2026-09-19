import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { liveInputRuntime } from '../../../../services/mediaRuntime/liveInputRuntime';
import type { Composition, MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import type { TimelineClip } from '../../../../types/timeline';
import { CompositionHoverPreview } from '../CompositionHoverPreview';
import { LiveInputPreviewCanvas } from '../LiveInputPreviewCanvas';
import { isImportedMediaFileItem } from '../itemTypeGuards';

const HOVER_REST_MS = 400;
const TOOLTIP_EXIT_MS = 100;
const TOOLTIP_GAP = 18;
const TOOLTIP_WIDTH = 240;
const TOOLTIP_HEIGHT = 170;
const VIEWPORT_PADDING = 8;

interface MediaPanelPreviewTooltipState {
  composition: Composition | null;
  isVideo: boolean;
  itemId: string;
  left: number;
  liveInputId: string | null;
  name: string;
  src: string;
  top: number;
  visible: boolean;
}

interface UseMediaPanelPreviewTooltipInput {
  activeCompositionId?: string | null;
  activeTimelineClips?: readonly TimelineClip[];
  itemsById: Map<string, ProjectItem>;
  mediaFiles?: readonly MediaFile[];
}

export function getMediaPanelPreviewSource(item: ProjectItem | undefined): string | null {
  if (!item || !isImportedMediaFileItem(item) || item.isImporting) {
    return null;
  }

  if (item.liveInput) return null;
  if (item.type === 'video') return item.proxyVideoUrl || item.url || null;
  return item.thumbnailUrl || (item.type === 'image' ? item.url : null);
}

export function getMediaPanelLivePreviewId(item: ProjectItem | undefined): string | null {
  return item && isImportedMediaFileItem(item) && item.liveInput && !item.isImporting
    ? item.id
    : null;
}

export function getMediaPanelPreviewTooltipPosition(
  clientX: number,
  clientY: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : TOOLTIP_WIDTH,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : TOOLTIP_HEIGHT,
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - TOOLTIP_WIDTH - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - TOOLTIP_HEIGHT - VIEWPORT_PADDING);
  const rightSideLeft = clientX + TOOLTIP_GAP;
  const lowerTop = clientY + TOOLTIP_GAP;
  const left = rightSideLeft > maxLeft ? clientX - TOOLTIP_WIDTH - TOOLTIP_GAP : rightSideLeft;
  const top = lowerTop > maxTop ? clientY - TOOLTIP_HEIGHT - TOOLTIP_GAP : lowerTop;

  return {
    left: Math.max(VIEWPORT_PADDING, Math.min(maxLeft, left)),
    top: Math.max(VIEWPORT_PADDING, Math.min(maxTop, top)),
  };
}

export function useMediaPanelPreviewTooltip({
  activeCompositionId,
  activeTimelineClips = [],
  itemsById,
  mediaFiles = [],
}: UseMediaPanelPreviewTooltipInput): {
  dismissItemPreview: (itemId: string) => void;
  element: ReactNode;
  handleMouseLeave: () => void;
  handleMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
} {
  const [tooltip, setTooltip] = useState<MediaPanelPreviewTooltipState | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<MediaPanelPreviewTooltipState | null>(null);
  const suppressedItemIdRef = useRef<string | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearShowTimer();
    pendingRef.current = null;
    setTooltip((current) => current ? { ...current, visible: false } : null);
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => setTooltip(null), TOOLTIP_EXIT_MS);
  }, [clearHideTimer, clearShowTimer]);

  const scheduleShow = useCallback((pending: MediaPanelPreviewTooltipState) => {
    clearHideTimer();
    clearShowTimer();
    pendingRef.current = pending;
    showTimerRef.current = window.setTimeout(() => {
      const current = pendingRef.current;
      if (
        !current ||
        current.itemId !== pending.itemId ||
        current.src !== pending.src ||
        current.liveInputId !== pending.liveInputId
      ) {
        return;
      }

      setTooltip({ ...current, visible: true });
    }, HOVER_REST_MS);
  }, [clearHideTimer, clearShowTimer]);

  const showImmediately = useCallback((next: MediaPanelPreviewTooltipState) => {
    clearHideTimer();
    clearShowTimer();
    pendingRef.current = next;
    setTooltip({ ...next, visible: true });
  }, [clearHideTimer, clearShowTimer]);

  const handleMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.buttons !== 0 || !(event.target instanceof Element)) {
      hide();
      return;
    }

    const itemNode = event.target.closest<HTMLElement>('[data-item-id]');
    const item = itemNode?.dataset.itemId ? itemsById.get(itemNode.dataset.itemId) : undefined;
    if (item?.id === suppressedItemIdRef.current) {
      hide();
      return;
    }
    suppressedItemIdRef.current = null;
    const composition = item && 'type' in item && item.type === 'composition'
      ? item as Composition
      : null;
    const src = getMediaPanelPreviewSource(item);
    const candidateLiveInputId = getMediaPanelLivePreviewId(item);
    const liveInputId = candidateLiveInputId && liveInputRuntime.getVideoElement(candidateLiveInputId)
      ? candidateLiveInputId
      : null;
    if (!item || (!src && !liveInputId && !composition)) {
      hide();
      return;
    }

    const next = {
      composition,
      isVideo: isImportedMediaFileItem(item) && item.type === 'video',
      itemId: item.id,
      liveInputId,
      name: item.name,
      src: src ?? '',
      visible: false,
      ...getMediaPanelPreviewTooltipPosition(event.clientX, event.clientY),
    };

    if (tooltip) {
      showImmediately(next);
      return;
    }

    scheduleShow(next);
  }, [hide, itemsById, scheduleShow, showImmediately, tooltip]);

  const dismissItemPreview = useCallback((itemId: string) => {
    suppressedItemIdRef.current = itemId;
    clearShowTimer();
    clearHideTimer();
    pendingRef.current = null;
    setTooltip(null);
  }, [clearHideTimer, clearShowTimer]);

  const handleMouseLeave = useCallback(() => {
    suppressedItemIdRef.current = null;
    hide();
  }, [hide]);

  useEffect(() => () => {
    clearShowTimer();
    clearHideTimer();
  }, [clearHideTimer, clearShowTimer]);

  return {
    dismissItemPreview,
    element: tooltip ? (
      <div
        aria-hidden="true"
        className={`media-panel-preview-tooltip ${tooltip.visible ? 'visible' : ''}`}
        style={{ left: tooltip.left, top: tooltip.top }}
      >
        {tooltip.composition ? (
          <CompositionHoverPreview
            activeCompositionId={activeCompositionId}
            activeTimelineClips={activeTimelineClips}
            composition={tooltip.composition}
            mediaFiles={mediaFiles}
          />
        ) : tooltip.liveInputId ? (
          <LiveInputPreviewCanvas
            className="media-panel-live-preview"
            liveInputId={tooltip.liveInputId}
          />
        ) : tooltip.isVideo ? (
          <video
            src={tooltip.src}
            autoPlay
            loop
            muted
            playsInline
            onLoadedMetadata={(event) => { event.currentTarget.playbackRate = 2; }}
            onError={hide}
          />
        ) : (
          <img src={tooltip.src} alt="" draggable={false} onError={hide} />
        )}
      </div>
    ) : null,
    handleMouseLeave,
    handleMouseMove,
  };
}
