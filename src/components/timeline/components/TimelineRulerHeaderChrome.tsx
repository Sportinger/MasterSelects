import type { ComponentProps, CSSProperties, PointerEvent } from 'react';
import { TimelineControls } from '../TimelineControls';
import { TimelineRuler } from '../TimelineRuler';
import type { TimelineControlsProps } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import {
  selectActiveRulerLaneId,
  selectRulerLanes,
  selectTempoMap,
} from '../../../stores/timeline/selectors';

type TimelineRulerProps = ComponentProps<typeof TimelineRuler>;

const RULER_LANE_HEIGHT_PX = 30;

interface TimelineRulerHeaderChromeProps {
  cacheRanges: TimelineRulerProps['cacheRanges'];
  clipAnimationPhase: string;
  duration: number;
  formatTime: TimelineRulerProps['formatTime'];
  frameRate: TimelineRulerProps['frameRate'];
  isTrackHeaderWidthResizing: boolean;
  onRulerMouseDown: TimelineRulerProps['onRulerMouseDown'];
  onTrackHeaderWidthResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  scrollX: number;
  timelineControlsProps: Omit<TimelineControlsProps, 'variant'>;
  videoBakeRegionSelection: TimelineRulerProps['videoBakeRegionSelection'];
  videoBakeRegions: TimelineRulerProps['videoBakeRegions'];
  zoom: number;
}

export function TimelineRulerHeaderChrome({
  cacheRanges,
  clipAnimationPhase,
  duration,
  formatTime,
  frameRate,
  isTrackHeaderWidthResizing,
  onRulerMouseDown,
  onTrackHeaderWidthResizeStart,
  scrollX,
  timelineControlsProps,
  videoBakeRegionSelection,
  videoBakeRegions,
  zoom,
}: TimelineRulerHeaderChromeProps) {
  // Ruler lanes / tempo map are timeline view state; read them here so the ruler
  // stays a pure props component (issue #257).
  const rulerLanes = useTimelineStore(selectRulerLanes);
  const tempoMap = useTimelineStore(selectTempoMap);
  const activeRulerLaneId = useTimelineStore(selectActiveRulerLaneId);
  const setActiveRulerLane = useTimelineStore((state) => state.setActiveRulerLane);

  // Header + ruler heights track the lane count so the columns stay aligned.
  const laneCount = Math.max(1, rulerLanes.length);
  const rulerHeightStyle = {
    '--timeline-ruler-height': `${laneCount * RULER_LANE_HEIGHT_PX}px`,
  } as CSSProperties;

  return (
    <>
      <div className="timeline-header-row" style={rulerHeightStyle}>
        <div className="ruler-header">
          <div className="timeline-ruler-control-strip">
            <TimelineControls variant="main" {...timelineControlsProps} />
          </div>
        </div>
        <div className={`time-ruler-wrapper ${clipAnimationPhase !== 'idle' ? 'comp-switching' : ''}`}>
          <TimelineRuler
            duration={duration}
            zoom={zoom}
            frameRate={frameRate}
            lanes={rulerLanes}
            tempoMap={tempoMap}
            activeRulerLaneId={activeRulerLaneId}
            onSelectLane={setActiveRulerLane}
            scrollX={scrollX}
            onRulerMouseDown={onRulerMouseDown}
            formatTime={formatTime}
            cacheRanges={cacheRanges}
            videoBakeRegions={videoBakeRegions}
            videoBakeRegionSelection={videoBakeRegionSelection}
          />
        </div>
      </div>

      <div
        className={`timeline-layer-divider-resize-handle ${isTrackHeaderWidthResizing ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize layer column"
        onPointerDown={onTrackHeaderWidthResizeStart}
      />
    </>
  );
}
