import { useTimelineSectionController } from './useTimelineSectionController';
import { useTimelineTrackHeightWheel } from './useTimelineTrackHeightWheel';
import { useTimelineTrackVisibilityState } from './useTimelineTrackVisibilityState';

type SectionParams = Parameters<typeof useTimelineSectionController>[0];
type SectionState = ReturnType<typeof useTimelineSectionController>;
type VisibilityState = ReturnType<typeof useTimelineTrackVisibilityState>;

interface UseTimelineTrackStackControllerReturn extends SectionState, VisibilityState {
  handleTrackHeightWheel: ReturnType<typeof useTimelineTrackHeightWheel>;
}

export function useTimelineTrackStackController(
  params: SectionParams,
): UseTimelineTrackStackControllerReturn {
  const visibility = useTimelineTrackVisibilityState({
    tracks: params.tracks,
    timelineViewTracks: params.timelineViewTracks,
  });

  const section = useTimelineSectionController(params);
  const handleTrackHeightWheel = useTimelineTrackHeightWheel({
    trackMap: params.trackMap,
    onSynchronousTrackScaleStep: section.handleSynchronousTrackScaleStep,
  });

  return {
    ...visibility,
    ...section,
    handleTrackHeightWheel,
  };
}
