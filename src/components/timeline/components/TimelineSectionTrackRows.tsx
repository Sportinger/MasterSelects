import { memo } from 'react';
import type { TimelineClip, TimelineTrack as TimelineTrackType } from '../../../types';
import type { TimelineClipDragPreview } from '../../../stores/timeline/types';
import type { TrackSectionKind } from '../utils/timelineHostTypes';
import type {
  ClipDragState,
  ClipFadeState,
  ClipTrimState,
  ContextMenuState,
  ExternalDragState,
  TimelineTrackProps,
} from '../types';
import { TimelineTrack } from '../TimelineTrack';
import { TimelineTrackViewport } from './TimelineTrackViewport';
import {
  getResolveTimelineTrackColor,
  getTimelineTrackColor,
  TIMELINE_TRACK_COLOR_HIDDEN,
} from '../trackColor';
import { useSettingsStore } from '../../../stores/settingsStore';
import { isAudioSectionTrackType } from '../utils/trackSection';
import {
  clipDragAffectsTrack,
  clipDragPreviewAffectsTrack,
  clipTrimAffectsTrack,
} from '../utils/timelineHostLayout';

interface TimelineSectionTrackRowsProps {
  activeTimelineToolId: TimelineTrackProps['activeTimelineToolId'];
  activeTrackResizeId: string | null;
  anyViewAudioSolo: boolean;
  anyViewVideoSolo: boolean;
  applyTimelineEditOperation: NonNullable<TimelineTrackProps['applyTimelineEditOperation']>;
  audioDisplayMode: TimelineTrackProps['audioDisplayMode'];
  audioRegionGainPreview: TimelineTrackProps['audioRegionGainPreview'];
  audioRegionSelection: TimelineTrackProps['audioRegionSelection'];
  audioSpectralRegionSelection: TimelineTrackProps['audioSpectralRegionSelection'];
  clipDrag: ClipDragState | null;
  clipDragPreview: TimelineClipDragPreview | null;
  clipFade: ClipFadeState | null;
  clipKeyframes: TimelineTrackProps['clipKeyframes'];
  clipMap: Map<string, TimelineClip>;
  clips: TimelineClip[];
  clipStemSeparationJobs: TimelineTrackProps['clipStemSeparationJobs'];
  clipTrim: ClipTrimState | null;
  contextMenu: ContextMenuState | null;
  expandedCurveProperties: TimelineTrackProps['expandedCurveProperties'];
  externalDrag: ExternalDragState | null;
  getSectionTrackBaseHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  getSectionTrackHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  isCompositionTrackMorphing: boolean;
  isTrackExpandedForRender: (trackId: string) => boolean;
  onAddKeyframe: TimelineTrackProps['addKeyframe'];
  onClipContextMenu: TimelineTrackProps['onClipContextMenu'];
  onClipDoubleClick: TimelineTrackProps['onClipDoubleClick'];
  onClipMouseDown: TimelineTrackProps['onClipMouseDown'];
  onCombinedDragLeave: TimelineTrackProps['onDragLeave'];
  onCombinedDragOver: (event: React.DragEvent, trackId: string) => void;
  onCombinedDrop: (event: React.DragEvent, trackId: string) => void;
  onEmptyContextMenu: TimelineTrackProps['onEmptyContextMenu'];
  onEmptyMouseDown: TimelineTrackProps['onEmptyMouseDown'];
  onFadeStart: TimelineTrackProps['onFadeStart'];
  onMoveKeyframe: TimelineTrackProps['onMoveKeyframe'];
  onMoveKeyframeGroup: TimelineTrackProps['onMoveKeyframeGroup'];
  onSelectKeyframe: TimelineTrackProps['onSelectKeyframe'];
  onTrackDragEnter: (event: React.DragEvent, trackId: string) => void;
  onTrackResizeStart: NonNullable<TimelineTrackProps['onResizeStart']>;
  onTrimStart: TimelineTrackProps['onTrimStart'];
  onUpdateBezierHandle: TimelineTrackProps['onUpdateBezierHandle'];
  pixelToTime: TimelineTrackProps['pixelToTime'];
  renderKeyframeDiamonds: TimelineTrackProps['renderKeyframeDiamonds'];
  scrollX: number;
  sectionKind: TrackSectionKind;
  sectionTracks: TimelineTrackType[];
  selectedClipIds: Set<string>;
  selectedKeyframeIds: Set<string>;
  timeToPixel: TimelineTrackProps['timeToPixel'];
  timelineTrackColorsVisible: boolean;
  videoBakeRegionSelection: TimelineTrackProps['videoBakeRegionSelection'];
  waveformsEnabled: boolean;
  zoom: number;
}

export const TimelineSectionTrackRows = memo(function TimelineSectionTrackRows({
  activeTimelineToolId,
  activeTrackResizeId,
  anyViewAudioSolo,
  anyViewVideoSolo,
  applyTimelineEditOperation,
  audioDisplayMode,
  audioRegionGainPreview,
  audioRegionSelection,
  audioSpectralRegionSelection,
  clipDrag,
  clipDragPreview,
  clipFade,
  clipKeyframes,
  clipMap,
  clips,
  clipStemSeparationJobs,
  clipTrim,
  contextMenu,
  expandedCurveProperties,
  externalDrag,
  getSectionTrackBaseHeight,
  getSectionTrackHeight,
  isCompositionTrackMorphing,
  isTrackExpandedForRender,
  onAddKeyframe,
  onClipContextMenu,
  onClipDoubleClick,
  onClipMouseDown,
  onCombinedDragLeave,
  onCombinedDragOver,
  onCombinedDrop,
  onEmptyContextMenu,
  onEmptyMouseDown,
  onFadeStart,
  onMoveKeyframe,
  onMoveKeyframeGroup,
  onSelectKeyframe,
  onTrackDragEnter,
  onTrackResizeStart,
  onTrimStart,
  onUpdateBezierHandle,
  pixelToTime,
  renderKeyframeDiamonds,
  scrollX,
  sectionKind,
  sectionTracks,
  selectedClipIds,
  selectedKeyframeIds,
  timeToPixel,
  timelineTrackColorsVisible,
  videoBakeRegionSelection,
  waveformsEnabled,
  zoom,
}: TimelineSectionTrackRowsProps) {
  const resolveThemeActive = useSettingsStore((state) => state.theme === 'resolve');

  return (
    <>
      {sectionTracks.map((track, trackIndex) => {
        const isDimmed =
          (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
          (isAudioSectionTrackType(track.type) && anyViewAudioSolo && !track.solo);
        const trackClipDrag = clipDragAffectsTrack(clipDrag, track.id, clipMap)
          ? clipDrag
          : null;
        const trackClipDragPreview = clipDragPreviewAffectsTrack(clipDragPreview, track.id, clipMap)
          ? clipDragPreview
          : null;
        const trackClipTrim = clipTrimAffectsTrack(clipTrim, track.id, clipMap)
          ? clipTrim
          : null;
        const trackClipFade = clipFade && clipMap.get(clipFade.clipId)?.trackId === track.id
          ? clipFade
          : null;
        const trackClipContextMenu = contextMenu && clipMap.get(contextMenu.clipId)?.trackId === track.id
          ? contextMenu
          : null;

        return (
          <TimelineTrackViewport key={track.id}
            enabled={sectionTracks.length > 8}
            forceVisible={Boolean(trackClipDrag || trackClipTrim || trackClipFade
              || activeTrackResizeId === track.id || isCompositionTrackMorphing)}
            height={getSectionTrackHeight(track, sectionKind)} trackId={track.id}>
          <TimelineTrack
            key={track.id}
            track={track}
            trackColor={timelineTrackColorsVisible
              ? resolveThemeActive
                ? getResolveTimelineTrackColor(track, trackIndex)
                : getTimelineTrackColor(track, trackIndex)
              : TIMELINE_TRACK_COLOR_HIDDEN}
            clips={isCompositionTrackMorphing ? [] : clips}
            isDimmed={isDimmed}
            isExpanded={isTrackExpandedForRender(track.id)}
            baseHeight={getSectionTrackBaseHeight(track, sectionKind)}
            dynamicHeight={getSectionTrackHeight(track, sectionKind)}
            isDragTarget={clipDrag?.currentTrackId === track.id}
            isExternalDragTarget={
              externalDrag?.trackId === track.id ||
              externalDrag?.audioTrackId === track.id ||
              externalDrag?.videoTrackId === track.id
            }
            selectedClipIds={selectedClipIds}
            selectedKeyframeIds={selectedKeyframeIds}
            activeTimelineToolId={activeTimelineToolId}
            waveformsEnabled={waveformsEnabled}
            audioDisplayMode={audioDisplayMode}
            isClipDragActive={clipDrag !== null}
            clipDrag={trackClipDrag}
            clipDragPreview={trackClipDragPreview}
            clipTrim={trackClipTrim}
            clipFade={trackClipFade}
            clipContextMenu={trackClipContextMenu}
            audioRegionSelection={audioRegionSelection}
            audioRegionGainPreview={audioRegionGainPreview}
            audioSpectralRegionSelection={audioSpectralRegionSelection}
            videoBakeRegionSelection={videoBakeRegionSelection}
            clipStemSeparationJobs={clipStemSeparationJobs}
            externalDrag={externalDrag}
            zoom={zoom}
            scrollX={scrollX}
            onClipMouseDown={onClipMouseDown}
            onClipDoubleClick={onClipDoubleClick}
            onClipContextMenu={onClipContextMenu}
            onEmptyMouseDown={onEmptyMouseDown}
            onEmptyContextMenu={onEmptyContextMenu}
            onFadeStart={onFadeStart}
            onTrimStart={onTrimStart}
            onDrop={onCombinedDrop}
            onDragOver={onCombinedDragOver}
            onDragEnter={onTrackDragEnter}
            onDragLeave={onCombinedDragLeave}
            onResizeStart={onTrackResizeStart}
            isResizeActive={activeTrackResizeId === track.id}
            clipKeyframes={clipKeyframes}
            renderKeyframeDiamonds={renderKeyframeDiamonds}
            timeToPixel={timeToPixel}
            pixelToTime={pixelToTime}
            expandedCurveProperties={expandedCurveProperties}
            onSelectKeyframe={onSelectKeyframe}
            onMoveKeyframe={onMoveKeyframe}
            onMoveKeyframeGroup={onMoveKeyframeGroup}
            applyTimelineEditOperation={applyTimelineEditOperation}
            onUpdateBezierHandle={onUpdateBezierHandle}
            addKeyframe={onAddKeyframe}
          />
          </TimelineTrackViewport>
        );
      })}
    </>
  );
});
