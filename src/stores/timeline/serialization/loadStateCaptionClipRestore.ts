import type { TimelineClip } from '../types';

export async function migrateRestoredCaptionClips(
  clips: readonly TimelineClip[],
  ensureCaptionTextClip: (clipId: string) => Promise<boolean>,
): Promise<void> {
  const legacyCaptionClipIds = clips
    .filter(clip => clip.captionProperties && (clip.isComposition || clip.source?.type !== 'text'))
    .map(clip => clip.id);
  for (const clipId of legacyCaptionClipIds) {
    await ensureCaptionTextClip(clipId);
  }
}
