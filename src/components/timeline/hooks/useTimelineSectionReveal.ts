import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type {
  AnimatableProperty,
  Keyframe,
  TimelineClip as TimelineClipType,
  TimelineTrack as TimelineTrackType,
} from '../../../types';
import type { TimelinePropertiesSelection } from '../../../stores/timeline/types';
import { applySelectedTrackRevealScroll } from '../utils/timelineHostLayout';
import type { SelectedTrackRevealSnapshot, TrackSectionKind } from '../utils/timelineHostTypes';

interface TimelineExternalDragRevealState {
  trackId?: string | null;
  newTrackType?: 'video' | 'audio' | null;
  isAudio?: boolean;
}

interface TimelineClipDragRevealState {
  newTrackType?: 'video' | 'audio' | null;
}

interface UseTimelineSectionRevealProps {
  clips: TimelineClipType[];
  tracks: TimelineTrackType[];
  selectedClipIds: Set<string>;
  clipKeyframes: Map<string, Keyframe[]>;
  expandedCurveProperties: Map<string, Set<AnimatableProperty>>;
  timelineViewTrackMap: Map<string, TimelineTrackType>;
  trackMap: Map<string, TimelineTrackType>;
  displayedVideoTracks: TimelineTrackType[];
  displayedAudioTracks: TimelineTrackType[];
  isAudioSectionCollapsed: boolean;
  isVideoSectionCollapsed: boolean;
  isSectionCollapsed: (sectionKind: TrackSectionKind) => boolean;
  isTrackExpandedForRender: (trackId: string) => boolean;
  getSectionTrackBaseHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  getSectionTrackHeight: (track: TimelineTrackType, sectionKind: TrackSectionKind) => number;
  videoSectionHeight: number;
  audioSectionHeight: number;
  videoSectionContentHeight: number;
  audioSectionContentHeight: number;
  audioScrollableContentHeight: number;
  audioViewportHeight: number;
  externalDrag: TimelineExternalDragRevealState | null | undefined;
  clipDrag: TimelineClipDragRevealState | null | undefined;
  clipDragNewTrackType: 'video' | 'audio' | null;
  propertiesSelection: TimelinePropertiesSelection;
  audioScrollYRef: MutableRefObject<number>;
  sectionScrollAnimationTargetRef: MutableRefObject<Record<TrackSectionKind, number | null>>;
  setVideoScrollY: Dispatch<SetStateAction<number>>;
  setAudioScrollY: Dispatch<SetStateAction<number>>;
  animateSectionScrollTo: (
    sectionKind: TrackSectionKind,
    targetScrollY: number,
    contentHeight: number,
    viewportHeight: number,
    durationMs?: number,
  ) => void;
}

export function useTimelineSectionReveal({
  clips,
  tracks,
  selectedClipIds,
  clipKeyframes,
  expandedCurveProperties,
  timelineViewTrackMap,
  trackMap,
  displayedVideoTracks,
  displayedAudioTracks,
  isAudioSectionCollapsed,
  isVideoSectionCollapsed,
  isSectionCollapsed,
  isTrackExpandedForRender,
  getSectionTrackBaseHeight,
  getSectionTrackHeight,
  videoSectionHeight,
  audioSectionHeight,
  videoSectionContentHeight,
  audioSectionContentHeight,
  audioScrollableContentHeight,
  audioViewportHeight,
  externalDrag,
  clipDrag,
  clipDragNewTrackType,
  propertiesSelection,
  audioScrollYRef,
  sectionScrollAnimationTargetRef,
  setVideoScrollY,
  setAudioScrollY,
  animateSectionScrollTo,
}: UseTimelineSectionRevealProps): void {
  const selectedTrackRevealSnapshotRef = useRef<SelectedTrackRevealSnapshot | null>(null);
  const hasObservedSelectionRef = useRef(false);
  const selectedTrackRevealSnapshot = useMemo<SelectedTrackRevealSnapshot | null>(() => {
    const primarySelectedClipId = propertiesSelection?.kind === 'clip' && selectedClipIds.has(propertiesSelection.clipId)
      ? propertiesSelection.clipId
      : selectedClipIds.values().next().value;
    const selectedClip = primarySelectedClipId
      ? clips.find(clip => clip.id === primarySelectedClipId)
      : undefined;
    if (!selectedClip) return null;
    const track = timelineViewTrackMap.get(selectedClip.trackId) ?? trackMap.get(selectedClip.trackId);
    if (!track || (track.type !== 'video' && track.type !== 'audio')) return null;
    const sectionKind: TrackSectionKind = track.type;
    if (isSectionCollapsed(sectionKind)) return null;
    const sectionTracks = sectionKind === 'video' ? displayedVideoTracks : displayedAudioTracks;
    const sectionTrackIndex = sectionTracks.findIndex(candidate => candidate.id === track.id);
    if (sectionTrackIndex < 0) return null;
    const trackOffsetTop = sectionTracks
      .slice(0, sectionTrackIndex)
      .reduce((sum, candidate) => sum + getSectionTrackHeight(candidate, sectionKind), 0);
    const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
    const trackHeight = Math.max(baseHeight, getSectionTrackHeight(track, sectionKind));
    const keyframes = clipKeyframes.get(selectedClip.id) ?? [];
    const curveSignature = Array.from(expandedCurveProperties.get(track.id) ?? new Set<AnimatableProperty>()).sort().join('|');
    return {
      clipId: selectedClip.id,
      trackId: track.id,
      sectionKind,
      keyframeCount: keyframes.length,
      curveSignature,
      trackHeight,
      contentHeight: sectionKind === 'video' ? videoSectionContentHeight : audioSectionContentHeight,
      viewportHeight: sectionKind === 'video' ? videoSectionHeight : audioSectionHeight,
      trackTop: trackOffsetTop,
      trackBottom: trackOffsetTop + trackHeight,
    };
  }, [
    audioSectionContentHeight,
    audioSectionHeight,
    clipKeyframes,
    clips,
    displayedAudioTracks,
    displayedVideoTracks,
    expandedCurveProperties,
    getSectionTrackBaseHeight,
    getSectionTrackHeight,
    isSectionCollapsed,
    isTrackExpandedForRender,
    propertiesSelection,
    selectedClipIds,
    timelineViewTrackMap,
    trackMap,
    videoSectionContentHeight,
    videoSectionHeight,
  ]);

  useLayoutEffect(() => {
    const previousSnapshot = selectedTrackRevealSnapshotRef.current;
    selectedTrackRevealSnapshotRef.current = selectedTrackRevealSnapshot;
    if (!hasObservedSelectionRef.current) {
      hasObservedSelectionRef.current = true;
      return;
    }
    if (!selectedTrackRevealSnapshot) return;
    const sameSelection =
      previousSnapshot?.clipId === selectedTrackRevealSnapshot.clipId &&
      previousSnapshot.trackId === selectedTrackRevealSnapshot.trackId &&
      previousSnapshot.sectionKind === selectedTrackRevealSnapshot.sectionKind;
    const keyframeWasAdded = sameSelection && selectedTrackRevealSnapshot.keyframeCount > previousSnapshot.keyframeCount;
    const curveWasOpened = sameSelection && previousSnapshot.curveSignature.length === 0 && selectedTrackRevealSnapshot.curveSignature.length > 0;
    const layoutGrew = sameSelection && (
      selectedTrackRevealSnapshot.trackHeight > previousSnapshot.trackHeight ||
      selectedTrackRevealSnapshot.contentHeight > previousSnapshot.contentHeight
    );
    if (sameSelection && !keyframeWasAdded && !curveWasOpened && !layoutGrew) return;
    const applyReveal = (current: number) => {
      const next = applySelectedTrackRevealScroll(current, selectedTrackRevealSnapshot);
      return Math.abs(next - current) > 0.5 ? next : current;
    };
    if (selectedTrackRevealSnapshot.sectionKind === 'video') {
      setVideoScrollY(applyReveal);
    } else {
      setAudioScrollY(applyReveal);
    }
  }, [selectedTrackRevealSnapshot, setAudioScrollY, setVideoScrollY]);

  useEffect(() => {
    if (!externalDrag && !clipDrag) return;
    const hoveredTrack = externalDrag ? tracks.find((track) => track.id === externalDrag.trackId) : null;
    const isOverAudio =
      hoveredTrack?.type === 'audio' ||
      externalDrag?.newTrackType === 'audio' ||
      externalDrag?.isAudio ||
      clipDragNewTrackType === 'audio';
    const isOverVideo =
      hoveredTrack?.type === 'video' ||
      externalDrag?.newTrackType === 'video' ||
      clipDragNewTrackType === 'video';
    if (isOverAudio && !isAudioSectionCollapsed) {
      setAudioScrollY(Math.max(0, audioScrollableContentHeight - audioViewportHeight));
    } else if (isOverVideo && !isVideoSectionCollapsed) {
      setVideoScrollY(0);
    }
  }, [
    audioScrollableContentHeight,
    audioViewportHeight,
    clipDrag,
    clipDragNewTrackType,
    externalDrag,
    isAudioSectionCollapsed,
    isVideoSectionCollapsed,
    setAudioScrollY,
    setVideoScrollY,
    tracks,
  ]);

  useEffect(() => {
    if (propertiesSelection?.kind !== 'track') return;
    if (isAudioSectionCollapsed || audioViewportHeight <= 1) return;
    const trackIndex = displayedAudioTracks.findIndex(track => track.id === propertiesSelection.trackId);
    if (trackIndex < 0) return;
    const trackTop = displayedAudioTracks
      .slice(0, trackIndex)
      .reduce((sum, track) => sum + getSectionTrackHeight(track, 'audio'), 0);
    const trackHeight = getSectionTrackHeight(displayedAudioTracks[trackIndex], 'audio');
    const trackBottom = trackTop + trackHeight;
    const currentScrollY = sectionScrollAnimationTargetRef.current.audio ?? audioScrollYRef.current;
    const revealPadding = 12;
    const viewportTop = currentScrollY + revealPadding;
    const viewportBottom = currentScrollY + audioViewportHeight - revealPadding;
    if (trackTop >= viewportTop && trackBottom <= viewportBottom) return;
    const nextScrollY = trackTop < viewportTop
      ? trackTop - revealPadding
      : trackBottom - audioViewportHeight + revealPadding;
    animateSectionScrollTo('audio', nextScrollY, audioScrollableContentHeight, audioViewportHeight);
  }, [
    animateSectionScrollTo,
    audioScrollYRef,
    audioScrollableContentHeight,
    audioViewportHeight,
    displayedAudioTracks,
    getSectionTrackHeight,
    isAudioSectionCollapsed,
    propertiesSelection,
    sectionScrollAnimationTargetRef,
  ]);
}
