import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useTimelinePickWhipContext } from '../TimelinePickWhipContext';
import type { TimelineTrackProps } from '../types';
import type { ClipInteractionShellSpectralImageMediaRef } from '../interactionShell';
import { buildTimelineTrackClipShellActiveModules } from '../utils/timelineTrackShellActiveModules';
import {
  buildTimelineTrackClipShellMountState,
  buildTimelineTrackShellDomControlClipIds,
  buildTimelineTrackShellKeyframeStateByClipId,
  buildTimelineTrackShellSpecialStateByClipId,
  countTimelineTrackShellSlots,
  type TimelineTrackShellClip,
  type TimelineTrackShellFadeState,
} from '../utils/timelineTrackInteractionShellState';
import { useTimelineTrackParentingClipIds } from './useTimelineTrackParentingClipIds';

type UseTimelineTrackInteractionShellStateArgs = Pick<
  TimelineTrackProps,
  | 'track'
  | 'selectedClipIds'
  | 'clipKeyframes'
  | 'selectedKeyframeIds'
  | 'clipDrag'
  | 'clipTrim'
  | 'clipFade'
  | 'clipContextMenu'
  | 'audioRegionSelection'
  | 'audioRegionGainPreview'
  | 'audioSpectralRegionSelection'
  | 'audioDisplayMode'
  | 'videoBakeRegionSelection'
  | 'clipStemSeparationJobs'
  | 'activeTimelineToolId'
> & {
  allTrackClips: readonly TimelineTrackShellClip[];
  trackClips: readonly TimelineTrackShellClip[];
  canvasClips: readonly TimelineTrackShellClip[];
  clipRenameId: string | null;
  hoveredClipId: string | null;
  getClipFadeVisualState: (clip: TimelineTrackShellClip) => TimelineTrackShellFadeState;
};

export function useTimelineTrackInteractionShellState({
  track,
  selectedClipIds,
  allTrackClips,
  trackClips,
  canvasClips,
  clipKeyframes,
  selectedKeyframeIds,
  clipDrag,
  clipTrim,
  clipFade,
  clipContextMenu,
  audioRegionSelection,
  audioRegionGainPreview,
  audioSpectralRegionSelection,
  audioDisplayMode,
  videoBakeRegionSelection,
  clipStemSeparationJobs,
  activeTimelineToolId,
  clipRenameId,
  hoveredClipId,
  getClipFadeVisualState,
}: UseTimelineTrackInteractionShellStateArgs) {
  const { audioFocusMode, showAudioRegionEditMarkers } = useTimelineStore(useShallow((state) => ({ audioFocusMode: state.audioFocusMode, showAudioRegionEditMarkers: state.showAudioRegionEditMarkers })));
  const hasAudioRegionClipboard = useTimelineStore((state) => state.audioRegionClipboard !== null);
  const mediaFilesState = useMediaStore((state) => state.files);
  const selectedMediaIdsState = useMediaStore((state) => state.selectedIds);
  const pickWhipContext = useTimelinePickWhipContext();
  const parentingClipIds = useTimelineTrackParentingClipIds({
    trackClips,
    selectedClipIds,
    hoveredClipId,
    pickWhipDrag: pickWhipContext?.drag ?? null,
    parentingEnabled: pickWhipContext !== null && track.type === 'video',
  });
  const mediaFiles = useMemo(() => (Array.isArray(mediaFilesState) ? mediaFilesState : []), [mediaFilesState]);
  const selectedMediaIds = useMemo(
    () => (Array.isArray(selectedMediaIdsState) ? selectedMediaIdsState : []),
    [selectedMediaIdsState],
  );
  const spectralImageMediaRefs = useMemo<readonly ClipInteractionShellSpectralImageMediaRef[]>(() => (
    mediaFiles
      .filter((file) => file.type === 'image')
      .map((file) => ({
        id: file.id,
        name: file.name,
        type: file.type,
        url: file.url,
        thumbnailUrl: file.thumbnailUrl,
      }))
  ), [mediaFiles]);
  const selectedSpectralImageFile = useMemo(() => {
    const imageRefsById = new Map(spectralImageMediaRefs.map((file) => [file.id, file] as const));
    for (const id of selectedMediaIds) {
      const file = imageRefsById.get(id);
      if (file?.type === 'image') return file;
    }
    return null;
  }, [selectedMediaIds, spectralImageMediaRefs]);

  const keyframeStateByClipId = useMemo(() => buildTimelineTrackShellKeyframeStateByClipId({
    allTrackClips,
    clipKeyframes,
    hoveredClipId,
    selectedKeyframeIds,
  }), [allTrackClips, clipKeyframes, hoveredClipId, selectedKeyframeIds]);

  const specialStateByClipId = useMemo(() => buildTimelineTrackShellSpecialStateByClipId({
    allTrackClips,
    audioDisplayMode,
    audioRegionGainPreview,
    audioRegionSelection,
    audioSpectralRegionSelection,
    clipStemSeparationJobs,
    hoveredClipId,
    videoBakeRegionSelection,
  }), [
    allTrackClips,
    audioDisplayMode,
    audioRegionGainPreview,
    audioRegionSelection,
    audioSpectralRegionSelection,
    clipStemSeparationJobs,
    hoveredClipId,
    videoBakeRegionSelection,
  ]);

  const domControlClipIds = useMemo(() => buildTimelineTrackShellDomControlClipIds({
    allTrackClips,
    trackClips,
    clipDrag,
    clipTrim,
    clipFade,
    clipContextMenu,
    clipRenameId,
    hoveredClipId,
    keyframeStateByClipId,
    specialStateByClipId,
    parentingClipIds,
  }), [
    allTrackClips,
    trackClips,
    clipDrag,
    clipTrim,
    clipFade,
    clipContextMenu,
    clipRenameId,
    hoveredClipId,
    keyframeStateByClipId,
    specialStateByClipId,
    parentingClipIds,
  ]);

  const domControlClips = useMemo(
    () => canvasClips.filter((clip) => domControlClipIds.has(clip.id)),
    [canvasClips, domControlClipIds],
  );

  const activeShellSlotCounts = useMemo(() => countTimelineTrackShellSlots({
    clips: domControlClips,
    clipTrim,
    clipFade,
    clipContextMenu,
    keyframeStateByClipId,
    specialStateByClipId,
    parentingClipIds,
  }), [clipContextMenu, clipFade, clipTrim, domControlClips, keyframeStateByClipId, parentingClipIds, specialStateByClipId]);

  const getClipShellMountState = useCallback((clipId: string) => buildTimelineTrackClipShellMountState({
    clipId,
    clipDrag,
    clipTrim,
    clipFade,
    clipContextMenu,
    hoveredClipId,
    keyframeStateByClipId,
    specialStateByClipId,
    parentingClipIds,
  }), [clipContextMenu, clipDrag, clipFade, clipTrim, hoveredClipId, keyframeStateByClipId, parentingClipIds, specialStateByClipId]);

  const getClipShellActiveModules = useCallback((clip: TimelineTrackShellClip) => buildTimelineTrackClipShellActiveModules({
    clip,
    track,
    allTrackClips,
    activeTimelineToolId,
    audioDisplayMode,
    audioFocusMode,
    audioRegionGainPreview,
    audioRegionSelection,
    audioSpectralRegionSelection,
    clipContextMenu,
    clipFade,
    clipTrim,
    fadeVisualState: getClipFadeVisualState(clip),
    hasAudioRegionClipboard,
    hoveredClipId,
    keyframeState: keyframeStateByClipId.get(clip.id),
    selectedSpectralImageFile,
    showAudioRegionEditMarkers,
    specialState: specialStateByClipId.get(clip.id),
    spectralImageMediaRefs,
    videoBakeRegionSelection,
    parentingEnabled: parentingClipIds.has(clip.id),
  }), [
    activeTimelineToolId,
    allTrackClips,
    audioDisplayMode,
    audioFocusMode,
    audioRegionGainPreview,
    audioRegionSelection,
    audioSpectralRegionSelection,
    clipContextMenu,
    clipFade,
    clipTrim,
    getClipFadeVisualState,
    hasAudioRegionClipboard,
    hoveredClipId,
    keyframeStateByClipId,
    selectedSpectralImageFile,
    showAudioRegionEditMarkers,
    specialStateByClipId,
    spectralImageMediaRefs,
    track,
    videoBakeRegionSelection,
    parentingClipIds,
  ]);

  return {
    activeShellSlotCounts,
    domControlClips,
    getClipShellActiveModules,
    getClipShellMountState,
  };
}
