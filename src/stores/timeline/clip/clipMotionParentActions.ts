import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { Logger } from '../../../services/logger';
import {
  applyTimelineMotionStructurePlan,
  planTimelineMotionParentMutation,
} from '../../../services/motionDesign/contracts/timelineStructureAdapter';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { captureSnapshot } from '../../historyStore';
import { DEFAULT_TRANSFORM } from '../constants';
import type { ClipActionContext } from './clipActionContext';

const log = Logger.create('ClipMotionParentActions');
const REQUIRED_3D_SOURCE_TYPES = new Set([
  'camera',
  'flock',
  'gaussian-splat',
  'light',
  'model',
  'splat-effector',
]);

function isClipOnLockedTrack(
  clips: readonly TimelineClip[],
  tracks: readonly TimelineTrack[],
  clipId: string,
): boolean {
  const clip = clips.find(candidate => candidate.id === clipId);
  return !!clip && tracks.find(track => track.id === clip.trackId)?.locked === true;
}

function collectMotionParentComponentIds(
  clips: readonly TimelineClip[],
  startClipId: string,
): Set<string> {
  const clipById = new Map(clips.map(clip => [clip.id, clip]));
  const childIdsByParent = new Map<string, string[]>();
  for (const clip of clips) {
    if (!clip.parentClipId || !clipById.has(clip.parentClipId)) continue;
    const childIds = childIdsByParent.get(clip.parentClipId) ?? [];
    childIds.push(clip.id);
    childIdsByParent.set(clip.parentClipId, childIds);
  }

  const connectedIds = new Set<string>();
  const pendingIds = [startClipId];
  while (pendingIds.length > 0) {
    const currentId = pendingIds.pop();
    if (!currentId || connectedIds.has(currentId)) continue;
    const current = clipById.get(currentId);
    if (!current) continue;
    connectedIds.add(currentId);
    if (current.parentClipId) pendingIds.push(current.parentClipId);
    pendingIds.push(...(childIdsByParent.get(currentId) ?? []));
  }
  return connectedIds;
}

function setClipDimension(clip: TimelineClip, is3D: boolean): TimelineClip {
  if (is3D) {
    if (clip.source?.type === 'video' || clip.source?.type === 'image') {
      const transform = clip.transform || DEFAULT_TRANSFORM;
      return {
        ...clip,
        is3D: true,
        transform: {
          ...transform,
          position: {
            ...(transform.position || DEFAULT_TRANSFORM.position),
            z: transform.position?.z ?? DEFAULT_TRANSFORM.position.z,
          },
          rotation: { ...(transform.rotation || DEFAULT_TRANSFORM.rotation) },
          scale: { ...(transform.scale || DEFAULT_TRANSFORM.scale) },
        },
      };
    }
    return { ...clip, is3D: true };
  }

  const transform = clip.transform || DEFAULT_TRANSFORM;
  return {
    ...clip,
    is3D: false,
    transform: {
      ...transform,
      position: { ...(transform.position || { x: 0, y: 0, z: 0 }), z: 0 },
      rotation: { ...(transform.rotation || { x: 0, y: 0, z: 0 }), x: 0, y: 0 },
      scale: { x: transform.scale?.x ?? 1, y: transform.scale?.y ?? 1 },
    },
  };
}

export function setClipParentAction(
  { set, get }: ClipActionContext,
  clipId: string,
  parentClipId: string | null,
): void {
  const {
    clips,
    tracks,
    clipKeyframes,
    playheadPosition,
    invalidateCache,
  } = get();
  if (isClipOnLockedTrack(clips, tracks, clipId)) {
    log.warn('Cannot parent clip on locked track', { clipId });
    return;
  }
  const compositionId = clips.find(candidate => candidate.id === clipId)?.compositionId
    ?? 'timeline:active';
  const result = planTimelineMotionParentMutation({
    compositionId,
    clips,
    clipKeyframes,
    timelineTime: getPlayheadPosition(playheadPosition),
    childClipId: clipId,
    ...(parentClipId ? { parentClipId } : {}),
  });
  if (!result.ok) {
    log.warn('Cannot apply Motion parent relationship', {
      clipId,
      parentClipId: parentClipId ?? 'none',
      failures: result.failures.map(failure => failure.code),
    });
    return;
  }
  const applied = applyTimelineMotionStructurePlan({
    compositionId,
    clips,
    clipKeyframes,
    plan: result.plan,
  });
  if (!applied.ok) {
    log.warn('Motion parent plan failed during atomic application', {
      clipId,
      message: applied.message,
    });
    return;
  }

  captureSnapshot(result.plan.history.label);
  set({ clips: applied.clips, clipKeyframes: applied.clipKeyframes });
  invalidateCache();
  log.debug('Set clip parent', { clipId, parentClipId: parentClipId || 'none' });
}

export function toggleClip3DAction(
  { set, get }: ClipActionContext,
  clipId: string,
): void {
  const { clips, tracks, invalidateCache } = get();
  const clip = clips.find(candidate => candidate.id === clipId);
  if (!clip) {
    log.warn('toggle3D: clip not found', { clipId });
    return;
  }
  if (clip.source?.type === 'gaussian-splat') return;

  const connectedIds = collectMotionParentComponentIds(clips, clipId);
  if ([...connectedIds].some(id => isClipOnLockedTrack(clips, tracks, id))) {
    log.warn('Cannot toggle 3D for a Pick Whip group on a locked track', {
      clipId,
      connectedClipIds: [...connectedIds],
    });
    return;
  }

  const nowIs3D = !clip.is3D;
  const containsRequired3DSource = clips.some(candidate => (
    connectedIds.has(candidate.id) && REQUIRED_3D_SOURCE_TYPES.has(candidate.source?.type ?? '')
  ));
  if (!nowIs3D && containsRequired3DSource) {
    log.warn('Cannot switch a Pick Whip group containing a required 3D source to 2D', {
      clipId,
      connectedClipIds: [...connectedIds],
    });
    return;
  }

  set({
    clips: clips.map(candidate => connectedIds.has(candidate.id)
      ? setClipDimension(candidate, nowIs3D)
      : candidate),
  });
  invalidateCache();
  log.debug('Toggled Pick Whip group dimension', {
    clipId,
    connectedClipIds: [...connectedIds],
    dimension: nowIs3D ? '3d' : '2d',
  });
}
