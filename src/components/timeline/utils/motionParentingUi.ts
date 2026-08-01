import type { TimelineClip, TimelineTrack } from '../../../types';

export type MotionParentDropStatus = 'idle' | 'valid' | 'blocked';

export interface MotionParentDropEvaluation {
  status: MotionParentDropStatus;
  diagnostic: string;
}

type MotionParentClipRef = Pick<TimelineClip, 'id' | 'trackId' | 'parentClipId' | 'is3D'>;
type MotionParentTrackRef = Pick<TimelineTrack, 'id' | 'type' | 'locked'>;

const IDLE_DROP: MotionParentDropEvaluation = {
  status: 'idle',
  diagnostic: 'Drop onto an unlocked 2D video clip.',
};

const blocked = (diagnostic: string): MotionParentDropEvaluation => ({
  status: 'blocked',
  diagnostic,
});

export function evaluateMotionParentDrop({
  sourceClipId,
  targetClipId,
  clips,
  tracks,
}: {
  sourceClipId: string;
  targetClipId: string | null;
  clips: readonly MotionParentClipRef[];
  tracks: readonly MotionParentTrackRef[];
}): MotionParentDropEvaluation {
  if (!targetClipId) return IDLE_DROP;

  const clipsById = new Map(clips.map((clip) => [clip.id, clip] as const));
  const tracksById = new Map(tracks.map((track) => [track.id, track] as const));
  const source = clipsById.get(sourceClipId);
  const target = clipsById.get(targetClipId);

  if (!source) return blocked('The source clip no longer exists.');
  if (!target) return blocked('Drop onto a timeline clip.');
  if (source.id === target.id) return blocked('A clip cannot parent itself.');

  const sourceTrack = tracksById.get(source.trackId);
  const targetTrack = tracksById.get(target.trackId);
  if (sourceTrack?.type !== 'video' || targetTrack?.type !== 'video') {
    return blocked('Parenting is available only between video-layer clips.');
  }
  if (sourceTrack.locked === true) return blocked('Unlock the child track before parenting.');
  if (targetTrack.locked === true) return blocked('Unlock the target track before parenting.');
  if (source.is3D === true || target.is3D === true) {
    return blocked('Structure 1.0 supports only 2D-to-2D parenting.');
  }
  if (source.parentClipId === target.id) return blocked('This clip is already the parent.');

  const visited = new Set<string>();
  let ancestor: MotionParentClipRef | undefined = target;
  while (ancestor) {
    if (ancestor.id === source.id) return blocked('This parent would create a cycle.');
    if (visited.has(ancestor.id)) return blocked('The target parent chain is already cyclic.');
    visited.add(ancestor.id);
    ancestor = ancestor.parentClipId ? clipsById.get(ancestor.parentClipId) : undefined;
  }

  return {
    status: 'valid',
    diagnostic: 'Release to set this clip as the parent.',
  };
}
