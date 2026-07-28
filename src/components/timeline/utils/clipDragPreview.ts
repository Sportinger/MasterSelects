import type { TimelineClip, TimelineTrack } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClipDragPreview } from '../../../stores/timeline/types';
import { resolveSelectedClipTrackTargets } from '../../../stores/timeline/editOperations/selectedClipTrackTargets';
import type { ClipDragState } from '../types';

const CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS = 66;

let lastClipDragPreviewPublishAt = 0;
let pendingClipDragPreviewInput: {
  drag: ClipDragState;
  clipMap: Map<string, TimelineClip>;
  tracks: readonly TimelineTrack[];
} | null = null;
let pendingClipDragPreviewTimer: number | null = null;

export function buildClipDragPreview(
  drag: ClipDragState,
  clipMap: Map<string, TimelineClip>,
  tracks: readonly TimelineTrack[],
): TimelineClipDragPreview | null {
  if (drag.toolGesture) return null;

  const movingClip = clipMap.get(drag.clipId);
  const previewStartTime = drag.snappedTime;
  if (!movingClip || previewStartTime === null) return null;

  const patches: TimelineClipDragPreview['patches'] = {};
  const movedClipIds = new Set<string>();
  const timeDelta = previewStartTime - movingClip.startTime;
  const shouldMoveLinkedOrGrouped = !drag.altKeyPressed;
  const selectedDragIds = drag.multiSelectClipIds ?? [];
  const trackTargets = resolveSelectedClipTrackTargets(
    tracks,
    [...clipMap.values()],
    movingClip.id,
    drag.currentTrackId,
    [movingClip.id, ...selectedDragIds],
  ).targetTrackIdByClipId;

  const addPatch = (clip: TimelineClip, startTime: number, trackId = clip.trackId) => {
    patches[clip.id] = { startTime, trackId };
    movedClipIds.add(clip.id);
  };

  addPatch(movingClip, previewStartTime, trackTargets.get(movingClip.id) ?? drag.currentTrackId);

  if (selectedDragIds.length > 0 && drag.multiSelectTimeDelta !== undefined) {
    for (const selectedId of selectedDragIds) {
      const selectedClip = clipMap.get(selectedId);
      if (!selectedClip || movedClipIds.has(selectedClip.id)) continue;
      addPatch(
        selectedClip,
        selectedClip.startTime + drag.multiSelectTimeDelta,
        trackTargets.get(selectedClip.id) ?? selectedClip.trackId,
      );
    }
  }

  if (shouldMoveLinkedOrGrouped) {
    for (const movedId of [...movedClipIds]) {
      const clip = clipMap.get(movedId);
      const linkedClip = clip?.linkedClipId ? clipMap.get(clip.linkedClipId) : undefined;
      if (linkedClip && !movedClipIds.has(linkedClip.id)) {
        addPatch(linkedClip, linkedClip.startTime + timeDelta);
      }
    }

    if (movingClip.linkedGroupId) {
      for (const clip of clipMap.values()) {
        if (clip.linkedGroupId !== movingClip.linkedGroupId || movedClipIds.has(clip.id)) continue;
        addPatch(clip, clip.startTime + timeDelta);
      }
    }
  }

  return Object.keys(patches).length > 0 ? { patches } : null;
}

function publishClipDragPreview(preview: TimelineClipDragPreview | null): void {
  lastClipDragPreviewPublishAt = performance.now();
  useTimelineStore.setState({ clipDragPreview: preview });
}

function clearPendingClipDragPreviewTimer(): void {
  if (pendingClipDragPreviewTimer !== null) {
    window.clearTimeout(pendingClipDragPreviewTimer);
    pendingClipDragPreviewTimer = null;
  }
  pendingClipDragPreviewInput = null;
}

export function setClipDragPreviewFromDrag(
  drag: ClipDragState | null,
  clipMap: Map<string, TimelineClip>,
  tracks: readonly TimelineTrack[],
): void {
  if (drag === null) {
    clearPendingClipDragPreviewTimer();
    publishClipDragPreview(null);
    return;
  }

  const now = performance.now();
  const elapsed = now - lastClipDragPreviewPublishAt;
  if (elapsed >= CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS) {
    clearPendingClipDragPreviewTimer();
    publishClipDragPreview(buildClipDragPreview(drag, clipMap, tracks));
    return;
  }

  pendingClipDragPreviewInput = { drag, clipMap, tracks };
  if (pendingClipDragPreviewTimer !== null) return;

  pendingClipDragPreviewTimer = window.setTimeout(() => {
    pendingClipDragPreviewTimer = null;
    const nextInput = pendingClipDragPreviewInput;
    pendingClipDragPreviewInput = null;
    if (nextInput) {
      publishClipDragPreview(buildClipDragPreview(nextInput.drag, nextInput.clipMap, nextInput.tracks));
    }
  }, Math.max(0, CLIP_DRAG_PREVIEW_PUBLISH_INTERVAL_MS - elapsed));
}
