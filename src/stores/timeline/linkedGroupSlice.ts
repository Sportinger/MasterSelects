// Linked group actions slice - extracted from clipSlice

import type { LinkedGroupActions, SliceCreator } from './types';
import type { TimelineClip, TimelineTrack } from '../../types';
import { captureSnapshot } from '../historyStore';
import {
  generateLinkedGroupId,
  generateManualLinkedGroupId,
  isManualLinkedGroupId,
} from './helpers/idGenerator';
import { Logger } from '../../services/logger';

const log = Logger.create('LinkedGroupSlice');

function isTrackLocked(tracks: TimelineTrack[], trackId: string): boolean {
  return tracks.find((track) => track.id === trackId)?.locked === true;
}

function uniqueExistingClipIds(clips: TimelineClip[], clipIds: string[]): string[] {
  const existing = new Set(clips.map((clip) => clip.id));
  return [...new Set(clipIds)].filter((clipId) => existing.has(clipId));
}

function collectLinkCleanupTargets(
  clips: TimelineClip[],
  clipIds: string[],
): {
  pairClipIds: Set<string>;
  manualGroupIds: Set<string>;
  affectedClipIds: Set<string>;
} {
  const selectedClipIds = new Set(clipIds);
  const pairClipIds = new Set<string>();
  const manualGroupIds = new Set<string>();
  const affectedClipIds = new Set<string>(clipIds);

  for (const clip of clips) {
    if (!selectedClipIds.has(clip.id)) continue;

    if (clip.linkedClipId) {
      pairClipIds.add(clip.id);
      pairClipIds.add(clip.linkedClipId);
      affectedClipIds.add(clip.linkedClipId);
    }
    const groupId = clip.linkedGroupId;
    if (groupId && isManualLinkedGroupId(groupId)) {
      manualGroupIds.add(groupId);
    }
  }

  for (const clip of clips) {
    if (clip.linkedClipId && selectedClipIds.has(clip.linkedClipId)) {
      pairClipIds.add(clip.id);
      pairClipIds.add(clip.linkedClipId);
      affectedClipIds.add(clip.id);
      affectedClipIds.add(clip.linkedClipId);
    }
    if (clip.linkedGroupId && manualGroupIds.has(clip.linkedGroupId)) {
      affectedClipIds.add(clip.id);
    }
  }

  return { pairClipIds, manualGroupIds, affectedClipIds };
}

function hasLockedAffectedClip(clips: TimelineClip[], tracks: TimelineTrack[], affectedClipIds: Set<string>): boolean {
  return clips.some((clip) => affectedClipIds.has(clip.id) && isTrackLocked(tracks, clip.trackId));
}

export const createLinkedGroupSlice: SliceCreator<LinkedGroupActions> = (set, get) => ({
  createLinkedGroup: (clipIds, offsets) => {
    const { clips, invalidateCache } = get();
    const groupId = generateLinkedGroupId();
    const selectedClips = clips.filter(c => clipIds.includes(c.id));
    if (selectedClips.length === 0) return;

    let masterStartTime = selectedClips[0].startTime;
    for (const clipId of clipIds) {
      if (offsets.get(clipId) === 0) {
        const masterClip = clips.find(c => c.id === clipId);
        if (masterClip) { masterStartTime = masterClip.startTime; break; }
      }
    }

    set({
      clips: clips.map(c => {
        if (!clipIds.includes(c.id)) return c;
        const offset = offsets.get(c.id) || 0;
        return { ...c, linkedGroupId: groupId, startTime: Math.max(0, masterStartTime - offset / 1000) };
      }),
    });
    invalidateCache();
    log.debug('Created linked group', { groupId, clipCount: clipIds.length });
  },

  unlinkGroup: (clipId) => {
    const { clips, invalidateCache } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip?.linkedGroupId) return;

    set({ clips: clips.map(c => c.linkedGroupId === clip.linkedGroupId ? { ...c, linkedGroupId: undefined } : c) });
    invalidateCache();
    log.debug('Unlinked group', { groupId: clip.linkedGroupId });
  },

  linkClips: (clipIds) => {
    const { clips, tracks, invalidateCache } = get();
    const targetClipIds = uniqueExistingClipIds(clips, clipIds);
    if (targetClipIds.length < 2) return;

    const selectedClipIds = new Set(targetClipIds);
    const cleanup = collectLinkCleanupTargets(clips, targetClipIds);
    if (hasLockedAffectedClip(clips, tracks, cleanup.affectedClipIds)) {
      log.warn('Cannot link clips with locked linked targets', { clipIds: targetClipIds });
      return;
    }

    const manualGroupId = targetClipIds.length > 2 ? generateManualLinkedGroupId() : null;
    const [firstClipId, secondClipId] = targetClipIds;

    captureSnapshot(targetClipIds.length === 2 ? 'Link clips' : 'Link clip group');
    set({
      clips: clips.map((clip) => {
        let nextClip = clip;
        if (cleanup.pairClipIds.has(clip.id)) {
          nextClip = { ...nextClip, linkedClipId: undefined };
        }
        if (nextClip.linkedGroupId && cleanup.manualGroupIds.has(nextClip.linkedGroupId)) {
          nextClip = { ...nextClip, linkedGroupId: undefined };
        }

        if (targetClipIds.length === 2) {
          if (clip.id === firstClipId) return { ...nextClip, linkedClipId: secondClipId };
          if (clip.id === secondClipId) return { ...nextClip, linkedClipId: firstClipId };
          return nextClip;
        }

        if (manualGroupId && selectedClipIds.has(clip.id)) {
          return { ...nextClip, linkedGroupId: manualGroupId };
        }
        return nextClip;
      }),
      selectedClipIds: new Set(targetClipIds),
      primarySelectedClipId: targetClipIds[0] ?? null,
    });
    invalidateCache();
    log.debug('Linked clips', { clipIds: targetClipIds, groupId: manualGroupId });
  },

  unlinkClips: (clipIds) => {
    const { clips, tracks, invalidateCache } = get();
    const targetClipIds = uniqueExistingClipIds(clips, clipIds);
    if (targetClipIds.length === 0) return;

    const cleanup = collectLinkCleanupTargets(clips, targetClipIds);
    const hasPairLink = cleanup.pairClipIds.size > 0;
    const hasManualGroup = cleanup.manualGroupIds.size > 0;
    if (!hasPairLink && !hasManualGroup) return;
    if (hasLockedAffectedClip(clips, tracks, cleanup.affectedClipIds)) {
      log.warn('Cannot unlink clips with locked linked targets', { clipIds: targetClipIds });
      return;
    }

    captureSnapshot(targetClipIds.length === 1 ? 'Unlink clip' : 'Unlink clips');
    set({
      clips: clips.map((clip) => {
        let nextClip = clip;
        if (cleanup.pairClipIds.has(clip.id)) {
          nextClip = { ...nextClip, linkedClipId: undefined };
        }
        if (nextClip.linkedGroupId && cleanup.manualGroupIds.has(nextClip.linkedGroupId)) {
          nextClip = { ...nextClip, linkedGroupId: undefined };
        }
        return nextClip;
      }),
    });
    invalidateCache();
    log.debug('Unlinked clips', { clipIds: targetClipIds });
  },
});
