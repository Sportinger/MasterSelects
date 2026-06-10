import type { TimelineTrack } from '../../../types';
import { Logger } from '../../../services/logger';
import type { classifyMediaType } from '../helpers/mediaTypeHelpers';
import type { ClipActionContext } from './clipActionContext';
import { hasVisualMediaType } from './addClipMediaSource';
import {
  createTimelineTrackForType,
  insertTimelineTrack,
} from '../trackSlice';

const log = Logger.create('ClipAddAction');

export type AddClipTargetTrackType = 'video' | 'audio';

export function getRequiredTrackTypeForMedia(
  mediaType: Awaited<ReturnType<typeof classifyMediaType>> | 'gaussian-avatar' | 'gaussian-splat',
): AddClipTargetTrackType | null {
  if (mediaType === 'audio') return 'audio';
  if (mediaType === 'gaussian-avatar') return null;
  if (hasVisualMediaType(mediaType)) return 'video';
  return null;
}

function isUnlockedCompatibleTrack(
  track: TimelineTrack,
  requiredTrackType: AddClipTargetTrackType,
): boolean {
  return track.type === requiredTrackType && track.locked !== true;
}

function findUnlockedCompatibleTrackId(
  tracks: readonly TimelineTrack[],
  requestedTrackId: string,
  requiredTrackType: AddClipTargetTrackType,
): string | null {
  const requestedIndex = tracks.findIndex(track => track.id === requestedTrackId);
  const searchOrder = requestedIndex >= 0
    ? [...tracks.slice(requestedIndex + 1), ...tracks.slice(0, requestedIndex)]
    : tracks;

  return searchOrder.find(track => isUnlockedCompatibleTrack(track, requiredTrackType))?.id ?? null;
}

function createUnlockedPlacementTrack(
  context: ClipActionContext,
  requiredTrackType: AddClipTargetTrackType,
): string {
  let createdTrackId = '';
  const { set } = context;
  set(state => {
    const newTrack = createTimelineTrackForType(requiredTrackType, state.tracks);
    createdTrackId = newTrack.id;
    return insertTimelineTrack(state.tracks, state.expandedTracks, newTrack);
  });
  return createdTrackId;
}

export function resolveUnlockedPlacementTrackId(
  context: ClipActionContext,
  requestedTrackId: string,
  requiredTrackType: AddClipTargetTrackType,
): string | null {
  const { tracks } = context.get();
  const requestedTrack = tracks.find(track => track.id === requestedTrackId);
  if (!requestedTrack) {
    log.warn('Track not found', { trackId: requestedTrackId });
    return null;
  }

  if (isUnlockedCompatibleTrack(requestedTrack, requiredTrackType)) {
    return requestedTrack.id;
  }

  if (requestedTrack.type !== requiredTrackType) {
    return requestedTrack.id;
  }

  const fallbackTrackId = findUnlockedCompatibleTrackId(tracks, requestedTrackId, requiredTrackType);
  if (fallbackTrackId) {
    log.warn('Remapping clip placement away from locked track', {
      requestedTrackId,
      fallbackTrackId,
    });
    return fallbackTrackId;
  }

  const createdTrackId = createUnlockedPlacementTrack(context, requiredTrackType);
  log.warn('Created unlocked track for clip placement away from locked track', {
    requestedTrackId,
    createdTrackId,
    trackType: requiredTrackType,
  });
  return createdTrackId;
}
