import type {
  ComponentProps,
  CSSProperties,
  DragEventHandler,
  MutableRefObject,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from 'react';
import { TimelineGlobalOverlayLayers } from './TimelineGlobalOverlayLayers';
import { TimelineInteractionOverlays } from './TimelineInteractionOverlays';
import { TimelineMarkerOverlays } from './TimelineMarkerOverlays';
import { TimelinePlayheadOverlay } from './TimelinePlayheadOverlay';
import { TimelineRulerHeaderChrome } from './TimelineRulerHeaderChrome';
import { TimelineSplitDivider } from './TimelineSplitDivider';
import { StoryboardVariantComparisonTimelineDock } from '../../storyboard/variants';

type TimelineGlobalOverlayLayersProps = ComponentProps<typeof TimelineGlobalOverlayLayers>;
type TimelineInteractionOverlaysProps = ComponentProps<typeof TimelineInteractionOverlays>;
type TimelineMarkerOverlaysProps = ComponentProps<typeof TimelineMarkerOverlays>;
type TimelinePlayheadOverlayProps = ComponentProps<typeof TimelinePlayheadOverlay>;
type TimelineRulerHeaderChromeProps = ComponentProps<typeof TimelineRulerHeaderChrome>;
type TimelineSplitDividerProps = ComponentProps<typeof TimelineSplitDivider>;

interface TimelineBodySurfaceProps {
  activeTimelineToolId: string;
  clipDragActive: boolean;
  globalOverlayProps: TimelineGlobalOverlayLayersProps;
  interactionOverlayProps: TimelineInteractionOverlaysProps;
  isExporting: boolean;
  markerOverlayProps: TimelineMarkerOverlaysProps;
  marqueeActive: boolean;
  onContainerDragLeave: DragEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerLeave: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  playheadOverlayProps: TimelinePlayheadOverlayProps;
  renderAudioSection: () => ReactNode;
  renderVideoSection: () => ReactNode;
  rulerHeaderProps: TimelineRulerHeaderChromeProps;
  scrollWrapperRef: RefObject<HTMLDivElement | null>;
  scrollX: number;
  slotGridProgress: number;
  splitDividerProps: TimelineSplitDividerProps;
  timelineBodyRef: RefObject<HTMLDivElement | null>;
  timelineRef: RefObject<HTMLDivElement | null>;
  timelineSurfaceCursor: CSSProperties['cursor'] | undefined;
  trackHeaderWidth: number;
  trackLanesRef: MutableRefObject<HTMLDivElement | null>;
  zoom: number;
  globalCurveEditor?: ReactNode;
  timelineCurveMode?: 'timeline' | 'graph';
}

export function TimelineBodySurface({
  activeTimelineToolId,
  clipDragActive,
  globalOverlayProps,
  interactionOverlayProps,
  isExporting,
  markerOverlayProps,
  marqueeActive,
  onContainerDragLeave,
  onPointerCancel,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  playheadOverlayProps,
  renderAudioSection,
  renderVideoSection,
  rulerHeaderProps,
  scrollWrapperRef,
  scrollX,
  slotGridProgress,
  splitDividerProps,
  timelineBodyRef,
  timelineRef,
  timelineSurfaceCursor,
  trackHeaderWidth,
  trackLanesRef,
  zoom,
  globalCurveEditor,
  timelineCurveMode = 'timeline',
}: TimelineBodySurfaceProps) {
  const bodyContentStyle: CSSProperties | undefined = slotGridProgress > 0
    ? {
        opacity: 1 - slotGridProgress,
        transform: `scale(${1 - slotGridProgress * 0.05})`,
        transformOrigin: 'center center',
        pointerEvents: slotGridProgress >= 0.5 ? 'none' : 'auto',
        display: slotGridProgress >= 1 ? 'none' : undefined,
        cursor: timelineSurfaceCursor,
      }
    : timelineSurfaceCursor
      ? { cursor: timelineSurfaceCursor }
      : undefined;

  const trackStack = (
    <div
      ref={(el) => {
        trackLanesRef.current = el;
      }}
      className={`timeline-track-stack timeline-tracks ${clipDragActive ? 'dragging-clip' : ''} ${marqueeActive ? 'marquee-selecting' : ''} ${isExporting ? 'export-locked' : ''}`}
      data-ai-id="timeline-tracks"
      data-guided-target="timeline-tracks"
      data-guided-timeline-origin-x={trackHeaderWidth}
      data-guided-timeline-scroll-x={scrollX}
      data-guided-timeline-zoom={zoom}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onContainerDragLeave}
    >
      <div
        ref={timelineRef}
        className="timeline-lane-reference"
        data-guided-target="timeline-lane-reference"
        style={{ left: trackHeaderWidth }}
        aria-hidden="true"
      />
      {renderVideoSection()}
      <TimelineSplitDivider {...splitDividerProps} />
      {renderAudioSection()}
      <TimelineInteractionOverlays {...interactionOverlayProps} />
    </div>
  );

  return (
    <>
      <div className="timeline-body" ref={timelineBodyRef}>
      <div
        className={`timeline-body-content timeline-tool-active-${activeTimelineToolId}`}
        style={bodyContentStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
      >
        <TimelineRulerHeaderChrome {...rulerHeaderProps} />

        <div
          className={`timeline-scroll-wrapper${timelineCurveMode === 'graph' ? ' graph-mode' : ''}`}
          ref={scrollWrapperRef}
        >
          {timelineCurveMode === 'graph' ? (
            <div className="timeline-graph-layout">
              <div className="timeline-graph-track-band">{trackStack}</div>
              {globalCurveEditor}
            </div>
          ) : trackStack}
        </div>

        <TimelineGlobalOverlayLayers {...globalOverlayProps} />
        <TimelinePlayheadOverlay {...playheadOverlayProps} />
        <TimelineMarkerOverlays {...markerOverlayProps} />
        </div>
      </div>
      <StoryboardVariantComparisonTimelineDock />
    </>
  );
}
