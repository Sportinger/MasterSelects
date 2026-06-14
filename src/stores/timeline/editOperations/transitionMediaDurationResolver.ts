import type { MediaFile } from '../../mediaStore/types';
import type { TransitionSourceDurationResolver } from './transitionPlanner';

export function createTransitionMediaDurationResolver(
  mediaFiles: readonly MediaFile[],
): TransitionSourceDurationResolver {
  const durationById = new Map<string, number>();
  for (const mediaFile of mediaFiles) {
    if (Number.isFinite(mediaFile.duration) && mediaFile.duration && mediaFile.duration > 0) {
      durationById.set(mediaFile.id, mediaFile.duration);
    }
  }

  return (mediaFileId: string) => durationById.get(mediaFileId);
}
