// Track Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import { getSimpleSynthPreset, SIMPLE_SYNTH_PRESETS } from '../../../engine/audio/synth/simpleSynthPresets';
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
  const type = args.type as 'video' | 'audio' | 'midi';
  if (!['video', 'audio', 'midi'].includes(type)) return { success: false, error: 'type must be video, audio or midi.' };
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const preset = args.instrument === undefined ? undefined : getSimpleSynthPreset(String(args.instrument));
  if (args.instrument !== undefined && (type !== 'midi' || !preset)) {
    return { success: false, error: type !== 'midi' ? 'instrument needs a midi track.'
      : `Unknown instrument: ${String(args.instrument)}. Presets: ${SIMPLE_SYNTH_PRESETS.map(item => item.id).join(', ')}` };
  }
  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  const trackId = timelineStore.addTrack(type);
  if (name) useTimelineStore.getState().renameTrack(trackId, name);
  if (preset) useTimelineStore.getState().setTrackMidiInstrument(trackId, structuredClone(preset.instrument));
  const track = useTimelineStore.getState().tracks.find(t => t.id === trackId);

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

export async function handleRenameTrack(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const trackId = args.trackId as string;
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return { success: false, error: 'Track name must not be empty' };
  if (!timelineStore.tracks.some(t => t.id === trackId)) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  const mutationSnapshot = captureMutationEntitySnapshot(
    'track',
    useTimelineStore.getState().tracks,
  );
  useTimelineStore.getState().renameTrack(trackId, name);
  return {
    success: true,
    data: {
      trackId,
      trackName: name,
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
