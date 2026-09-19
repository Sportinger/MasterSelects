import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { ExternalDragPayload } from './externalDragSession';

interface ResolveExternalDropReplaceTargetParams {
  clips: TimelineClip[];
  payload: ExternalDragPayload | null;
  targetTrack: TimelineTrack | undefined;
  time: number;
}

export function resolveExternalDropReplaceTarget({
  clips,
  payload,
  targetTrack,
  time,
}: ResolveExternalDropReplaceTargetParams): TimelineClip | undefined {
  if (
    !targetTrack
    || targetTrack.locked
    || targetTrack.type !== 'video'
    || payload?.kind !== 'media-file'
    || payload.mediaType !== 'video'
    || payload.isAudio
  ) {
    return undefined;
  }

  return clips.find((clip) => (
    clip.trackId === targetTrack.id
    && clip.source?.type === 'video'
    && time >= clip.startTime
    && time < clip.startTime + clip.duration
  ));
}
