import type { TimelineClip } from '../../types/timeline';

/** Avoids probing runtime media registries for clips that cannot own video. */
export function canClipOwnVideoSyncMedia(clip: TimelineClip): boolean {
  const source = clip.source;
  return !!source && (
    source.type === 'video' ||
    !!source.liveInputId ||
    !!source.videoElement ||
    !!source.webCodecsPlayer ||
    !!source.nativeDecoder ||
    (!!source.runtimeSourceId && !!source.runtimeSessionKey)
  );
}
