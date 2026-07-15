import type {
  SavedDockTimelineLayout,
  SavedDockTimelineTrackSlotLayout,
} from '../../types/dock';
import { useTimelineStore } from '../timeline';
import {
  cleanupSavedTimelineLayout,
  TIMELINE_TRACK_TYPES,
  type TimelineTrackType,
} from './timelineLayoutPersistence';

export function captureTimelineLayout(): SavedDockTimelineLayout {
  const timelineState = useTimelineStore.getState();
  const videoTracks = timelineState.tracks.filter((track) => track.type === 'video');
  const audioTracks = timelineState.tracks.filter((track) => track.type === 'audio');
  const firstVideoTrack = videoTracks[0];
  const firstAudioTrack = audioTracks[0];
  const toTrackSlotLayouts = (tracks: typeof timelineState.tracks): SavedDockTimelineTrackSlotLayout[] => (
    tracks.map((track) => ({
      height: track.height,
      visible: track.visible !== false,
    }))
  );

  return {
    audioDisplayMode: timelineState.audioDisplayMode,
    audioLayerAdvancedMode: timelineState.audioLayerAdvancedMode !== false,
    audioFocusMode: timelineState.audioFocusMode,
    trackFocusMode: timelineState.trackFocusMode,
    trackHeaderWidth: timelineState.trackHeaderWidth,
    timelineSplitRatio: timelineState.timelineSplitRatio,
    trackHeights: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.height]),
    ),
    trackTypeHeights: {
      ...(firstVideoTrack ? { video: firstVideoTrack.height } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.height } : {}),
    },
    trackVisibility: Object.fromEntries(
      timelineState.tracks.map((track) => [track.id, track.visible !== false]),
    ),
    trackTypeVisibility: {
      ...(firstVideoTrack ? { video: firstVideoTrack.visible !== false } : {}),
      ...(firstAudioTrack ? { audio: firstAudioTrack.visible !== false } : {}),
    },
    trackTypeCounts: {
      video: videoTracks.length,
      audio: audioTracks.length,
    },
    trackTypeLayouts: {
      video: toTrackSlotLayouts(videoTracks),
      audio: toTrackSlotLayouts(audioTracks),
    },
  };
}

function getTimelineTrackTypeTargetCount(
  timeline: SavedDockTimelineLayout,
  type: TimelineTrackType,
): number {
  return Math.max(
    timeline.trackTypeCounts?.[type] ?? 0,
    timeline.trackTypeLayouts?.[type]?.length ?? 0,
  );
}

function ensureTimelineTrackTypeCounts(timeline: SavedDockTimelineLayout): void {
  for (const type of TIMELINE_TRACK_TYPES) {
    const targetCount = getTimelineTrackTypeTargetCount(timeline, type);
    if (targetCount <= 0) {
      continue;
    }

    let currentCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
    while (currentCount < targetCount) {
      useTimelineStore.getState().addTrack(type);
      const nextCount = useTimelineStore.getState().tracks.filter((track) => track.type === type).length;
      if (nextCount <= currentCount) {
        break;
      }
      currentCount = nextCount;
    }
  }
}

export function applySavedTimelineLayout(timeline: SavedDockTimelineLayout | undefined): void {
  const cleaned = cleanupSavedTimelineLayout(timeline);
  if (!cleaned) {
    return;
  }

  ensureTimelineTrackTypeCounts(cleaned);

  const timelineStore = useTimelineStore.getState();
  if (cleaned.audioDisplayMode) {
    timelineStore.setAudioDisplayMode(cleaned.audioDisplayMode);
  }
  if (typeof cleaned.audioLayerAdvancedMode === 'boolean') {
    timelineStore.setAudioLayerAdvancedMode(cleaned.audioLayerAdvancedMode);
  }
  if (cleaned.trackFocusMode) {
    timelineStore.setTrackFocusMode(cleaned.trackFocusMode);
  } else if (typeof cleaned.audioFocusMode === 'boolean') {
    timelineStore.setAudioFocusMode(cleaned.audioFocusMode);
  }
  if (typeof cleaned.trackHeaderWidth === 'number') {
    timelineStore.setTrackHeaderWidth(cleaned.trackHeaderWidth);
  }
  if ('timelineSplitRatio' in cleaned) {
    timelineStore.setTimelineSplitRatio(cleaned.timelineSplitRatio ?? null);
  }

  const exactTrackHeightIds = new Set(Object.keys(cleaned.trackHeights ?? {}));
  if (cleaned.trackHeights) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, height] of Object.entries(cleaned.trackHeights)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackHeight(trackId, height);
      }
    }
  }

  const indexedTrackHeightIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackHeightIds.has(track.id) || typeof slot.height !== 'number') {
          return;
        }
        useTimelineStore.getState().setTrackHeight(track.id, slot.height);
        indexedTrackHeightIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeHeights) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackHeightIds.has(track.id) || indexedTrackHeightIds.has(track.id)) {
        continue;
      }
      const typeHeight = cleaned.trackTypeHeights[track.type];
      if (typeof typeHeight === 'number') {
        useTimelineStore.getState().setTrackHeight(track.id, typeHeight);
      }
    }
  }

  const exactTrackVisibilityIds = new Set(Object.keys(cleaned.trackVisibility ?? {}));
  if (cleaned.trackVisibility) {
    const currentTrackIds = new Set(useTimelineStore.getState().tracks.map((track) => track.id));
    for (const [trackId, visible] of Object.entries(cleaned.trackVisibility)) {
      if (currentTrackIds.has(trackId)) {
        useTimelineStore.getState().setTrackVisible(trackId, visible);
      }
    }
  }

  const indexedTrackVisibilityIds = new Set<string>();
  if (cleaned.trackTypeLayouts) {
    for (const type of TIMELINE_TRACK_TYPES) {
      const slots = cleaned.trackTypeLayouts[type] ?? [];
      if (slots.length === 0) {
        continue;
      }

      const currentTracks = useTimelineStore.getState().tracks.filter((track) => track.type === type);
      slots.forEach((slot, index) => {
        const track = currentTracks[index];
        if (!track || exactTrackVisibilityIds.has(track.id) || typeof slot.visible !== 'boolean') {
          return;
        }
        useTimelineStore.getState().setTrackVisible(track.id, slot.visible);
        indexedTrackVisibilityIds.add(track.id);
      });
    }
  }

  if (cleaned.trackTypeVisibility) {
    const currentTracks = useTimelineStore.getState().tracks;
    for (const track of currentTracks) {
      if (exactTrackVisibilityIds.has(track.id) || indexedTrackVisibilityIds.has(track.id)) {
        continue;
      }
      const typeVisible = cleaned.trackTypeVisibility[track.type];
      if (typeof typeVisible === 'boolean') {
        useTimelineStore.getState().setTrackVisible(track.id, typeVisible);
      }
    }
  }
}

export function activate3DEditSceneCamera(): string | null {
  const timeline = useTimelineStore.getState();
  const cameras = timeline.clips
    .filter((clip) => clip.source?.type === 'camera')
    .toSorted((left, right) => left.startTime - right.startTime);
  const current = cameras.find((camera) => (
    timeline.playheadPosition >= camera.startTime &&
    timeline.playheadPosition < camera.startTime + camera.duration
  ));
  const existing = current ?? cameras[0];
  if (existing) {
    if (!current) timeline.setPlayheadPosition(existing.startTime);
    return existing.id;
  }

  const trackId = timeline.tracks.find((track) => track.type === 'video')?.id ?? timeline.addTrack('video');
  const cameraId = useTimelineStore.getState().addCameraClip(trackId, 0, Math.max(0.001, timeline.duration));
  if (cameraId) useTimelineStore.getState().setPlayheadPosition(0);
  return cameraId;
}
