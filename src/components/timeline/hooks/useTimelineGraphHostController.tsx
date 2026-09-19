import type { TimelineActionBindings } from './useTimelineActionController';
import type { useTimelineHelpers } from './useTimelineHelpers';
import type { useTimelineRootStoreState } from './useTimelineRootStoreState';
import type { useTimelineTrackStackController } from './useTimelineTrackStackController';
import { CurvesPanel } from '../../panels/curves/CurvesPanel';
import { useTimelineCurveMode } from './useTimelineCurveMode';
import { useTimelineGraphController } from './useTimelineGraphController';
import type { ClipTrimState } from '../types';

interface TimelineGraphHostControllerInput {
  rootState: ReturnType<typeof useTimelineRootStoreState> & { clipTrim: ClipTrimState | null };
  timelineActions: TimelineActionBindings;
  timelineHelpers: ReturnType<typeof useTimelineHelpers>;
  timelineTrackStack: ReturnType<typeof useTimelineTrackStackController>;
}

/** Keeps global graph-mode orchestration out of the Timeline composition root. */
export function useTimelineGraphHostController({
  rootState,
  timelineActions,
  timelineHelpers,
  timelineTrackStack,
}: TimelineGraphHostControllerInput) {
  const {
    timelineCurveMode,
    setTimelineCurveMode,
    toggleTimelineCurveMode,
  } = useTimelineCurveMode();
  const {
    closeTimelineGraph,
    focusTimelineGraphSeries,
    openTimelineGraphForProperty,
    preferredTimelineGraphTarget,
  } = useTimelineGraphController({
    clips: rootState.clips,
    expandedCurveProperties: rootState.expandedCurveProperties,
    selectedClipIds: rootState.selectedClipIds,
    setTimelineCurveMode,
    timelineCurveMode,
    toggleCurveExpanded: timelineActions.toggleCurveExpanded,
  });

  const globalCurveEditor = timelineCurveMode === 'graph' ? (
    <CurvesPanel
      variant="timeline"
      clipTrim={rootState.clipTrim}
      height={Math.max(
        180,
        timelineTrackStack.videoSectionHeight + timelineTrackStack.audioSectionHeight - 100,
      )}
      onActiveSeriesChange={focusTimelineGraphSeries}
      onClose={closeTimelineGraph}
      onScrollChange={timelineActions.setScrollX}
      onZoomChange={timelineActions.setZoom}
      pixelToTime={timelineHelpers.pixelToTime}
      preferredTarget={preferredTimelineGraphTarget}
      scrollX={rootState.scrollX}
      timeToPixel={timelineHelpers.timeToPixel}
      trackHeaderWidth={rootState.trackHeaderWidth}
      width={timelineTrackStack.timelineViewportWidth}
    />
  ) : null;

  return {
    globalCurveEditor,
    openTimelineGraphForProperty,
    timelineCurveMode,
    toggleTimelineCurveMode,
  };
}
