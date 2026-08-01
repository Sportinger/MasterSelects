import type { TimelineGridPlan } from '../utils/timelineGrid';
import { useTimelineClipMediaLookup } from './useTimelineClipMediaLookup';
import { useTimelineKeyframeDiamondsRenderer } from './useTimelineKeyframeDiamondsRenderer';
import { useTimelineTrackSectionRenderers } from './useTimelineTrackSectionRenderers';

type TrackSectionParams = Parameters<typeof useTimelineTrackSectionRenderers>[0];
type KeyframeRendererParams = Parameters<typeof useTimelineKeyframeDiamondsRenderer>[0];
type MediaFiles = Parameters<typeof useTimelineClipMediaLookup>[0];
type BakeRegionId = Parameters<TrackSectionParams['onBakeRegion']>[0];

interface UseTimelineTrackSectionSurfaceControllerParams extends Omit<
  TrackSectionParams,
  | 'clipDragActive'
  | 'frameGridOpacity'
  | 'frameIntervalPixels'
  | 'getMediaFileForClip'
  | 'gridMode'
  | 'hoveredKeyframeRow'
  | 'marqueeActive'
  | 'onBakeRegion'
  | 'onKeyframeRowHover'
  | 'renderKeyframeDiamonds'
  | 'timeGridOpacity'
> {
  bakeCompositionVideoBakeRegion: (regionId: BakeRegionId) => unknown;
  gridPlan: TimelineGridPlan;
  marquee: unknown;
  mediaFiles: MediaFiles;
  onDeleteKeyframes: KeyframeRendererParams['onDeleteKeyframes'];
  onUpdateKeyframe: KeyframeRendererParams['onUpdateKeyframe'];
}

export function useTimelineTrackSectionSurfaceController({
  bakeCompositionVideoBakeRegion,
  clipDrag,
  clipKeyframes,
  clips,
  gridPlan,
  marquee,
  mediaFiles,
  onDeleteKeyframes,
  onMoveKeyframe,
  onSelectKeyframe,
  onToggleCurveExpanded,
  onUpdateKeyframe,
  pixelToTime,
  scrollX,
  selectedKeyframeIds,
  timelineRef,
  timeToPixel,
  ...trackSectionParams
}: UseTimelineTrackSectionSurfaceControllerParams): ReturnType<typeof useTimelineTrackSectionRenderers> {
  const {
    handleKeyframeRowHover,
    hoveredKeyframeRow,
    renderKeyframeDiamonds,
  } = useTimelineKeyframeDiamondsRenderer({
    clipDrag,
    clipKeyframes,
    clips,
    onDeleteKeyframes,
    onMoveKeyframe,
    onSelectKeyframe,
    onToggleCurveExpanded,
    onUpdateKeyframe,
    pixelToTime,
    scrollX,
    selectedKeyframeIds,
    timelineRef,
    timeToPixel,
  });

  const getMediaFileForClip = useTimelineClipMediaLookup(mediaFiles);

  return useTimelineTrackSectionRenderers({
    ...trackSectionParams,
    clipDrag,
    clipDragActive: Boolean(clipDrag),
    clipKeyframes,
    clips,
    frameGridOpacity: gridPlan.frameGridOpacity,
    frameIntervalPixels: gridPlan.frameIntervalPixels,
    getMediaFileForClip,
    gridMode: gridPlan.mode,
    hoveredKeyframeRow,
    marqueeActive: Boolean(marquee),
    onBakeRegion: (regionId) => {
      void bakeCompositionVideoBakeRegion(regionId);
    },
    onKeyframeRowHover: handleKeyframeRowHover,
    onMoveKeyframe,
    onSelectKeyframe,
    onToggleCurveExpanded,
    pixelToTime,
    renderKeyframeDiamonds,
    scrollX,
    selectedKeyframeIds,
    timeGridOpacity: gridPlan.timeGridOpacity,
    timelineRef,
    timeToPixel,
  });
}
