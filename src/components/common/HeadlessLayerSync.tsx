import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { useLayerSync } from '../timeline/hooks/useLayerSync';
import { useTimelineTrackVisibilityState } from '../timeline/hooks/useTimelineTrackVisibilityState';

/**
 * Render-layer sync for layouts without a Timeline panel, such as the Image
 * workspace. Preview edit mode hit-tests and draws handles from these layers.
 */
export function HeadlessLayerSync() {
  const state = useTimelineStore(useShallow((s) => ({
    playheadPosition: s.playheadPosition,
    clips: s.clips,
    tracks: s.tracks,
    isPlaying: s.isPlaying,
    isDraggingPlayhead: s.isDraggingPlayhead,
    ramPreviewRange: s.ramPreviewRange,
    isRamPreviewing: s.isRamPreviewing,
    clipKeyframes: s.clipKeyframes,
    getInterpolatedTransform: s.getInterpolatedTransform,
    getInterpolatedEffects: s.getInterpolatedEffects,
    getInterpolatedVectorAnimationSettings: s.getInterpolatedVectorAnimationSettings,
    getInterpolatedSpeed: s.getInterpolatedSpeed,
    getSourceTimeForClip: s.getSourceTimeForClip,
  })));
  const { clips, tracks } = state;
  const clipMap = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const { videoTracks, audioTracks, isVideoTrackVisible, isAudioTrackMuted } = useTimelineTrackVisibilityState({
    tracks,
    timelineViewTracks: tracks,
  });
  const getClipsAtTime = useCallback(
    (time: number) => clips.filter((clip) => time >= clip.startTime && time < clip.startTime + clip.duration),
    [clips],
  );

  useLayerSync({
    ...state,
    clipDrag: null,
    clipMap,
    videoTracks,
    audioTracks,
    getClipsAtTime,
    isVideoTrackVisible,
    isAudioTrackMuted,
  });
  return null;
}
