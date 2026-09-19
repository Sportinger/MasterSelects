import type { TimelineClip, TimelineTrack } from '../types';
import { placeSignalAssetOnTimeline } from '../runtime/renderers/signalTimelineRendererAdapter';
import { useTimelineStore } from '../stores/timeline';
import type { TimelinePlacementMode } from '../stores/timeline/editOperations/types';
import type { TimelineStore, TimelineToolPreview } from '../stores/timeline/types';
import { placeLiveInputOnTimeline } from './mediaRuntime/liveInputTimelineAdapter';
import {
  getPlacementSourceName,
  getTimelineMediaTypeOverride,
  resolveCurrentTimelinePlacementSource,
  resolveMediaFileForTimeline,
  type TimelinePlacementSource as PlacementSource,
} from './timelinePlacementSource';

export {
  hasCurrentTimelinePlacementSource,
  resolveCurrentTimelinePlacementSource,
} from './timelinePlacementSource';

const EPSILON = 0.001;

export interface TimelinePlacementCommandResult {
  success: boolean;
  reason?: string;
  createdClipId?: string;
}

function clipEnd(clip: Pick<TimelineClip, 'startTime' | 'duration'>): number {
  return clip.startTime + clip.duration;
}

function rangesOverlap(startTime: number, duration: number, clip: TimelineClip): boolean {
  const endTime = startTime + duration;
  return startTime < clipEnd(clip) - EPSILON && endTime > clip.startTime + EPSILON;
}

function isTrackCompatible(track: TimelineTrack, source: PlacementSource): boolean {
  return track.type === source.trackType && track.locked !== true && track.visible !== false;
}

function getTargetTrackForSource(state: TimelineStore, source: PlacementSource): TimelineTrack | null {
  const targetTrackId = state.targetTrackIdByType?.[source.trackType];
  if (!targetTrackId) return null;
  const track = state.tracks.find((item) => item.id === targetTrackId);
  return track && isTrackCompatible(track, source) ? track : null;
}

function getSelectedTargetClip(state: TimelineStore, source: PlacementSource): TimelineClip | null {
  const preferredId = state.primarySelectedClipId && state.selectedClipIds.has(state.primarySelectedClipId)
    ? state.primarySelectedClipId
    : [...state.selectedClipIds][0];
  const preferred = preferredId ? state.clips.find((clip) => clip.id === preferredId) : undefined;
  const preferredTrack = preferred
    ? state.tracks.find((track) => track.id === preferred.trackId)
    : undefined;
  if (preferred && preferredTrack && isTrackCompatible(preferredTrack, source)) {
    return preferred;
  }

  return state.clips.find((clip) => {
    if (!state.selectedClipIds.has(clip.id)) return false;
    const track = state.tracks.find((item) => item.id === clip.trackId);
    return track ? isTrackCompatible(track, source) : false;
  }) ?? null;
}

function getCompatibleRangeTrackIds(state: TimelineStore, source: PlacementSource): string[] {
  const range = state.timelineRangeSelection;
  if (!range) return [];
  const ids = range.trackIds.filter((trackId) => {
    const track = state.tracks.find((item) => item.id === trackId);
    return track ? isTrackCompatible(track, source) : false;
  });
  return [...new Set(ids)];
}

function findFirstCompatibleTrackId(state: TimelineStore, source: PlacementSource): string | null {
  const targetTrack = getTargetTrackForSource(state, source);
  if (targetTrack) return targetTrack.id;
  return state.tracks.find((track) => isTrackCompatible(track, source))?.id ?? null;
}

function findFreeCompatibleTrackId(
  state: TimelineStore,
  source: PlacementSource,
  startTime: number,
  duration: number,
): string | null {
  return state.tracks.find((track) =>
    isTrackCompatible(track, source) &&
    !state.clips.some((clip) => clip.trackId === track.id && rangesOverlap(startTime, duration, clip))
  )?.id ?? null;
}

function getLinkedAudioTrackId(state: TimelineStore, startTime: number, duration: number): string | null {
  const audioTracks = state.tracks.filter((track) => track.type === 'audio' && track.locked !== true && track.visible !== false);
  const targetAudioTrackId = state.targetTrackIdByType?.audio;
  const targetAudioTrack = targetAudioTrackId
    ? audioTracks.find((track) => track.id === targetAudioTrackId)
    : undefined;
  if (
    targetAudioTrack &&
    !state.clips.some((clip) => clip.trackId === targetAudioTrack.id && rangesOverlap(startTime, duration, clip))
  ) {
    return targetAudioTrack.id;
  }
  return audioTracks.find((track) =>
    !state.clips.some((clip) => clip.trackId === track.id && rangesOverlap(startTime, duration, clip))
  )?.id ?? audioTracks[0]?.id ?? null;
}

function getSequenceEnd(state: TimelineStore, trackId: string): number {
  const trackEnds = state.clips
    .filter((clip) => clip.trackId === trackId)
    .map(clipEnd);
  return trackEnds.length > 0 ? Math.max(...trackEnds) : 0;
}

function getTrackIdsForSource(state: TimelineStore, source: PlacementSource, primaryTrackId: string, startTime: number, duration: number): string[] {
  const trackIds = new Set<string>([primaryTrackId]);
  if (source.kind === 'media-file' && source.trackType === 'video' && source.hasAudio) {
    const audioTrackId = getLinkedAudioTrackId(state, startTime, duration);
    if (audioTrackId) trackIds.add(audioTrackId);
  }
  if (source.kind === 'composition' && source.hasAudio) {
    const audioTrackId = getLinkedAudioTrackId(state, startTime, duration);
    if (audioTrackId) trackIds.add(audioTrackId);
  }
  return [...trackIds];
}

function resolveTarget(state: TimelineStore, source: PlacementSource, mode: TimelinePlacementMode): {
  trackId: string | null;
  trackIds: string[];
  startTime: number;
  prepareDuration: number;
  clipDuration: number;
  targetClipId?: string;
  rippleDelta?: number;
} {
  const sourceDuration = source.duration;

  if (mode === 'replace' || mode === 'fit-to-fill' || mode === 'ripple-overwrite') {
    const range = state.timelineRangeSelection;
    const rangeTrackIds = getCompatibleRangeTrackIds(state, source);
    if (range && rangeTrackIds.length > 0) {
      const targetDuration = Math.max(EPSILON, range.endTime - range.startTime);
      const clipDuration = mode === 'ripple-overwrite' ? sourceDuration : targetDuration;
      const trackId = range.anchorTrackId && rangeTrackIds.includes(range.anchorTrackId) ? range.anchorTrackId : rangeTrackIds[0];
      return {
        trackId,
        trackIds: trackId
          ? [...new Set([...rangeTrackIds, ...getTrackIdsForSource(state, source, trackId, range.startTime, targetDuration)])]
          : rangeTrackIds,
        startTime: range.startTime,
        prepareDuration: targetDuration,
        clipDuration,
        rippleDelta: mode === 'ripple-overwrite' ? sourceDuration - targetDuration : undefined,
      };
    }

    const targetClip = getSelectedTargetClip(state, source);
    if (targetClip) {
      const clipDuration = mode === 'ripple-overwrite' ? sourceDuration : targetClip.duration;
      return {
        trackId: targetClip.trackId,
        trackIds: getTrackIdsForSource(state, source, targetClip.trackId, targetClip.startTime, targetClip.duration),
        startTime: targetClip.startTime,
        prepareDuration: targetClip.duration,
        clipDuration,
        targetClipId: targetClip.id,
        rippleDelta: mode === 'ripple-overwrite' ? sourceDuration - targetClip.duration : undefined,
      };
    }
  }

  if (mode === 'append-at-end') {
    const trackId = findFirstCompatibleTrackId(state, source);
    const startTime = trackId ? getSequenceEnd(state, trackId) : state.duration;
    return {
      trackId,
      trackIds: trackId ? getTrackIdsForSource(state, source, trackId, startTime, sourceDuration) : [],
      startTime,
      prepareDuration: sourceDuration,
      clipDuration: sourceDuration,
    };
  }

  if (mode === 'place-on-top') {
    const startTime = state.playheadPosition;
    const trackId = source.trackType === 'video'
      ? findFreeCompatibleTrackId(state, source, startTime, sourceDuration)
      : null;
    return {
      trackId,
      trackIds: trackId ? [trackId] : [],
      startTime,
      prepareDuration: sourceDuration,
      clipDuration: sourceDuration,
    };
  }

  const startTime = state.playheadPosition;
  const targetClip = getSelectedTargetClip(state, source);
  const trackId = targetClip?.trackId ?? findFirstCompatibleTrackId(state, source);
  return {
    trackId,
    trackIds: trackId ? getTrackIdsForSource(state, source, trackId, startTime, sourceDuration) : [],
    startTime,
    prepareDuration: sourceDuration,
    clipDuration: sourceDuration,
  };
}

export function resolveTimelinePlacementCommandPreview(mode: TimelinePlacementMode): TimelineToolPreview | null {
  const source = resolveCurrentTimelinePlacementSource();
  if (!source) {
    return {
      toolId: mode,
      plane: 'global-fixed',
      blocked: true,
      message: 'No source media item is selected.',
    };
  }

  const state = useTimelineStore.getState();
  const target = resolveTarget(state, source, mode);
  let trackId = target.trackId;

  if (!trackId && mode === 'place-on-top' && source.trackType !== 'video') {
    return {
      toolId: mode,
      plane: 'global-fixed',
      blocked: true,
      message: 'Place on Top requires a visual source.',
    };
  }

  if (!trackId) {
    trackId = findFirstCompatibleTrackId(state, source);
  }

  if (!trackId) {
    return {
      toolId: mode,
      plane: 'global-fixed',
      blocked: true,
      message: `No ${source.trackType} track is available.`,
    };
  }

  const duration = Math.max(EPSILON, target.clipDuration);
  const trackIds = target.trackIds.length > 0
    ? target.trackIds
    : getTrackIdsForSource(state, source, trackId, target.startTime, duration);

  return {
    toolId: mode,
    plane: 'section-scrolled',
    trackId,
    trackIds,
    startTime: target.startTime,
    endTime: target.startTime + duration,
    sourceInPoint: source.sourceInPoint,
    sourceOutPoint: source.sourceInPoint + source.duration,
    label: getPlacementSourceName(source),
    message: `${mode.replace(/-/g, ' ')} preview`,
  };
}

export function showTimelinePlacementCommandPreview(mode: TimelinePlacementMode): TimelineToolPreview | null {
  const preview = resolveTimelinePlacementCommandPreview(mode);
  useTimelineStore.getState().setTimelineToolPreview(preview);
  return preview;
}

export function clearTimelinePlacementCommandPreview(mode?: TimelinePlacementMode): void {
  const state = useTimelineStore.getState();
  const current = state.timelineToolPreview;
  if (!current) return;
  if (mode && current.toolId !== mode) return;
  state.setTimelineToolPreview(null);
}

function applyCreatedClipTiming(
  clipId: string | null | undefined,
  clipDuration: number,
  sourceDuration: number,
  mode: TimelinePlacementMode,
  sourceInPoint: number,
  naturalDuration: number,
): void {
  if (!clipId) return;

  const state = useTimelineStore.getState();
  const clip = state.clips.find((item) => item.id === clipId);
  if (!clip) return;

  const createPatch = (targetClip: TimelineClip): Partial<TimelineClip> => {
    const patch: Partial<TimelineClip> = {
      duration: clipDuration,
      inPoint: sourceInPoint,
      outPoint: sourceInPoint + (mode === 'fit-to-fill' ? sourceDuration : clipDuration),
      source: targetClip.source
        ? { ...targetClip.source, naturalDuration }
        : targetClip.source,
    };

    if (mode === 'fit-to-fill' && sourceDuration > EPSILON && clipDuration > EPSILON) {
      patch.speed = sourceDuration / clipDuration;
    }

    return patch;
  };

  state.updateClip(clip.id, createPatch(clip));

  const nextLinkedClip = useTimelineStore.getState().clips.find((item) => item.id === clip.linkedClipId);
  if (nextLinkedClip) {
    useTimelineStore.getState().updateClip(nextLinkedClip.id, createPatch(nextLinkedClip));
  }
}

async function placeSource(
  source: PlacementSource,
  trackId: string,
  startTime: number,
  clipDuration: number,
  mode: TimelinePlacementMode,
): Promise<string | null> {
  const state = useTimelineStore.getState();
  let createdClipId: string | null | undefined;

  if (source.kind === 'media-file') {
    if (source.item.liveInput) {
      createdClipId = placeLiveInputOnTimeline({ item: source.item, trackId, startTime, duration: clipDuration });
    } else {
      const file = await resolveMediaFileForTimeline(source.item);
      if (!file) return null;
      createdClipId = await state.addClip(
        trackId,
        file,
        startTime,
        clipDuration,
        source.item.id,
        getTimelineMediaTypeOverride(source.item),
        { source: { naturalDuration: source.naturalDuration } },
      );
    }
  } else if (source.kind === 'composition') {
    const beforeIds = new Set(state.clips.map((clip) => clip.id));
    await state.addCompClip(trackId, source.item, startTime);
    createdClipId = useTimelineStore.getState().clips.find((clip) =>
      !beforeIds.has(clip.id) &&
      clip.trackId === trackId &&
      Math.abs(clip.startTime - startTime) <= EPSILON
    )?.id;
  } else if (source.kind === 'text') {
    createdClipId = await state.addTextClip(trackId, startTime, clipDuration, true, source.item);
  } else if (source.kind === 'solid') {
    createdClipId = state.addSolidClip(trackId, startTime, source.item.color, clipDuration, true);
  } else if (source.kind === 'mesh') {
    createdClipId = state.addMeshClip(trackId, startTime, source.item.meshType, clipDuration, true, source.item);
  } else if (source.kind === 'camera') {
    createdClipId = state.addCameraClip(trackId, startTime, clipDuration, true, source.item);
  } else if (source.kind === 'light') {
    createdClipId = state.addLightClip(trackId, startTime, clipDuration, true, source.item.lightSettings, source.item.id);
  } else if (source.kind === 'splat-effector') {
    createdClipId = state.addSplatEffectorClip(trackId, startTime, clipDuration, true);
  } else if (source.kind === 'math-scene') {
    createdClipId = state.addMathSceneClip(trackId, startTime, clipDuration, true);
  } else if (source.kind === 'motion-shape') {
    createdClipId = state.addMotionShapeClip(trackId, startTime, {
      primitive: source.item.primitive,
      duration: clipDuration,
      name: source.item.name,
    });
  } else {
    const result = await placeSignalAssetOnTimeline(source.item, trackId, startTime, {
      addClip: state.addClip,
      addTextClip: state.addTextClip,
      updateTextProperties: state.updateTextProperties,
      updateClip: state.updateClip,
    });
    createdClipId = result.clipId;
  }

  applyCreatedClipTiming(createdClipId, clipDuration, source.duration, mode, source.sourceInPoint, source.naturalDuration);
  return createdClipId ?? null;
}

export async function runTimelinePlacementCommand(mode: TimelinePlacementMode): Promise<TimelinePlacementCommandResult> {
  const source = resolveCurrentTimelinePlacementSource();
  if (!source) {
    return { success: false, reason: 'No source media item is selected.' };
  }

  const initialState = useTimelineStore.getState();
  const target = resolveTarget(initialState, source, mode);
  let trackId = target.trackId;

  if (!trackId && mode === 'place-on-top' && source.trackType !== 'video') {
    return { success: false, reason: 'Place on Top requires a visual source.' };
  }

  if (!trackId && mode === 'place-on-top' && source.trackType === 'video') {
    trackId = initialState.addTrack('video') ?? null;
  } else if (!trackId) {
    trackId = initialState.addTrack(source.trackType) ?? null;
  }

  if (!trackId) {
    return { success: false, reason: `No ${source.trackType} track is available.` };
  }

  const latestState = useTimelineStore.getState();
  const trackIds = target.trackIds.length > 0
    ? target.trackIds
    : getTrackIdsForSource(latestState, source, trackId, target.startTime, target.prepareDuration);

  if (mode !== 'append-at-end' && mode !== 'place-on-top') {
    latestState.prepareTimelinePlacementRange(mode, {
      trackIds,
      targetClipId: target.targetClipId,
      startTime: target.startTime,
      duration: target.prepareDuration,
      includeLinked: true,
      source: 'ui',
      rippleDelta: target.rippleDelta,
      historyLabel: `${mode.replace(/-/g, ' ')} placement`,
    });
  }

  const createdClipId = await placeSource(source, trackId, target.startTime, target.clipDuration, mode);
  if (!createdClipId) {
    return { success: false, reason: 'The selected source could not be placed on the timeline.' };
  }

  useTimelineStore.getState().selectClip(createdClipId);
  return { success: true, createdClipId };
}
