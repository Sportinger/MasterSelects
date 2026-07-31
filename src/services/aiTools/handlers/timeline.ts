// Timeline Tool Handlers

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { computeTimelineOccupancy } from '../../timeline/timelineOccupancy';
import type { ToolResult } from '../types';
import { formatTrackInfo } from '../utils';
import { clipHasTranscript } from '../../transcription/clipTranscriptResolver';
import {
  getStoryboardProjectSnapshot,
  projectStoryboardTimelineClips,
} from '../../../stores/storyboardStore';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleGetTimelineState(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const {
    tracks,
    clips,
    playheadPosition,
    duration,
    inPoint,
    outPoint,
    zoom,
    selectedClipIds,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    audioRegionSelection,
    timelineRangeSelection,
  } = timelineStore;

  const videoTracks = tracks.filter(t => t.type === 'video').map(t => formatTrackInfo(t, clips));
  const audioTracks = tracks.filter(t => t.type === 'audio').map(t => formatTrackInfo(t, clips));
  const occupancy = computeTimelineOccupancy(clips, tracks);

  // Get details of selected clips
  const selectedClipIdsArray = Array.from(selectedClipIds);
  const selectedClips = selectedClipIdsArray.map(id => {
    const clip = clips.find(c => c.id === id);
    if (!clip) return null;
    const track = tracks.find(t => t.id === clip.trackId);
    return {
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      trackName: track?.name || 'Unknown',
      startTime: clip.startTime,
      endTime: clip.startTime + clip.duration,
      duration: clip.duration,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      linkedClipId: clip.linkedClipId,
      hasAnalysis: clip.analysisStatus === 'ready',
      hasTranscript: clipHasTranscript(clip),
    };
  }).filter(Boolean);

  const { activeCompositionId, compositions } = useMediaStore.getState();
  const activeComposition = compositions.find((c) => c.id === activeCompositionId);
  const storyboard = projectStoryboardTimelineClips(
    getStoryboardProjectSnapshot(),
    clips,
  );

  return {
    success: true,
    data: {
      activeCompositionId: activeCompositionId ?? null,
      activeCompositionName: activeComposition?.name ?? null,
      playheadPosition,
      duration,
      inPoint,
      outPoint,
      zoom,
      waveformsEnabled,
      audioDisplayMode,
      audioFocusMode,
      audioRegionSelection,
      storyboard,
      timelineRangeSelection: timelineRangeSelection
        ? {
            startTime: timelineRangeSelection.startTime,
            endTime: timelineRangeSelection.endTime,
            trackIds: [...timelineRangeSelection.trackIds],
            ...(timelineRangeSelection.anchorTrackId === undefined
              ? {}
              : { anchorTrackId: timelineRangeSelection.anchorTrackId }),
          }
        : null,
      totalClips: clips.length,
      // Selected clips info
      selectedClipIds: selectedClipIdsArray,
      selectedClips,
      hasSelection: selectedClipIdsArray.length > 0,
      // Tracks with their clips
      videoTracks,
      audioTracks,
      occupancy: {
        stateRevision: timelineStore.timelineRevision,
        occupied: occupancy.occupied,
        clipDurationSumSeconds: occupancy.clipDurationSumSeconds,
        gapCount: occupancy.gaps.length,
        overlapCount: occupancy.overlaps.length,
        perTrack: occupancy.perTrack.map(({ trackId, occupied, clipCount }) => ({
          trackId,
          occupied,
          clipCount,
        })),
      },
    },
  };
}

export async function handleGetTimelineRangeSelection(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const selection = timelineStore.timelineRangeSelection;
  return {
    success: true,
    data: {
      selection: selection
        ? {
            startTime: selection.startTime,
            endTime: selection.endTime,
            trackIds: [...selection.trackIds],
            ...(selection.anchorTrackId === undefined
              ? {}
              : { anchorTrackId: selection.anchorTrackId }),
          }
        : null,
    },
  };
}

export async function handleSetPlayhead(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const time = args.time as number;
  timelineStore.setPlayheadPosition(Math.max(0, time));
  return { success: true, data: { newPosition: Math.max(0, time) } };
}

export async function handleSetInOutPoints(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const inPoint = args.inPoint as number | undefined;
  const outPoint = args.outPoint as number | undefined;

  if (inPoint !== undefined) {
    timelineStore.setInPoint(inPoint);
  }
  if (outPoint !== undefined) {
    timelineStore.setOutPoint(outPoint);
  }

  return { success: true, data: { inPoint, outPoint } };
}
