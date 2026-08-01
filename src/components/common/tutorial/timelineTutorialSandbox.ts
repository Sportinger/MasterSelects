import type { TimelineClip } from '../../../types';
import type { GuidedTargetRef } from '../../../services/guidedActions';
import { requestMediaSourceReveal } from '../../../services/mediaSourceReveal';
import { startBatch, useHistoryStore } from '../../../stores/historyStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';

export const TUTORIAL_MEDIA_TARGET_ID = '$tutorial-media';
export const TUTORIAL_CLIP_TARGET_ID = '$tutorial-clip';
export const TUTORIAL_VIDEO_TRACK_TARGET_ID = '$tutorial-video-track';

const TUTORIAL_COLOR = '#398ce6';
const TUTORIAL_CLIP_START = 1;
const TUTORIAL_CLIP_DURATION = 5;

interface TimelineTransientSnapshot {
  clips: TimelineClip[];
  duration: number;
  isDraggingPlayhead: boolean;
  playheadPosition: number;
  primarySelectedClipId: string | null;
  propertiesSelection: ReturnType<typeof useTimelineStore.getState>['propertiesSelection'];
  selectedClipIds: Set<string>;
}

export interface TimelineTutorialSandbox {
  captureTransientRestore: () => () => void;
  cleanup: () => void;
  ensureClip: () => string | null;
  getClipBounds: () => Pick<TimelineClip, 'duration' | 'startTime' | 'trackId'> | null;
  getClipId: () => string | null;
  getMediaId: () => string;
  getTrackId: () => string;
  isDisposed: () => boolean;
  moveClipTo: (startTime: number) => void;
  pause: () => void;
  play: () => Promise<void>;
  prepareStep: (stepId: string) => void;
  resolveTarget: (target: GuidedTargetRef) => GuidedTargetRef;
  selectClip: () => void;
  setPlayhead: (time: number) => void;
  trimClipToDuration: (duration: number) => void;
}

export function createTimelineTutorialSandbox(): TimelineTutorialSandbox {
  // Keep every tutorial-only mutation out of the user's undo tree. Cleanup
  // restores the small amount of view state history does not capture, then
  // cancels this batch to restore the complete editable project snapshot.
  const historyBatch = startBatch('Timeline tutorial sandbox');
  const ownedHistoryBatchId = historyBatch.opened ? historyBatch.batchId : null;
  const initialMediaState = useMediaStore.getState();
  const initialTimelineState = useTimelineStore.getState();
  const mediaSnapshot = {
    expandedFolderIds: [...initialMediaState.expandedFolderIds],
    selectedIds: [...initialMediaState.selectedIds],
    solidItems: [...initialMediaState.solidItems],
  };
  const timelineSnapshot = {
    clips: initialTimelineState.clips,
    duration: initialTimelineState.duration,
    expandedTracks: new Set(initialTimelineState.expandedTracks),
    isDraggingPlayhead: initialTimelineState.isDraggingPlayhead,
    playheadPosition: initialTimelineState.playheadPosition,
    primarySelectedClipId: initialTimelineState.primarySelectedClipId,
    propertiesSelection: initialTimelineState.propertiesSelection,
    scrollX: initialTimelineState.scrollX,
    selectedClipIds: new Set(initialTimelineState.selectedClipIds),
    targetTrackIdByType: { ...initialTimelineState.targetTrackIdByType },
    tracks: initialTimelineState.tracks,
    zoom: initialTimelineState.zoom,
  };

  initialTimelineState.pause();
  // Prefer a visible, unlocked video layer that is free in the tutorial range
  // (normally Video 1). If the edit has no safe visible layer, add a temporary
  // one; video tracks are inserted at the top and therefore remain visible.
  const availableTrack = initialTimelineState.tracks.find((track) => (
    track.type === 'video'
    && !track.locked
    && track.visible !== false
    && isTimelineTrackVisible(track.id)
    && !initialTimelineState.clips.some((clip) => (
      clip.trackId === track.id
      && clip.startTime < TUTORIAL_CLIP_START + TUTORIAL_CLIP_DURATION
      && clip.startTime + clip.duration > TUTORIAL_CLIP_START
    ))
  ));
  const trackId = availableTrack?.id ?? useTimelineStore.getState().addTrack('video');

  const mediaId = useMediaStore.getState().createSolidItem(
    'Tutorial Clip',
    TUTORIAL_COLOR,
    null,
  );
  let clipId: string | null = null;
  let disposed = false;

  useTimelineStore.setState({
    isDraggingPlayhead: false,
    playheadPosition: 0,
    scrollX: 0,
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    zoom: 72,
  });

  const removeCurrentTutorialClip = () => {
    if (!clipId) return;
    if (useTimelineStore.getState().clips.some((clip) => clip.id === clipId)) {
      useTimelineStore.getState().removeClip(clipId);
    }
    clipId = null;
  };

  const ensureClip = (): string | null => {
    if (disposed) return null;
    if (clipId && useTimelineStore.getState().clips.some((clip) => clip.id === clipId)) {
      return clipId;
    }
    const nextClipId = useTimelineStore.getState().addSolidClip(
      trackId,
      TUTORIAL_CLIP_START,
      TUTORIAL_COLOR,
      TUTORIAL_CLIP_DURATION,
      true,
    );
    if (!nextClipId) return null;
    clipId = nextClipId;
    useTimelineStore.getState().updateClip(nextClipId, {
      mediaFileId: mediaId,
      name: 'Tutorial Clip',
      source: {
        ...useTimelineStore.getState().clips.find((clip) => clip.id === nextClipId)?.source,
        mediaFileId: mediaId,
        naturalDuration: TUTORIAL_CLIP_DURATION,
        type: 'solid',
      },
    });
    return nextClipId;
  };

  const restoreTransientSnapshot = (snapshot: TimelineTransientSnapshot) => {
    if (disposed) return;
    useTimelineStore.getState().pause();
    const snapshotTutorialClipId = snapshot.clips.find((clip) => (
      clip.mediaFileId === mediaId
    ))?.id ?? null;
    if (clipId && !snapshotTutorialClipId) {
      removeCurrentTutorialClip();
    }
    clipId = snapshotTutorialClipId;
    useTimelineStore.setState({
      clips: snapshot.clips,
      duration: snapshot.duration,
      isDraggingPlayhead: snapshot.isDraggingPlayhead,
      playheadPosition: snapshot.playheadPosition,
      primarySelectedClipId: snapshot.primarySelectedClipId,
      propertiesSelection: snapshot.propertiesSelection,
      selectedClipIds: new Set(snapshot.selectedClipIds),
    });
    useTimelineStore.getState().setPlayheadPosition(snapshot.playheadPosition);
  };

  return {
    captureTransientRestore: () => {
      const state = useTimelineStore.getState();
      const snapshot: TimelineTransientSnapshot = {
        clips: state.clips,
        duration: state.duration,
        isDraggingPlayhead: state.isDraggingPlayhead,
        playheadPosition: state.playheadPosition,
        primarySelectedClipId: state.primarySelectedClipId,
        propertiesSelection: state.propertiesSelection,
        selectedClipIds: new Set(state.selectedClipIds),
      };
      let restored = false;
      return () => {
        if (restored) return;
        restored = true;
        restoreTransientSnapshot(snapshot);
      };
    },
    cleanup: () => {
      if (disposed) return;
      useTimelineStore.getState().pause();
      disposed = true;

      // Cancel history first: cancelling restores the state captured when the
      // sandbox batch opened. Applying the authoritative snapshots afterwards
      // guarantees that history cannot re-introduce the temporary media/clip.
      if (
        ownedHistoryBatchId !== null
        && useHistoryStore.getState().batchId === ownedHistoryBatchId
      ) {
        useHistoryStore.getState().cancelBatch();
      }
      clipId = null;
      useTimelineStore.setState({
        clips: timelineSnapshot.clips.filter((clip) => clip.mediaFileId !== mediaId),
        duration: timelineSnapshot.duration,
        expandedTracks: new Set(timelineSnapshot.expandedTracks),
        isDraggingPlayhead: timelineSnapshot.isDraggingPlayhead,
        playheadPosition: timelineSnapshot.playheadPosition,
        primarySelectedClipId: timelineSnapshot.primarySelectedClipId,
        propertiesSelection: timelineSnapshot.propertiesSelection,
        scrollX: timelineSnapshot.scrollX,
        selectedClipIds: new Set(timelineSnapshot.selectedClipIds),
        targetTrackIdByType: { ...timelineSnapshot.targetTrackIdByType },
        tracks: timelineSnapshot.tracks,
        zoom: timelineSnapshot.zoom,
      });
      useTimelineStore.getState().setPlayheadPosition(timelineSnapshot.playheadPosition);
      useMediaStore.setState({
        expandedFolderIds: [...mediaSnapshot.expandedFolderIds],
        selectedIds: mediaSnapshot.selectedIds.filter((id) => id !== mediaId),
        solidItems: mediaSnapshot.solidItems.filter((item) => item.id !== mediaId),
      });
    },
    ensureClip,
    getClipBounds: () => {
      if (!clipId) return null;
      const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
      return clip
        ? { duration: clip.duration, startTime: clip.startTime, trackId: clip.trackId }
        : null;
    },
    getClipId: () => clipId,
    getMediaId: () => mediaId,
    getTrackId: () => trackId,
    isDisposed: () => disposed,
    moveClipTo: (startTime) => {
      if (!clipId) return;
      useTimelineStore.setState((state) => ({
        clips: state.clips.map((clip) => (
          clip.id === clipId ? { ...clip, startTime: Math.max(0, startTime) } : clip
        )),
      }));
    },
    pause: () => useTimelineStore.getState().pause(),
    play: () => useTimelineStore.getState().play(),
    prepareStep: (stepId) => {
      if (disposed) return;
      useTimelineStore.getState().pause();
      useTimelineStore.setState({ scrollX: 0, zoom: 72 });
      window.requestAnimationFrame(() => {
        if (!disposed) revealTutorialVideoTrack(trackId);
      });
      if (stepId === 'timeline-add-media') {
        removeCurrentTutorialClip();
        useTimelineStore.getState().selectClip(null);
        useTimelineStore.getState().setPlayheadPosition(0);
        window.setTimeout(() => {
          if (!disposed) requestMediaSourceReveal(mediaId);
        }, 0);
        return;
      }
      const nextClipId = ensureClip();
      useTimelineStore.getState().setPlayheadPosition(
        stepId === 'timeline-scrub' ? 0 : TUTORIAL_CLIP_START,
      );
      if (stepId === 'timeline-move-clip' || stepId === 'timeline-trim-clip') {
        if (nextClipId) useTimelineStore.getState().selectClip(nextClipId);
      } else {
        useTimelineStore.getState().selectClip(null);
      }
    },
    resolveTarget: (target) => {
      if (target.kind === 'mediaItem' && target.itemId === TUTORIAL_MEDIA_TARGET_ID) {
        return { ...target, itemId: mediaId };
      }
      if (target.kind === 'timelineClip' && target.clipId === TUTORIAL_CLIP_TARGET_ID) {
        return { ...target, clipId: clipId ?? TUTORIAL_CLIP_TARGET_ID };
      }
      if (target.kind === 'timelineTrimHandle' && target.clipId === TUTORIAL_CLIP_TARGET_ID) {
        return { ...target, clipId: clipId ?? TUTORIAL_CLIP_TARGET_ID };
      }
      if (target.kind === 'timelineTime' && target.trackId === TUTORIAL_VIDEO_TRACK_TARGET_ID) {
        return { ...target, trackId };
      }
      return target;
    },
    selectClip: () => {
      if (clipId) useTimelineStore.getState().selectClip(clipId);
    },
    setPlayhead: (time) => useTimelineStore.getState().setPlayheadPosition(time),
    trimClipToDuration: (duration) => {
      if (!clipId) return;
      const nextDuration = Math.max(0.25, duration);
      useTimelineStore.setState((state) => ({
        clips: state.clips.map((clip) => (
          clip.id === clipId
            ? { ...clip, duration: nextDuration, outPoint: clip.inPoint + nextDuration }
            : clip
        )),
      }));
    },
  };
}

function isTimelineTrackVisible(trackId: string): boolean {
  if (typeof document === 'undefined') return true;
  const trackElement = Array.from(document.querySelectorAll<HTMLElement>('[data-track-id]'))
    .find((element) => element.dataset.trackId === trackId && element.matches('.track-lane'));
  if (!trackElement) return false;
  const viewport = trackElement.closest<HTMLElement>('.timeline-section-viewport');
  if (!viewport) return false;
  const trackRect = trackElement.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  return trackRect.height > 0
    && viewportRect.height > 0
    && trackRect.bottom > viewportRect.top
    && trackRect.top < viewportRect.bottom;
}

function revealTutorialVideoTrack(trackId: string, remainingAttempts = 8): void {
  if (typeof document === 'undefined' || typeof WheelEvent === 'undefined') return;
  if (isTimelineTrackVisible(trackId)) return;
  const trackElement = Array.from(document.querySelectorAll<HTMLElement>('.track-lane.video[data-track-id]'))
    .find((element) => element.dataset.trackId === trackId);
  const viewport = trackElement?.closest<HTMLElement>('.timeline-section-viewport')
    ?? document.querySelector<HTMLElement>('.timeline-track-section.video .timeline-section-viewport');
  if (!viewport) return;

  // Video tracks are ordered top-first. A large upward wheel gesture uses the
  // Timeline's real section-scroll handler and reveals the temporary top layer.
  viewport.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaMode: WheelEvent.DOM_DELTA_PIXEL,
    deltaY: -100_000,
  }));

  // A newly-created tutorial layer may not be mounted during the first frame.
  // Retry until React has rendered it and the section's real wheel controller
  // has moved that layer into the visible video viewport.
  if (remainingAttempts > 0) {
    window.requestAnimationFrame(() => revealTutorialVideoTrack(trackId, remainingAttempts - 1));
  }
}
