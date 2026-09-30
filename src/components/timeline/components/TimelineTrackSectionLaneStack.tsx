import type { ComponentProps } from 'react';
import { VIDEO_NEW_TRACK_PREVIEW_HEIGHT } from '../utils/timelineHostConstants';
import type { TrackSectionKind } from '../utils/timelineHostTypes';
import type { TimelineTrackSectionRenderState } from '../utils/timelineTrackSectionRenderState';
import { TimelineCompositionSectionOverlays } from './TimelineCompositionSectionOverlays';
import { TimelineNewTrackLaneOverlays } from './TimelineNewTrackLaneOverlays';
import { TimelineSectionOverlayGroups } from './TimelineSectionOverlayGroups';
import { TimelineSectionTrackRows } from './TimelineSectionTrackRows';

type CompositionProps = ComponentProps<typeof TimelineCompositionSectionOverlays>;
type NewTrackLaneProps = ComponentProps<typeof TimelineNewTrackLaneOverlays>;
type OverlayGroupsProps = ComponentProps<typeof TimelineSectionOverlayGroups>;
type TrackRowsProps = ComponentProps<typeof TimelineSectionTrackRows>;

interface TimelineTrackSectionLaneStackProps {
  activeJunction: OverlayGroupsProps['activeJunction'];
  activeTimelineToolId: TrackRowsProps['activeTimelineToolId'];
  activeTrackResizeId: TrackRowsProps['activeTrackResizeId'];
  anyViewAudioSolo: TrackRowsProps['anyViewAudioSolo'];
  anyViewVideoSolo: TrackRowsProps['anyViewVideoSolo'];
  applyTimelineEditOperation: TrackRowsProps['applyTimelineEditOperation'];
  audioDisplayMode: TrackRowsProps['audioDisplayMode'];
  audioNewTrackPreviewHeight: NewTrackLaneProps['audioPreviewHeight'];
  audioRegionGainPreview: TrackRowsProps['audioRegionGainPreview'];
  audioRegionSelection: TrackRowsProps['audioRegionSelection'];
  audioSpectralRegionSelection: TrackRowsProps['audioSpectralRegionSelection'];
  clipAnimationPhase: CompositionProps['clipAnimationPhase'];
  clipDrag: TrackRowsProps['clipDrag'];
  clipDragNewTrackType: NewTrackLaneProps['clipDragNewTrackType'];
  clipDragPreview: TrackRowsProps['clipDragPreview'];
  clipFade: TrackRowsProps['clipFade'];
  clipKeyframes: TrackRowsProps['clipKeyframes'];
  clipMap: TrackRowsProps['clipMap'];
  clips: TrackRowsProps['clips'];
  clipStemSeparationJobs: TrackRowsProps['clipStemSeparationJobs'];
  clipTrim: TrackRowsProps['clipTrim'];
  compositionSwitchDirection: CompositionProps['compositionSwitchDirection'];
  contextMenu: TrackRowsProps['contextMenu'];
  duration: OverlayGroupsProps['duration'];
  expandedCurveProperties: TrackRowsProps['expandedCurveProperties'];
  externalDrag: TrackRowsProps['externalDrag'];
  formatTime: CompositionProps['formatTime'];
  getExpandedTrackHeight: CompositionProps['getExpandedTrackHeight'];
  getMediaFileForClip: NewTrackLaneProps['getMediaFileForClip'];
  getSectionTrackBaseHeight: TrackRowsProps['getSectionTrackBaseHeight'];
  getSectionTrackHeight: TrackRowsProps['getSectionTrackHeight'];
  isCompositionTrackMorphing: TrackRowsProps['isCompositionTrackMorphing'];
  isTrackExpandedForRender: TrackRowsProps['isTrackExpandedForRender'];
  isTrackExpandedFromState: CompositionProps['isTrackExpandedFromState'];
  onAddKeyframe: TrackRowsProps['onAddKeyframe'];
  onBakeRegion: CompositionProps['onBakeRegion'];
  onClipContextMenu: TrackRowsProps['onClipContextMenu'];
  onClipDoubleClick: TrackRowsProps['onClipDoubleClick'];
  onClipMouseDown: TrackRowsProps['onClipMouseDown'];
  onCombinedDragLeave: TrackRowsProps['onCombinedDragLeave'];
  onCombinedDragOver: TrackRowsProps['onCombinedDragOver'];
  onCombinedDrop: TrackRowsProps['onCombinedDrop'];
  onEmptyContextMenu: TrackRowsProps['onEmptyContextMenu'];
  onEmptyMouseDown: TrackRowsProps['onEmptyMouseDown'];
  onFadeStart: TrackRowsProps['onFadeStart'];
  onMoveKeyframe: TrackRowsProps['onMoveKeyframe'];
  onMoveKeyframeGroup: TrackRowsProps['onMoveKeyframeGroup'];
  onNewTrackDragEnter: NewTrackLaneProps['onDragEnter'];
  onNewTrackDragLeave: NewTrackLaneProps['onDragLeave'];
  onNewTrackDragOver: NewTrackLaneProps['onDragOver'];
  onNewTrackDrop: NewTrackLaneProps['onDrop'];
  onRemoveRegion: CompositionProps['onRemoveRegion'];
  onSelectKeyframe: TrackRowsProps['onSelectKeyframe'];
  onTrackDragEnter: TrackRowsProps['onTrackDragEnter'];
  onTrackResizeStart: TrackRowsProps['onTrackResizeStart'];
  onTrimStart: TrackRowsProps['onTrimStart'];
  onUnbakeRegion: CompositionProps['onUnbakeRegion'];
  onUpdateBezierHandle: TrackRowsProps['onUpdateBezierHandle'];
  pixelToTime: TrackRowsProps['pixelToTime'];
  renderKeyframeDiamonds: TrackRowsProps['renderKeyframeDiamonds'];
  scrollX: TrackRowsProps['scrollX'];
  sectionKind: TrackSectionKind;
  sectionState: TimelineTrackSectionRenderState;
  selectedClipIds: TrackRowsProps['selectedClipIds'];
  selectedKeyframeIds: TrackRowsProps['selectedKeyframeIds'];
  timelineRef: OverlayGroupsProps['timelineRef'];
  timelineToolPreview: OverlayGroupsProps['timelineToolPreview'];
  timelineTrackColorsVisible: TrackRowsProps['timelineTrackColorsVisible'];
  timeToPixel: TrackRowsProps['timeToPixel'];
  videoBakeRegions: CompositionProps['videoBakeRegions'];
  videoBakeRegionSelection: TrackRowsProps['videoBakeRegionSelection'];
  viewportWidth: CompositionProps['viewportWidth'];
  waveformsEnabled: TrackRowsProps['waveformsEnabled'];
  zoom: TrackRowsProps['zoom'];
}

export function TimelineTrackSectionLaneStack({
  activeJunction,
  activeTimelineToolId,
  activeTrackResizeId,
  anyViewAudioSolo,
  anyViewVideoSolo,
  applyTimelineEditOperation,
  audioDisplayMode,
  audioNewTrackPreviewHeight,
  audioRegionGainPreview,
  audioRegionSelection,
  audioSpectralRegionSelection,
  clipAnimationPhase,
  clipDrag,
  clipDragNewTrackType,
  clipDragPreview,
  clipFade,
  clipKeyframes,
  clipMap,
  clips,
  clipStemSeparationJobs,
  clipTrim,
  compositionSwitchDirection,
  contextMenu,
  duration,
  expandedCurveProperties,
  externalDrag,
  formatTime,
  getExpandedTrackHeight,
  getMediaFileForClip,
  getSectionTrackBaseHeight,
  getSectionTrackHeight,
  isCompositionTrackMorphing,
  isTrackExpandedForRender,
  isTrackExpandedFromState,
  onAddKeyframe,
  onBakeRegion,
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
  onNewTrackDragEnter,
  onNewTrackDragLeave,
  onNewTrackDragOver,
  onNewTrackDrop,
  onRemoveRegion,
  onSelectKeyframe,
  onTrackDragEnter,
  onTrackResizeStart,
  onTrimStart,
  onUnbakeRegion,
  onUpdateBezierHandle,
  pixelToTime,
  renderKeyframeDiamonds,
  scrollX,
  sectionKind,
  sectionState,
  selectedClipIds,
  selectedKeyframeIds,
  timelineRef,
  timelineToolPreview,
  timelineTrackColorsVisible,
  timeToPixel,
  videoBakeRegions,
  videoBakeRegionSelection,
  viewportWidth,
  waveformsEnabled,
  zoom,
}: TimelineTrackSectionLaneStackProps) {
  const isTrackExpanded = (trackId: string) =>
    !sectionState.sectionCollapsed && isTrackExpandedForRender(trackId);

  const newTrackLaneProps = {
    audioPreviewHeight: audioNewTrackPreviewHeight,
    clipDrag,
    clipDragNewTrackType,
    clipDragPreview,
    draggedClip: sectionState.draggedClipForNewTrack,
    externalDrag,
    getMediaFileForClip,
    isVideoSection: sectionState.isVideoSection,
    onDragEnter: onNewTrackDragEnter,
    onDragLeave: onNewTrackDragLeave,
    onDragOver: onNewTrackDragOver,
    onDrop: onNewTrackDrop,
    sectionCollapsed: sectionState.sectionCollapsed,
    timeToPixel,
    videoPreviewHeight: VIDEO_NEW_TRACK_PREVIEW_HEIGHT,
  };

  return (
    <>
      <TimelineNewTrackLaneOverlays {...newTrackLaneProps} placement="beforeRows" />
      <TimelineSectionTrackRows
        activeTimelineToolId={activeTimelineToolId}
        activeTrackResizeId={activeTrackResizeId}
        anyViewAudioSolo={anyViewAudioSolo}
        anyViewVideoSolo={anyViewVideoSolo}
        applyTimelineEditOperation={applyTimelineEditOperation}
        audioDisplayMode={audioDisplayMode}
        audioRegionGainPreview={audioRegionGainPreview}
        audioRegionSelection={audioRegionSelection}
        audioSpectralRegionSelection={audioSpectralRegionSelection}
        clipDrag={clipDrag}
        clipDragPreview={clipDragPreview}
        clipFade={clipFade}
        clipKeyframes={clipKeyframes}
        clipMap={clipMap}
        clips={clips}
        clipStemSeparationJobs={clipStemSeparationJobs}
        clipTrim={clipTrim}
        contextMenu={contextMenu}
        expandedCurveProperties={expandedCurveProperties}
        externalDrag={externalDrag}
        getSectionTrackBaseHeight={getSectionTrackBaseHeight}
        getSectionTrackHeight={getSectionTrackHeight}
        isCompositionTrackMorphing={isCompositionTrackMorphing}
        isTrackExpandedForRender={isTrackExpanded}
        onAddKeyframe={onAddKeyframe}
        onClipContextMenu={onClipContextMenu}
        onClipDoubleClick={onClipDoubleClick}
        onClipMouseDown={onClipMouseDown}
        onCombinedDragLeave={onCombinedDragLeave}
        onCombinedDragOver={onCombinedDragOver}
        onCombinedDrop={onCombinedDrop}
        onEmptyContextMenu={onEmptyContextMenu}
        onEmptyMouseDown={onEmptyMouseDown}
        onFadeStart={onFadeStart}
        onMoveKeyframe={onMoveKeyframe}
        onMoveKeyframeGroup={onMoveKeyframeGroup}
        onSelectKeyframe={onSelectKeyframe}
        onTrackDragEnter={onTrackDragEnter}
        onTrackResizeStart={onTrackResizeStart}
        onTrimStart={onTrimStart}
        onUpdateBezierHandle={onUpdateBezierHandle}
        pixelToTime={pixelToTime}
        renderKeyframeDiamonds={renderKeyframeDiamonds}
        scrollX={scrollX}
        sectionKind={sectionKind}
        sectionTracks={sectionState.sectionTracks}
        selectedClipIds={selectedClipIds}
        selectedKeyframeIds={selectedKeyframeIds}
        timeToPixel={timeToPixel}
        timelineTrackColorsVisible={timelineTrackColorsVisible}
        videoBakeRegionSelection={videoBakeRegionSelection}
        waveformsEnabled={waveformsEnabled}
        zoom={zoom}
      />
      <TimelineCompositionSectionOverlays
        audioDisplayMode={audioDisplayMode}
        clipAnimationPhase={clipAnimationPhase}
        clips={clips}
        compositionSwitchDirection={compositionSwitchDirection}
        duration={duration}
        formatTime={formatTime}
        getExpandedTrackHeight={getExpandedTrackHeight}
        getSectionTrackBaseHeight={getSectionTrackBaseHeight}
        getSectionTrackHeight={getSectionTrackHeight}
        isCompositionTrackMorphing={isCompositionTrackMorphing}
        isTrackExpandedFromState={isTrackExpandedFromState}
        isVideoSection={sectionState.isVideoSection}
        onBakeRegion={onBakeRegion}
        onRemoveRegion={onRemoveRegion}
        onUnbakeRegion={onUnbakeRegion}
        scrollX={scrollX}
        sectionCollapsed={sectionState.sectionCollapsed}
        sectionKind={sectionKind}
        sectionTracks={sectionState.sectionTracks}
        selectedClipIds={selectedClipIds}
        timeToPixel={timeToPixel}
        timelineTrackColorsVisible={timelineTrackColorsVisible}
        tracks={sectionState.allSectionTracks}
        videoBakeRegions={videoBakeRegions}
        videoBakeRegionSelection={videoBakeRegionSelection}
        viewportWidth={viewportWidth}
        waveformsEnabled={waveformsEnabled}
        zoom={zoom}
      />
      <TimelineSectionOverlayGroups
        activeJunction={activeJunction}
        clipDrag={clipDrag}
        clipTrim={clipTrim}
        clips={clips}
        duration={duration}
        getExpandedTrackHeight={sectionState.getSectionTrackHeightById}
        getTrackBaseHeight={(track) => getSectionTrackBaseHeight(track, sectionKind)}
        getTrackHeight={sectionState.getSectionTrackHeightForOverlay}
        isCompositionTrackMorphing={isCompositionTrackMorphing}
        isTrackExpanded={isTrackExpanded}
        scrollX={scrollX}
        sectionTracks={sectionState.sectionTracks}
        timelineRef={timelineRef}
        timelineToolPreview={timelineToolPreview}
        timeToPixel={timeToPixel}
        tracks={sectionState.allSectionTracks}
        zoom={zoom}
      />
      <TimelineNewTrackLaneOverlays {...newTrackLaneProps} placement="afterOverlays" />
    </>
  );
}
