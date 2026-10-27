// The clip a clip-scope design sheet (crop & transform, mask) edits: the primary selected clip, or
// the first selected one. Reads the same stores the desktop inspector reads and says why a clip
// cannot be edited instead of failing silently.

import { getCanvasSourceSize } from '../../../services/text/textCanvasFrameRegistry';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';

export interface PhoneSize {
  width: number;
  height: number;
}

export type PhoneClipTarget =
  | {
    ok: true;
    clip: TimelineClip;
    /** Active composition size (the mask raster and position units use it). */
    comp: PhoneSize;
    /** Source size in pixels (media file, nested composition or text canvas); the composition size if unknown. */
    source: PhoneSize;
    sourceKnown: boolean;
    /** Other selected clips the sheet leaves alone. */
    otherSelected: number;
  }
  | { ok: false; reason: string };

function positive(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function getPhoneActiveCompSize(): PhoneSize {
  const media = useMediaStore.getState();
  const comp = media.compositions.find((candidate) => candidate.id === media.activeCompositionId);
  return { width: positive(comp?.width) ?? 1920, height: positive(comp?.height) ?? 1080 };
}

export function getPhoneClipSourceSize(clip: TimelineClip): PhoneSize | null {
  const media = useMediaStore.getState();
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  const file = mediaFileId ? media.files.find((candidate) => candidate.id === mediaFileId) : undefined;
  const nested = clip.compositionId ? media.compositions.find((candidate) => candidate.id === clip.compositionId) : undefined;
  const text = clip.source?.textCanvas ? getCanvasSourceSize(clip.source.textCanvas) : undefined;
  const width = positive(file?.width) ?? positive(clip.source?.videoElement?.videoWidth)
    ?? positive(clip.source?.imageElement?.naturalWidth) ?? positive(text?.width) ?? positive(nested?.width);
  const height = positive(file?.height) ?? positive(clip.source?.videoElement?.videoHeight)
    ?? positive(clip.source?.imageElement?.naturalHeight) ?? positive(text?.height) ?? positive(nested?.height);
  return width && height ? { width, height } : null;
}

/** The selected visual clip the sheet edits, or why there is none. */
export function resolvePhoneClipTarget(): PhoneClipTarget {
  const state = useTimelineStore.getState();
  const selected = [...state.selectedClipIds];
  const id = state.primarySelectedClipId && state.selectedClipIds.has(state.primarySelectedClipId)
    ? state.primarySelectedClipId
    : selected[0];
  const clip = id ? state.clips.find((candidate) => candidate.id === id) : undefined;
  if (!clip) return { ok: false, reason: 'Select a clip first.' };
  const track = state.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.type !== 'video') return { ok: false, reason: 'This works on video, photo and title clips. Select one on a video track.' };
  if (track.locked) return { ok: false, reason: 'The clip sits on a locked track. Unlock the track in the full editor first.' };
  const source = getPhoneClipSourceSize(clip);
  const comp = getPhoneActiveCompSize();
  return {
    ok: true, clip, comp, source: source ?? comp, sourceKnown: source !== null,
    otherSelected: Math.max(0, selected.length - 1),
  };
}
