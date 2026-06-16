import type { Dispatch, SetStateAction, WheelEvent as ReactWheelEvent } from 'react';
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
import { useTimelineStore } from '../../../stores/timeline';
import { TimelineHeader } from '../TimelineHeader';
import { VIDEO_NEW_TRACK_PREVIEW_HEIGHT } from '../utils/timelineHostConstants';
import { isAudioSectionTrackType } from '../utils/trackSection';
import { TimelineNewTrackHeaderPreview } from './TimelineNewTrackPreviews';

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
  playheadPosition: number;
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

export function TimelineSectionHeaders({
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
  playheadPosition,
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
  return (
    <div className={`track-headers ${sectionPhaseClass}`}>
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

        return (
          <TimelineHeader
            key={track.id}
            track={track}
            tracks={timelineViewTracks}
            isDimmed={isDimmed}
            isExpanded={isExpanded}
            baseHeight={baseHeight}
            dynamicHeight={dynamicHeight}
            hasKeyframes={!sectionCollapsed && !isCompositionTrackMorphing && trackHasKeyframes(track.id)}
            selectedClipIds={selectedClipIds}
            clips={isCompositionTrackMorphing || sectionCollapsed ? [] : clips}
            playheadPosition={playheadPosition}
            onToggleExpand={() => {
              if (!sectionCollapsed) toggleTrackExpanded(track.id);
            }}
            onToggleSolo={() =>
              useTimelineStore.getState().setTrackSolo(track.id, !(track.audioState?.solo ?? track.solo))
            }
            onToggleLocked={() =>
              useTimelineStore.getState().setTrackLocked(track.id, !track.locked)
            }
            onToggleMuted={() =>
              useTimelineStore.getState().setTrackMuted(track.id, !(track.audioState?.muted ?? track.muted))
            }
            onToggleVisible={() =>
              useTimelineStore.getState().setTrackVisible(track.id, !track.visible)
            }
            onRenameTrack={(name) =>
              useTimelineStore.getState().renameTrack(track.id, name)
            }
            onWheel={(event) => onTrackHeightWheel(event, track.id)}
            onResizeStart={onTrackResizeStart}
            isResizeActive={activeTrackResizeId === track.id}
            clipKeyframes={clipKeyframes}
            getClipKeyframes={getClipKeyframes}
            getInterpolatedTransform={getInterpolatedTransform}
            getInterpolatedEffects={getInterpolatedEffects}
            addKeyframe={addKeyframe}
            setPlayheadPosition={setPlayheadPosition}
            setPropertyValue={setPropertyValue}
            expandedCurveProperties={expandedCurveProperties}
            onToggleCurveExpanded={onToggleCurveExpanded}
            hoveredKeyframeRow={hoveredKeyframeRow}
            onKeyframeRowHover={onKeyframeRowHover}
            audioLayerAdvancedMode={audioLayerAdvancedMode}
            showCollapsedAudioSummaryMeter={false}
            onSetTrackParent={onSetTrackParent}
            onTrackPickWhipDragStart={onTrackPickWhipDragStart}
            onTrackPickWhipDragEnd={onTrackPickWhipDragEnd}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenu(null);
              setEmptyContextMenu(null);
              setMarkerContextMenu(null);
              setInOutContextMenu(null);
              setTrackContextMenu({
                x: event.clientX,
                y: event.clientY,
                trackId: track.id,
                trackType: track.type as 'video' | 'audio',
                trackName: track.name,
              });
            }}
          />
        );
      })}

      {!isVideoSection && ((externalDrag && externalDrag.hasAudio) || clipDragNewTrackType === 'audio') && !sectionCollapsed && (
        <TimelineNewTrackHeaderPreview
          active={Boolean(
            clipDragNewTrackType === 'audio' ||
            externalDrag?.newTrackType === 'audio' ||
            (externalDrag?.newTrackType === 'video' && externalDrag?.hasAudio) ||
            (externalDrag?.isVideo && externalDrag?.audioTrackId === '__new_audio_track__')
          )}
          height={audioNewTrackPreviewHeight}
          trackType="audio"
        />
      )}
    </div>
  );
}
