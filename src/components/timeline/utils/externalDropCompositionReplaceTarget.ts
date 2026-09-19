import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { ExternalDragPayload } from './externalDragSession';

interface ResolveExternalDropCompositionReplaceTargetParams {
  clips: TimelineClip[];
  payload: ExternalDragPayload | null;
  targetTrack: TimelineTrack | undefined;
  time: number;
}

export function resolveExternalDropCompositionReplaceTarget({
  clips,
  payload,
  targetTrack,
  time,
}: ResolveExternalDropCompositionReplaceTargetParams): TimelineClip | undefined {
  if (
    !targetTrack
    || targetTrack.locked
    || targetTrack.type !== 'video'
    || payload?.kind !== 'composition'
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
