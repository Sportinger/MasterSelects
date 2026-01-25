// Track Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleCreateTrack(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const type = args.type as 'video' | 'audio';
  const trackId = timelineStore.addTrack(type);
  const track = timelineStore.tracks.find(t => t.id === trackId);

  return {
    success: true,
    data: {
      trackId,
      trackName: track?.name,
      trackType: type,
    },
  };
}

export async function handleDeleteTrack(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const trackId = args.trackId as string;
  const track = timelineStore.tracks.find(t => t.id === trackId);
  if (!track) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  timelineStore.removeTrack(trackId);
  return { success: true, data: { deletedTrackId: trackId, trackName: track.name } };
}

export async function handleSetTrackVisibility(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const trackId = args.trackId as string;
  const visible = args.visible as boolean;

  const track = timelineStore.tracks.find(t => t.id === trackId);
  if (!track) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  timelineStore.setTrackVisible(trackId, visible);
  return { success: true, data: { trackId, visible } };
}

export async function handleSetTrackMuted(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const trackId = args.trackId as string;
  const muted = args.muted as boolean;

  const track = timelineStore.tracks.find(t => t.id === trackId);
  if (!track) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  timelineStore.setTrackMuted(trackId, muted);
  return { success: true, data: { trackId, muted } };
}
