// Timeline Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import { formatTrackInfo } from '../utils';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleGetTimelineState(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const { tracks, clips, playheadPosition, duration, inPoint, outPoint, zoom, selectedClipIds } = timelineStore;

  const videoTracks = tracks.filter(t => t.type === 'video').map(t => formatTrackInfo(t, clips));
  const audioTracks = tracks.filter(t => t.type === 'audio').map(t => formatTrackInfo(t, clips));

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
      hasAnalysis: clip.analysisStatus === 'ready',
      hasTranscript: !!clip.transcript?.length,
    };
  }).filter(Boolean);

  return {
    success: true,
    data: {
      playheadPosition,
      duration,
      inPoint,
      outPoint,
      zoom,
      totalClips: clips.length,
      // Selected clips info
      selectedClipIds: selectedClipIdsArray,
      selectedClips,
      hasSelection: selectedClipIdsArray.length > 0,
      // Tracks with their clips
      videoTracks,
      audioTracks,
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
