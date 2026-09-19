import {
  memo,
  useCallback,
  useMemo,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { useTimelineStore } from '../../../stores/timeline';
import { TimelineHeader } from '../TimelineHeader';
import type {
  ContextMenuState,
  TimelineEmptyContextMenuState,
  TimelineHeaderProps,
} from '../types';
import type { InOutContextMenuState } from '../InOutContextMenu';
import type { MarkerContextMenuState } from '../MarkerContextMenu';
import type { TrackContextMenuState } from '../TrackContextMenu';
import type { TimelineHeaderPropertySelection } from '../utils/timelineHeaderPropertySelection';

type NullableSetter<T> = Dispatch<SetStateAction<T | null>>;

export interface TimelineSectionHeaderSharedProps {
  addKeyframe: TimelineHeaderProps['addKeyframe'];
  audioLayerAdvancedMode: boolean;
  getClipKeyframes: TimelineHeaderProps['getClipKeyframes'];
  getInterpolatedEffects: TimelineHeaderProps['getInterpolatedEffects'];
  getInterpolatedTransform: TimelineHeaderProps['getInterpolatedTransform'];
  onKeyframeRowHover: NonNullable<TimelineHeaderProps['onKeyframeRowHover']>;
  onSetTrackParent: TimelineHeaderProps['onSetTrackParent'];
  onToggleCurveExpanded: TimelineHeaderProps['onToggleCurveExpanded'];
  onTrackHeightWheel: (event: ReactWheelEvent, trackId: string) => void;
  onTrackPickWhipDragEnd: TimelineHeaderProps['onTrackPickWhipDragEnd'];
  onTrackPickWhipDragStart: TimelineHeaderProps['onTrackPickWhipDragStart'];
  onTrackResizeStart: NonNullable<TimelineHeaderProps['onResizeStart']>;
  setContextMenu: NullableSetter<ContextMenuState>;
  setEmptyContextMenu: NullableSetter<TimelineEmptyContextMenuState>;
  setInOutContextMenu: NullableSetter<InOutContextMenuState>;
  setMarkerContextMenu: NullableSetter<MarkerContextMenuState>;
  setPlayheadPosition: TimelineHeaderProps['setPlayheadPosition'];
  setPropertyValue: TimelineHeaderProps['setPropertyValue'];
  setTrackContextMenu: NullableSetter<TrackContextMenuState>;
  toggleTrackExpanded: (trackId: string) => void;
}

interface TimelineSectionHeaderRowProps {
  baseHeight: number;
  canToggleExpand: boolean;
  dynamicHeight: number;
  expandedCurveProperties: TimelineHeaderProps['expandedCurveProperties'];
  hasKeyframes: boolean;
  hoveredKeyframeRow: TimelineHeaderProps['hoveredKeyframeRow'];
  isDimmed: boolean;
  isExpanded: boolean;
  isResizeActive: boolean;
  propertyClip: TimelineClip | null;
  propertyClipKeyframes: TimelineHeaderPropertySelection['keyframes'];
  shared: TimelineSectionHeaderSharedProps;
  track: TimelineTrack;
  tracks: TimelineTrack[];
}

export const TimelineSectionHeaderRow = memo(function TimelineSectionHeaderRow({
  baseHeight,
  canToggleExpand,
  dynamicHeight,
  expandedCurveProperties,
  hasKeyframes,
  hoveredKeyframeRow,
  isDimmed,
  isExpanded,
  isResizeActive,
  propertyClip,
  propertyClipKeyframes,
  shared,
  track,
  tracks,
}: TimelineSectionHeaderRowProps) {
  const trackId = track.id;
  const propertySelection = useMemo<TimelineHeaderPropertySelection>(() => ({
    clip: propertyClip,
    keyframes: propertyClipKeyframes,
  }), [propertyClip, propertyClipKeyframes]);

  const onToggleExpand = useCallback(() => {
    if (canToggleExpand) shared.toggleTrackExpanded(trackId);
  }, [canToggleExpand, shared, trackId]);

  const onToggleSolo = useCallback(() => {
    const store = useTimelineStore.getState();
    const currentTrack = store.tracks.find((candidate) => candidate.id === trackId);
    if (!currentTrack) return;
    store.setTrackSolo(trackId, !(currentTrack.audioState?.solo ?? currentTrack.solo));
  }, [trackId]);

  const onToggleLocked = useCallback(() => {
    const store = useTimelineStore.getState();
    const currentTrack = store.tracks.find((candidate) => candidate.id === trackId);
    if (!currentTrack) return;
    store.setTrackLocked(trackId, !currentTrack.locked);
  }, [trackId]);

  const onToggleMuted = useCallback(() => {
    const store = useTimelineStore.getState();
    const currentTrack = store.tracks.find((candidate) => candidate.id === trackId);
    if (!currentTrack) return;
    store.setTrackMuted(trackId, !(currentTrack.audioState?.muted ?? currentTrack.muted));
  }, [trackId]);

  const onToggleVisible = useCallback(() => {
    const store = useTimelineStore.getState();
    const currentTrack = store.tracks.find((candidate) => candidate.id === trackId);
    if (!currentTrack) return;
    store.setTrackVisible(trackId, !currentTrack.visible);
  }, [trackId]);

  const onRenameTrack = useCallback((name: string) => {
    useTimelineStore.getState().renameTrack(trackId, name);
  }, [trackId]);

  const onWheel = useCallback((event: ReactWheelEvent) => {
    shared.onTrackHeightWheel(event, trackId);
  }, [shared, trackId]);

  const onContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    shared.setContextMenu(null);
    shared.setEmptyContextMenu(null);
    shared.setMarkerContextMenu(null);
    shared.setInOutContextMenu(null);
    shared.setTrackContextMenu({
      x: event.clientX,
      y: event.clientY,
      trackId,
      trackType: track.type as 'video' | 'audio',
      trackName: track.name,
    });
  }, [shared, track.name, track.type, trackId]);

  return (
    <TimelineHeader
      track={track}
      tracks={tracks}
      isDimmed={isDimmed}
      isExpanded={isExpanded}
      baseHeight={baseHeight}
      dynamicHeight={dynamicHeight}
      hasKeyframes={hasKeyframes}
      propertySelection={propertySelection}
      onToggleExpand={onToggleExpand}
      onToggleSolo={onToggleSolo}
      onToggleLocked={onToggleLocked}
      onToggleMuted={onToggleMuted}
      onToggleVisible={onToggleVisible}
      onRenameTrack={onRenameTrack}
      onWheel={onWheel}
      onResizeStart={shared.onTrackResizeStart}
      isResizeActive={isResizeActive}
      getClipKeyframes={shared.getClipKeyframes}
      getInterpolatedTransform={shared.getInterpolatedTransform}
      getInterpolatedEffects={shared.getInterpolatedEffects}
      addKeyframe={shared.addKeyframe}
      setPlayheadPosition={shared.setPlayheadPosition}
      setPropertyValue={shared.setPropertyValue}
      expandedCurveProperties={expandedCurveProperties}
      onToggleCurveExpanded={shared.onToggleCurveExpanded}
      hoveredKeyframeRow={hoveredKeyframeRow}
      onKeyframeRowHover={shared.onKeyframeRowHover}
      audioLayerAdvancedMode={shared.audioLayerAdvancedMode}
      showCollapsedAudioSummaryMeter={false}
      onSetTrackParent={shared.onSetTrackParent}
      onTrackPickWhipDragStart={shared.onTrackPickWhipDragStart}
      onTrackPickWhipDragEnd={shared.onTrackPickWhipDragEnd}
      onContextMenu={onContextMenu}
    />
  );
});
