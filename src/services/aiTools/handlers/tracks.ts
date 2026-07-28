// Track Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleCreateTrack(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const type = args.type as 'video' | 'audio';
  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  const trackId = timelineStore.addTrack(type);
  const track = timelineStore.tracks.find(t => t.id === trackId);

  return {
    success: true,
    data: {
      trackId,
      trackName: track?.name,
      trackType: type,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().tracks,
      ),
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

  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  timelineStore.removeTrack(trackId);
  return {
    success: true,
    data: {
      deletedTrackId: trackId,
      trackName: track.name,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().tracks,
      ),
    },
  };
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

  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  timelineStore.setTrackVisible(trackId, visible);
  return {
    success: true,
    data: {
      trackId,
      visible,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().tracks,
      ),
    },
  };
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

  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  timelineStore.setTrackMuted(trackId, muted);
  return {
    success: true,
    data: {
      trackId,
      muted,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().tracks,
      ),
    },
  };
}
