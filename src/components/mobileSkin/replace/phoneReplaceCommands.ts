// Replace the selected clip's source through the editor's own replaceClipSource /
// replaceClipSourceWithComposition: the clip keeps its place, length, effects, masks and keyframes
// (and its linked audio follows). Returns a phone result that says why a replacement was refused.

import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import type { PhoneActionResult } from '../contracts';

/** Why the editor cannot replace this clip's source, or null when it can. */
export function phoneReplaceUnsupportedReason(clip: Pick<TimelineClip, 'source' | 'isComposition'>, trackLocked: boolean): string | null {
  if (trackLocked) return 'The track is locked. Unlock it in Tracks first.';
  if (clip.isComposition) return 'This clip shows a composition. Replace works on video clips; open the composition to change its content.';
  if (clip.source?.type !== 'video') return 'The editor replaces the source of video clips only. For a photo, text or sound clip, delete it and add the new one.';
  return null;
}

/** A short note when the new video is shorter than the part of the source the clip uses. */
export function phoneReplaceShortNote(clip: Pick<TimelineClip, 'outPoint'>, media: Pick<MediaFile, 'duration' | 'name'>): string | null {
  if (typeof media.duration !== 'number' || !Number.isFinite(media.duration)) return null;
  if (media.duration + 1e-3 >= clip.outPoint) return null;
  return `${media.name} is ${media.duration.toFixed(1)} s long, shorter than the ${clip.outPoint.toFixed(1)} s this clip uses: the end shows its last frame or stays empty.`;
}

export function phoneReplaceWithMedia(clipId: string, mediaFileId: string): PhoneActionResult {
  const media = useMediaStore.getState().files.find((file) => file.id === mediaFileId);
  if (!media) return { ok: false, message: 'That video is no longer in the project.' };
  if (media.type !== 'video') return { ok: false, message: `${media.name} is not a video; only a video can replace a video clip.` };
  if (media.isImporting) return { ok: false, message: `${media.name} is still importing. Try again in a moment.` };
  const replaced = useTimelineStore.getState().replaceClipSource(clipId, mediaFileId);
  if (!replaced) return { ok: false, message: 'The clip could not take this video (is the track locked?).' };
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
  const note = clip ? phoneReplaceShortNote(clip, media) : null;
  return note ? { ok: true, message: note } : { ok: true };
}

export async function phoneReplaceWithComposition(clipId: string, compositionId: string): Promise<PhoneActionResult> {
  const replaced = await useTimelineStore.getState().replaceClipSourceWithComposition(clipId, compositionId);
  return replaced ? { ok: true } : { ok: false, message: 'This composition cannot stand in here (it would contain itself, or the track is locked).' };
}
