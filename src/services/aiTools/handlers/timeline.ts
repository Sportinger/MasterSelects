// Timeline Tool Handlers

import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { computeTimelineOccupancy } from '../../timeline/timelineOccupancy';
import type { ToolResult } from '../types';
import { formatTrackInfo } from '../utils';
import { clipHasTranscript } from '../../transcription/clipTranscriptResolver';
import {
  TIMELINE_SPEECH_MAX_WORDS,
  TIMELINE_SPEECH_TOOL_DEFAULT_PAGE_WORDS,
  TIMELINE_SPEECH_TOOL_MAX_PAGE_WORDS,
} from '../../transcription/timelineSpeechContract';
import {
  buildTimelineSpeechProjection,
  buildTimelineSpeechSegments,
  joinTimelineSpeechWords,
} from '../../transcription/timelineSpeechProjection';
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

export async function handleGetTimelineTranscript(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const rawCursor = args.cursor ?? 0;
  const rawLimit = args.limit ?? TIMELINE_SPEECH_TOOL_DEFAULT_PAGE_WORDS;
  const detail = args.detail ?? 'segments';
  if (!Number.isInteger(rawCursor) || Number(rawCursor) < 0) {
    return { success: false, error: 'cursor must be a non-negative integer word offset.' };
  }
  if (
    !Number.isInteger(rawLimit)
    || Number(rawLimit) < 1
    || Number(rawLimit) > TIMELINE_SPEECH_TOOL_MAX_PAGE_WORDS
  ) {
    return {
      success: false,
      error: `limit must be an integer from 1 to ${TIMELINE_SPEECH_TOOL_MAX_PAGE_WORDS}.`,
    };
  }
  if (detail !== 'text' && detail !== 'segments' && detail !== 'words') {
    return { success: false, error: 'detail must be text, segments, or words.' };
  }
  if (
    args.timelineRevision !== undefined
    && (!Number.isInteger(args.timelineRevision) || Number(args.timelineRevision) < 0)
  ) {
    return { success: false, error: 'timelineRevision must be a non-negative integer.' };
  }
  if (
    args.timelineRevision !== undefined
    && Number(args.timelineRevision) !== timelineStore.timelineRevision
  ) {
    return {
      success: false,
      error: `Timeline revision changed from ${String(args.timelineRevision)} to ${timelineStore.timelineRevision}; restart transcript pagination at cursor 0.`,
    };
  }
  if (args.startTime !== undefined && (typeof args.startTime !== 'number' || !Number.isFinite(args.startTime))) {
    return { success: false, error: 'startTime must be a finite timeline time in seconds.' };
  }
  if (args.endTime !== undefined && (typeof args.endTime !== 'number' || !Number.isFinite(args.endTime))) {
    return { success: false, error: 'endTime must be a finite timeline time in seconds.' };
  }

  const projection = buildTimelineSpeechProjection({
    clips: timelineStore.clips,
    ...(typeof args.endTime === 'number' ? { endTime: args.endTime } : {}),
    maximumWords: TIMELINE_SPEECH_MAX_WORDS,
    ...(typeof args.startTime === 'number' ? { startTime: args.startTime } : {}),
    tracks: timelineStore.tracks,
  });
  const cursor = Number(rawCursor);
  const limit = Number(rawLimit);
  if (cursor > projection.words.length) {
    return {
      success: false,
      error: `cursor exceeds the available timeline transcript word count (${projection.words.length}).`,
    };
  }
  const words = projection.words.slice(cursor, cursor + limit);
  const nextCursor = cursor + words.length < projection.words.length
    ? cursor + words.length
    : null;

  return {
    success: true,
    data: {
      schemaVersion: 1,
      audibleClipCount: projection.audibleClipCount,
      availableWordCount: projection.words.length,
      complete: nextCursor === null && !projection.truncated,
      cursor,
      detail,
      excluded: projection.excluded,
      hardLimitWords: TIMELINE_SPEECH_MAX_WORDS,
      limit,
      nextCursor,
      overlappingWordCount: projection.overlappingWordCount,
      range: projection.range,
      returned: words.length,
      sourceClipCount: projection.sourceClipCount,
      text: joinTimelineSpeechWords(words),
      timebase: projection.timebase,
      timelineRevision: timelineStore.timelineRevision,
      totalWordCount: projection.totalWords,
      truncatedAtHardLimit: projection.truncated,
      ...(detail === 'segments' ? { segments: buildTimelineSpeechSegments(words) } : {}),
      ...(detail === 'words' ? { words } : {}),
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
