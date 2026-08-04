import { useTimelineStore } from '../../../../stores/timeline';
import { undo as historyUndo, redo as historyRedo } from '../../../../stores/historyStore';
import { animateMarker, flashPreviewCanvas } from '../../aiFeedback';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import type { PlaybackToolResult, TimelineStore } from './runtime';
import { resolveLinkedVideoAudioPair } from '../../../../stores/timeline/helpers/linkedClipSpeed';

export async function handlePlay(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  await timelineStore.play();
  return { success: true, data: { playing: true } };
}

export async function handlePause(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  timelineStore.pause();
  return { success: true, data: { playing: false } };
}

export async function handleSetClipSpeed(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const store = useTimelineStore.getState();
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    store.clips,
  );

  if (args.speed !== undefined) {
    const speed = args.speed as number;
    if (speed <= 0) return { success: false, error: 'Speed must be positive. Use "reverse: true" for reverse playback.' };

    const changed = store.setClipSpeed(clipId, speed, {
      ...(args.preservePitch !== undefined
        ? { preservesPitch: args.preservePitch as boolean }
        : {}),
    });
    if (!changed) {
      return { success: false, error: 'Could not change clip speed. Check the supported 0.1x-10x range and track locks.' };
    }
  }

  if (args.reverse !== undefined) {
    store.toggleClipReverse(clipId);
    // If already in desired state, toggle back.
    const updated = useTimelineStore.getState().clips.find(c => c.id === clipId);
    if (updated && updated.reversed !== (args.reverse as boolean)) {
      useTimelineStore.getState().toggleClipReverse(clipId);
    }
  }

  if (args.preservePitch !== undefined && args.speed === undefined) {
    store.setClipPreservesPitch(clipId, args.preservePitch as boolean);
  }

  store.invalidateCache();

  const finalClip = useTimelineStore.getState().clips.find(c => c.id === clipId);
  const finalPair = resolveLinkedVideoAudioPair(useTimelineStore.getState().clips, clipId);
  const pitchOwner = finalPair?.audio ?? finalClip;
  return {
    success: true,
    data: {
      clipId,
      speed: finalClip?.speed ?? 1,
      reversed: finalClip?.reversed ?? false,
      preservesPitch: pitchOwner?.preservesPitch ?? true,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
      ),
    },
  };
}

export async function handleUndo(): Promise<PlaybackToolResult> {
  historyUndo();
  flashPreviewCanvas('undo');
  return { success: true, data: { action: 'undo' } };
}

export async function handleRedo(): Promise<PlaybackToolResult> {
  historyRedo();
  flashPreviewCanvas('redo');
  return { success: true, data: { action: 'redo' } };
}

export async function handleAddMarker(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const time = args.time as number;
  const label = args.label as string | undefined;
  const color = args.color as string | undefined;

  const mutationSnapshot = captureMutationEntitySnapshot(
    'marker',
    useTimelineStore.getState().markers,
  );
  const markerId = timelineStore.addMarker(time, label, color);

  // Visual feedback: marker pop animation.
  animateMarker(markerId, 'add');

  return {
    success: true,
    data: {
      markerId,
      time,
      label,
      color,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().markers,
      ),
    },
  };
}

export async function handleGetMarkers(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const markers = timelineStore.markers || [];
  return {
    success: true,
    data: {
      markers: markers.map(m => ({
        id: m.id,
        time: m.time,
        label: m.label,
        color: m.color,
      })),
    },
  };
}

export async function handleRemoveMarker(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<PlaybackToolResult> {
  const markerId = args.markerId as string;
  const mutationSnapshot = captureMutationEntitySnapshot(
    'marker',
    useTimelineStore.getState().markers,
  );

  // Visual feedback: marker fade animation before removal.
  animateMarker(markerId, 'remove');

  timelineStore.removeMarker(markerId);
  return {
    success: true,
    data: {
      removedMarkerId: markerId,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().markers,
      ),
    },
  };
}
