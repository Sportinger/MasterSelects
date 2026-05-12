import type { CompositionTimelineData, SerializableClip, TimelineClip, TimelineTrack } from '../types';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { Logger } from './logger';

const log = Logger.create('TimelineSubcomposition');

type CreateSubcompositionResult =
  | { success: true; compositionId: string; clipId?: string }
  | { success: false; reason: string };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function getSelectionClipIds(anchorClipId: string, selectedClipIds: Set<string>): Set<string> {
  if (selectedClipIds.has(anchorClipId)) {
    return new Set(selectedClipIds);
  }
  return new Set([anchorClipId]);
}

function sortClipsForTimeline(clips: TimelineClip[], tracks: TimelineTrack[]): TimelineClip[] {
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
  return [...clips].sort((a, b) => {
    const trackDelta = (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0);
    if (trackDelta !== 0) return trackDelta;
    return a.startTime - b.startTime;
  });
}

function buildSubcompositionName(existingNames: Set<string>): string {
  let index = 1;
  let name = 'Subcomposition 1';
  while (existingNames.has(name)) {
    index += 1;
    name = `Subcomposition ${index}`;
  }
  return name;
}

function normalizeNestedClip(clip: SerializableClip, selectionStart: number, selectedIds: Set<string>): SerializableClip {
  const nestedClip = clone(clip);
  nestedClip.startTime = Math.max(0, nestedClip.startTime - selectionStart);
  if (nestedClip.linkedClipId && !selectedIds.has(nestedClip.linkedClipId)) {
    nestedClip.linkedClipId = undefined;
  }
  return nestedClip;
}

function selectInsertionTrack(tracks: TimelineTrack[], selectedClips: TimelineClip[]): string | null {
  const selectedVideoClip = selectedClips.find((clip) => tracks.find(track => track.id === clip.trackId)?.type === 'video');
  const preferredTrack = selectedVideoClip ? tracks.find(track => track.id === selectedVideoClip.trackId) : null;
  if (preferredTrack?.type === 'video' && !preferredTrack.locked) {
    return preferredTrack.id;
  }

  return tracks.find(track => track.type === 'video' && !track.locked)?.id ?? null;
}

function buildNestedTimelineData(
  sourceTimeline: CompositionTimelineData,
  selectedIds: Set<string>,
  selectedClips: TimelineClip[],
  selectionStart: number,
  selectionDuration: number,
): CompositionTimelineData {
  const selectedTrackIds = new Set(selectedClips.map(clip => clip.trackId));
  const nestedTracks = sourceTimeline.tracks
    .filter(track => selectedTrackIds.has(track.id))
    .map(track => ({
      ...clone(track),
      locked: false,
      solo: false,
    }));
  const nestedClips = sourceTimeline.clips
    .filter(clip => selectedIds.has(clip.id))
    .map(clip => normalizeNestedClip(clip, selectionStart, selectedIds));
  const nestedMarkers = sourceTimeline.markers
    ?.filter(marker => marker.time >= selectionStart && marker.time <= selectionStart + selectionDuration)
    .map(marker => ({ ...clone(marker), time: Math.max(0, marker.time - selectionStart) }));

  return {
    tracks: nestedTracks,
    clips: nestedClips,
    playheadPosition: 0,
    duration: selectionDuration,
    durationLocked: true,
    zoom: sourceTimeline.zoom,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
    markers: nestedMarkers && nestedMarkers.length > 0 ? nestedMarkers : undefined,
  };
}

export async function createSubcompositionFromSelection(anchorClipId: string): Promise<CreateSubcompositionResult> {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();
  const { clips, tracks, selectedClipIds } = timelineStore;
  const selectedIds = getSelectionClipIds(anchorClipId, selectedClipIds);
  const selectedClips = sortClipsForTimeline(
    clips.filter(clip => selectedIds.has(clip.id)),
    tracks,
  );

  if (selectedClips.length === 0) {
    return { success: false, reason: 'No selected clips' };
  }

  const trackById = new Map(tracks.map(track => [track.id, track]));
  if (selectedClips.some(clip => trackById.get(clip.trackId)?.locked)) {
    return { success: false, reason: 'Selection contains locked tracks' };
  }
  const activeComposition = mediaStore.getActiveComposition();
  if (activeComposition && selectedClips.some(clip => clip.isComposition && clip.compositionId === activeComposition.id)) {
    return { success: false, reason: 'Selection would create a composition cycle' };
  }

  const selectionStart = Math.min(...selectedClips.map(clip => clip.startTime));
  const selectionEnd = Math.max(...selectedClips.map(clip => clip.startTime + clip.duration));
  const selectionDuration = Math.max(0.001, selectionEnd - selectionStart);
  const sourceTimeline = timelineStore.getSerializableState();
  const timelineData = buildNestedTimelineData(
    sourceTimeline,
    selectedIds,
    selectedClips,
    selectionStart,
    selectionDuration,
  );

  const compName = buildSubcompositionName(new Set(mediaStore.compositions.map(comp => comp.name)));
  const subcomposition = mediaStore.createComposition(compName, {
    parentId: activeComposition?.parentId ?? null,
    width: activeComposition?.width,
    height: activeComposition?.height,
    frameRate: activeComposition?.frameRate,
    duration: selectionDuration,
    backgroundColor: activeComposition?.backgroundColor,
    timelineData,
  });

  let insertionTrackId = selectInsertionTrack(tracks, selectedClips);
  if (!insertionTrackId) {
    insertionTrackId = timelineStore.addTrack('video');
  }

  const selectedIdList = [...selectedIds];
  for (const clipId of selectedIdList) {
    if (useTimelineStore.getState().clips.some(clip => clip.id === clipId)) {
      useTimelineStore.getState().removeClip(clipId);
    }
  }

  const beforeIds = new Set(useTimelineStore.getState().clips.map(clip => clip.id));
  await useTimelineStore.getState().addCompClip(insertionTrackId, subcomposition, selectionStart);
  const nextTimelineStore = useTimelineStore.getState();
  const compClip = nextTimelineStore.clips.find(
    clip => !beforeIds.has(clip.id) && clip.isComposition && clip.compositionId === subcomposition.id
  );
  if (compClip) {
    nextTimelineStore.selectClip(compClip.id);
  }

  const activeCompositionId = useMediaStore.getState().activeCompositionId;
  if (activeCompositionId) {
    const updatedTimelineData = useTimelineStore.getState().getSerializableState();
    useMediaStore.setState(state => ({
      compositions: state.compositions.map(comp =>
        comp.id === activeCompositionId ? { ...comp, timelineData: updatedTimelineData } : comp
      ),
    }));
  }

  log.info('Created subcomposition from timeline selection', {
    compositionId: subcomposition.id,
    selectedClips: selectedClips.length,
    duration: selectionDuration,
  });

  return { success: true, compositionId: subcomposition.id, clipId: compClip?.id };
}
