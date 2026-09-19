import { useEffect, useRef, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import { DEFAULT_TRACK_HEADER_WIDTH } from '../../../stores/timeline/constants';
import { useTimelineOverLayout } from '../hooks/useTimelineOverLayout';
import '../ResolveTimeline.css';
import '../MediumMobileTimeline.css';

const RESOLVE_TRACK_HEADER_WIDTH_PX = 180;
const RESOLVE_TRACK_HEIGHT_PX = 50;

interface TimelineRootShellProps {
  activeTrackResizeId: string | null;
  audioDisplayMode: string;
  audioFocusMode: boolean;
  children: ReactNode;
  clipInteractionActive: boolean;
  effectiveAudioLayerAdvancedMode: boolean;
  isHeaderWidthResizing: boolean;
  onMouseDownCapture: MouseEventHandler<HTMLDivElement>;
  openCompositionCount: number;
  splitDragSmoothing: boolean;
  splitDragVideoHeight: number | null;
  trackFocusMode: string;
  trackHeaderWidth: number;
  trackScaleGestureActive: boolean;
}

export function TimelineRootShell({
  activeTrackResizeId,
  audioDisplayMode,
  audioFocusMode,
  children,
  clipInteractionActive,
  effectiveAudioLayerAdvancedMode,
  isHeaderWidthResizing,
  onMouseDownCapture,
  openCompositionCount,
  splitDragSmoothing,
  splitDragVideoHeight,
  trackFocusMode,
  trackHeaderWidth,
  trackScaleGestureActive,
}: TimelineRootShellProps) {
  const resolveThemeActive = useSettingsStore(state => state.theme === 'resolve');
  const setTrackHeaderWidth = useTimelineStore(state => state.setTrackHeaderWidth);
  const tracks = useTimelineStore(state => state.tracks);
  const setTrackHeight = useTimelineStore(state => state.setTrackHeight);
  const expandedTracks = useTimelineStore(state => state.expandedTracks);
  const toggleTrackExpanded = useTimelineStore(state => state.toggleTrackExpanded);
  const resolveWidthInitializedRef = useRef(false);
  const resolveExpansionInitializedRef = useRef(false);
  const resolveTrackHeightInitializedRef = useRef(false);
  const {
    isMediumMobileTimelineLayout,
    isMediumTimelineLayout,
    isMobileTimelineLayout,
  } = useTimelineOverLayout();

  useEffect(() => {
    if (!resolveThemeActive || resolveWidthInitializedRef.current) return;
    resolveWidthInitializedRef.current = true;
    if (trackHeaderWidth === DEFAULT_TRACK_HEADER_WIDTH) {
      setTrackHeaderWidth(RESOLVE_TRACK_HEADER_WIDTH_PX);
    }
  }, [resolveThemeActive, setTrackHeaderWidth, trackHeaderWidth]);

  useEffect(() => {
    if (!resolveThemeActive || resolveTrackHeightInitializedRef.current || tracks.length === 0) return;
    resolveTrackHeightInitializedRef.current = true;
    tracks.forEach((track) => {
      if (track.height <= 70) setTrackHeight(track.id, RESOLVE_TRACK_HEIGHT_PX);
    });
  }, [resolveThemeActive, setTrackHeight, tracks]);

  useEffect(() => {
    if (!resolveThemeActive || resolveExpansionInitializedRef.current || tracks.length === 0) return;
    resolveExpansionInitializedRef.current = true;
    tracks.forEach((track) => {
      if (expandedTracks.has(track.id)) toggleTrackExpanded(track.id);
    });
  }, [expandedTracks, resolveThemeActive, toggleTrackExpanded, tracks]);

  if (openCompositionCount === 0) {
    return (
      <div className={[
        'timeline-container timeline-empty',
        isMobileTimelineLayout ? 'timeline-mobile-layout' : '',
        isMediumTimelineLayout ? 'timeline-medium-layout' : '',
        isMediumMobileTimelineLayout ? 'timeline-medium-mobile-layout' : '',
      ].filter(Boolean).join(' ')}>
        <div className="timeline-empty-message">
          <p>No composition open</p>
          <p className="hint">Double-click a composition in the Media panel to open it</p>
        </div>
      </div>
    );
  }

  const className = [
    'timeline-container',
    `audio-mode-${audioDisplayMode}`,
    `audio-layer-${effectiveAudioLayerAdvancedMode ? 'advanced' : 'basic'}`,
    `timeline-split-mode-${trackFocusMode}`,
    audioFocusMode ? 'audio-focus-mode' : '',
    trackFocusMode === 'video' ? 'video-focus-mode' : '',
    splitDragVideoHeight !== null ? 'is-split-dragging' : '',
    splitDragSmoothing ? 'is-split-drag-smoothing' : '',
    activeTrackResizeId !== null ? 'is-track-resizing' : '',
    trackScaleGestureActive ? 'is-synchronous-track-scaling' : '',
    isHeaderWidthResizing ? 'is-header-width-resizing' : '',
    clipInteractionActive ? 'is-dragging' : '',
    isMobileTimelineLayout ? 'timeline-mobile-layout' : '',
    isMediumTimelineLayout ? 'timeline-medium-layout' : '',
    isMediumMobileTimelineLayout ? 'timeline-medium-mobile-layout' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={{ '--track-header-width': `${trackHeaderWidth}px` } as CSSProperties}
      onMouseDownCapture={onMouseDownCapture}
    >
      {children}
    </div>
  );
}
