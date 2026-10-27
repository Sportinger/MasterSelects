import type { MediaFile } from '../../../stores/mediaStore';

/** Sources supported by the timeline's media and live-input clip adapters. */
export function canCreateCompositionFromMedia(media: MediaFile | null): boolean {
  if (!media) return false;
  if (media.liveInput) return media.liveInput.kind !== 'composition-feedback';
  return Boolean(media.file) && media.type !== 'gaussian-avatar';
}
