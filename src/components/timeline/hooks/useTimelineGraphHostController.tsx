import type { TimelineActionBindings } from './useTimelineActionController';
import type { useTimelineHelpers } from './useTimelineHelpers';
import type { useTimelineRootStoreState } from './useTimelineRootStoreState';
import type { useTimelineTrackStackController } from './useTimelineTrackStackController';
import { TimelineGlobalCurveSurface } from '../TimelineGlobalCurveSurface';
import { useTimelineCurveMode } from './useTimelineCurveMode';
import { useTimelineGraphController } from './useTimelineGraphController';

interface TimelineGraphHostControllerInput {
  rootState: ReturnType<typeof useTimelineRootStoreState>;
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
    <TimelineGlobalCurveSurface
      activeComposition={rootState.activeComposition}
      applyTimelineEditOperation={timelineActions.applyTimelineEditOperation}
      clipKeyframes={rootState.clipKeyframes}
      clips={rootState.clips}
      height={Math.max(
        180,
        timelineTrackStack.videoSectionHeight + timelineTrackStack.audioSectionHeight - 100,
      )}
      onActiveSeriesChange={focusTimelineGraphSeries}
      onClose={closeTimelineGraph}
      onSelectKeyframe={timelineActions.selectKeyframe}
      pixelToTime={timelineHelpers.pixelToTime}
      preferredTarget={preferredTimelineGraphTarget}
      primaryClipId={rootState.propertiesSelection?.kind === 'clip'
        ? rootState.propertiesSelection.clipId
        : null}
      scrollX={rootState.scrollX}
      selectedClipIds={rootState.selectedClipIds}
      selectedKeyframeIds={rootState.selectedKeyframeIds}
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
