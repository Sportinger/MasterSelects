import {
  memo,
  useMemo,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipDragNewTrackType } from '../utils/clipDragTrackTargeting';
import type { TrackSectionKind } from '../utils/timelineHostTypes';
import type { ExternalDragState } from '../types';
import type {
  ContextMenuState,
  TimelineEmptyContextMenuState,
  TimelineHeaderProps,
} from '../types';
import type { InOutContextMenuState } from '../InOutContextMenu';
import type { MarkerContextMenuState } from '../MarkerContextMenu';
import type { TrackContextMenuState } from '../TrackContextMenu';
import { VIDEO_NEW_TRACK_PREVIEW_HEIGHT } from '../utils/timelineHostConstants';
import { isAudioSectionTrackType } from '../utils/trackSection';
import { TimelineNewTrackHeaderPreview } from './TimelineNewTrackPreviews';
import {
  TimelineSectionHeaderRow,
  type TimelineSectionHeaderSharedProps,
} from './TimelineSectionHeaderRow';
import type { TimelineHeaderPropertySelection } from '../utils/timelineHeaderPropertySelection';

type NullableSetter<T> = Dispatch<SetStateAction<T | null>>;

export interface TimelineSectionHeadersProps {
  activeTrackResizeId: string | null;
  addKeyframe: TimelineHeaderProps['addKeyframe'];
  anyViewAudioSolo: boolean;
  anyViewVideoSolo: boolean;
  audioLayerAdvancedMode: boolean;
  audioNewTrackPreviewHeight: number;
  clipDragNewTrackType: ClipDragNewTrackType | null;
  clipKeyframes: TimelineHeaderProps['clipKeyframes'];
  clips: TimelineClip[];
  expandedCurveProperties: TimelineHeaderProps['expandedCurveProperties'];
  externalDrag: ExternalDragState | null;
  getClipKeyframes: TimelineHeaderProps['getClipKeyframes'];
  getInterpolatedEffects: TimelineHeaderProps['getInterpolatedEffects'];
  getInterpolatedTransform: TimelineHeaderProps['getInterpolatedTransform'];
  getSectionTrackBaseHeight: (track: TimelineTrack, sectionKind: TrackSectionKind) => number;
  getSectionTrackHeight: (track: TimelineTrack, sectionKind: TrackSectionKind) => number;
  hoveredKeyframeRow: TimelineHeaderProps['hoveredKeyframeRow'];
  isCompositionTrackMorphing: boolean;
  isTrackExpandedForRender: (trackId: string) => boolean;
  isVideoSection: boolean;
  onKeyframeRowHover: NonNullable<TimelineHeaderProps['onKeyframeRowHover']>;
  onSetTrackParent: TimelineHeaderProps['onSetTrackParent'];
  onToggleCurveExpanded: TimelineHeaderProps['onToggleCurveExpanded'];
  onTrackHeightWheel: (event: ReactWheelEvent, trackId: string) => void;
  onTrackPickWhipDragEnd: TimelineHeaderProps['onTrackPickWhipDragEnd'];
  onTrackPickWhipDragStart: TimelineHeaderProps['onTrackPickWhipDragStart'];
  onTrackResizeStart: NonNullable<TimelineHeaderProps['onResizeStart']>;
  sectionCollapsed: boolean;
  sectionKind: TrackSectionKind;
  sectionPhaseClass: string;
  sectionTracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  setContextMenu: NullableSetter<ContextMenuState>;
  setEmptyContextMenu: NullableSetter<TimelineEmptyContextMenuState>;
  setInOutContextMenu: NullableSetter<InOutContextMenuState>;
  setMarkerContextMenu: NullableSetter<MarkerContextMenuState>;
  setPlayheadPosition: TimelineHeaderProps['setPlayheadPosition'];
  setPropertyValue: TimelineHeaderProps['setPropertyValue'];
  setTrackContextMenu: NullableSetter<TrackContextMenuState>;
  timelineViewTracks: TimelineTrack[];
  toggleTrackExpanded: (trackId: string) => void;
  trackHasKeyframes: (trackId: string) => boolean;
}

const EMPTY_PROPERTY_CLIP_KEYFRAMES: TimelineHeaderPropertySelection['keyframes'] = [];

export const TimelineSectionHeaders = memo(function TimelineSectionHeaders({
  activeTrackResizeId,
  addKeyframe,
  anyViewAudioSolo,
  anyViewVideoSolo,
  audioLayerAdvancedMode,
  audioNewTrackPreviewHeight,
  clipDragNewTrackType,
  clipKeyframes,
  clips,
  expandedCurveProperties,
  externalDrag,
  getClipKeyframes,
  getInterpolatedEffects,
  getInterpolatedTransform,
  getSectionTrackBaseHeight,
  getSectionTrackHeight,
  hoveredKeyframeRow,
  isCompositionTrackMorphing,
  isTrackExpandedForRender,
  isVideoSection,
  onKeyframeRowHover,
  onSetTrackParent,
  onToggleCurveExpanded,
  onTrackHeightWheel,
  onTrackPickWhipDragEnd,
  onTrackPickWhipDragStart,
  onTrackResizeStart,
  sectionCollapsed,
  sectionKind,
  sectionPhaseClass,
  sectionTracks,
  selectedClipIds,
  setContextMenu,
  setEmptyContextMenu,
  setInOutContextMenu,
  setMarkerContextMenu,
  setPlayheadPosition,
  setPropertyValue,
  setTrackContextMenu,
  timelineViewTracks,
  toggleTrackExpanded,
  trackHasKeyframes,
}: TimelineSectionHeadersProps) {
  const selectedClipByTrack = useMemo(() => {
    const selectedByTrack = new Map<string, TimelineClip>();
    if (sectionCollapsed || isCompositionTrackMorphing || selectedClipIds.size === 0) {
      return selectedByTrack;
    }

    for (const clip of clips) {
      if (selectedClipIds.has(clip.id) && !selectedByTrack.has(clip.trackId)) {
        selectedByTrack.set(clip.trackId, clip);
      }
    }
    return selectedByTrack;
  }, [clips, isCompositionTrackMorphing, sectionCollapsed, selectedClipIds]);

  const shared = useMemo<TimelineSectionHeaderSharedProps>(() => ({
    addKeyframe,
    audioLayerAdvancedMode,
    getClipKeyframes,
    getInterpolatedEffects,
    getInterpolatedTransform,
    onKeyframeRowHover,
    onSetTrackParent,
    onToggleCurveExpanded,
    onTrackHeightWheel,
    onTrackPickWhipDragEnd,
    onTrackPickWhipDragStart,
    onTrackResizeStart,
    setContextMenu,
    setEmptyContextMenu,
    setInOutContextMenu,
    setMarkerContextMenu,
    setPlayheadPosition,
    setPropertyValue,
    setTrackContextMenu,
    toggleTrackExpanded,
  }), [
    addKeyframe,
    audioLayerAdvancedMode,
    getClipKeyframes,
    getInterpolatedEffects,
    getInterpolatedTransform,
    onKeyframeRowHover,
    onSetTrackParent,
    onToggleCurveExpanded,
    onTrackHeightWheel,
    onTrackPickWhipDragEnd,
    onTrackPickWhipDragStart,
    onTrackResizeStart,
    setContextMenu,
    setEmptyContextMenu,
    setInOutContextMenu,
    setMarkerContextMenu,
    setPlayheadPosition,
    setPropertyValue,
    setTrackContextMenu,
    toggleTrackExpanded,
  ]);

  const onEmptyHeaderContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Row headers own their own context menu; only claim empty column space.
    if ((event.target as HTMLElement).closest('.track-header')) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setEmptyContextMenu(null);
    setMarkerContextMenu(null);
    setInOutContextMenu(null);
    setTrackContextMenu({
      x: event.clientX,
      y: event.clientY,
      trackId: null,
      trackType: null,
      trackName: null,
    });
  };

  return (
    <div className={`track-headers ${sectionPhaseClass}`} onContextMenu={onEmptyHeaderContextMenu}>
      {isVideoSection && (externalDrag?.showVideoNewTrackZone || clipDragNewTrackType === 'video') && !sectionCollapsed && (
        <TimelineNewTrackHeaderPreview
          active={externalDrag?.newTrackType === 'video' || clipDragNewTrackType === 'video'}
          height={VIDEO_NEW_TRACK_PREVIEW_HEIGHT}
          trackType="video"
        />
      )}

      {sectionTracks.map((track) => {
        const isDimmed =
          (track.type === 'video' && anyViewVideoSolo && !track.solo) ||
          (isAudioSectionTrackType(track.type) && anyViewAudioSolo && !track.solo);
        const isExpanded = !sectionCollapsed && isTrackExpandedForRender(track.id);
        const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
        const dynamicHeight = getSectionTrackHeight(track, sectionKind);
        const propertyClip = selectedClipByTrack.get(track.id) ?? null;
        const propertyClipKeyframes = propertyClip
          ? clipKeyframes.get(propertyClip.id) ?? EMPTY_PROPERTY_CLIP_KEYFRAMES
          : EMPTY_PROPERTY_CLIP_KEYFRAMES;

        return (
          <TimelineSectionHeaderRow
            key={track.id}
            track={track}
            tracks={timelineViewTracks}
            isDimmed={isDimmed}
            isExpanded={isExpanded}
            baseHeight={baseHeight}
            dynamicHeight={dynamicHeight}
            hasKeyframes={!sectionCollapsed && !isCompositionTrackMorphing && trackHasKeyframes(track.id)}
            isResizeActive={activeTrackResizeId === track.id}
            canToggleExpand={!sectionCollapsed}
            propertyClip={propertyClip}
            propertyClipKeyframes={propertyClipKeyframes}
            expandedCurveProperties={expandedCurveProperties}
            hoveredKeyframeRow={hoveredKeyframeRow}
            shared={shared}
          />
        );
      })}

      {!isVideoSection && (
        externalDrag?.newTrackType === 'audio' ||
        externalDrag?.audioTrackId === '__new_audio_track__' ||
        clipDragNewTrackType === 'audio'
      ) && !sectionCollapsed && (
        <TimelineNewTrackHeaderPreview
          active={Boolean(
            clipDragNewTrackType === 'audio' ||
            externalDrag?.newTrackType === 'audio' ||
            (externalDrag?.isVideo && externalDrag?.audioTrackId === '__new_audio_track__')
          )}
          height={audioNewTrackPreviewHeight}
          trackType="audio"
        />
      )}
    </div>
  );
});
