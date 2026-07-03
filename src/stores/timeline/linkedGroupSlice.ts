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
import { resolveAudibleAudioClip } from '../../services/audio/audioClipResolution';
import { audioSync, type TimelineAudioSyncReport } from '../../services/audioSync';

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

function orderedAffectedClipIds(clips: TimelineClip[], affectedClipIds: Set<string>): string[] {
  return clips
    .filter((clip) => affectedClipIds.has(clip.id))
    .map((clip) => clip.id);
}

function collectAudioPairIds(clips: TimelineClip[], clipId: string): string[] {
  const ids = new Set([clipId]);
  const clip = clips.find((candidate) => candidate.id === clipId);
  if (clip?.linkedClipId) ids.add(clip.linkedClipId);
  for (const candidate of clips) {
    if (candidate.linkedClipId === clipId) ids.add(candidate.id);
  }
  return [...ids].filter((id) => clips.some((candidate) => candidate.id === id));
}

function resolveAudioSyncClipIds(
  clips: TimelineClip[],
  clipIds: string[],
): string[] {
  const resolved = new Map<string, TimelineClip>();
  for (const clipId of clipIds) {
    const audioClip = resolveAudibleAudioClip(clips, clipId)?.audioClip;
    if (audioClip) resolved.set(audioClip.id, audioClip);
  }
  return [...resolved.keys()];
}

function getAudioSyncGuardSignature(clip: TimelineClip): string {
  return JSON.stringify({
    duration: clip.duration,
    inPoint: clip.inPoint,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    mediaFileId: clip.mediaFileId,
    outPoint: clip.outPoint,
    reversed: clip.reversed,
    sourceMediaFileId: clip.source?.mediaFileId,
    sourceType: clip.source?.type,
    speed: clip.speed,
    startTime: clip.startTime,
    trackId: clip.trackId,
  });
}

function createAudioSyncGuard(clips: TimelineClip[], audioClipIds: string[]): Map<string, string> {
  const guardedClipIds = new Set<string>();
  for (const audioClipId of audioClipIds) {
    for (const affectedId of collectAudioPairIds(clips, audioClipId)) {
      guardedClipIds.add(affectedId);
    }
  }
  return new Map([...guardedClipIds].flatMap((clipId) => {
    const clip = clips.find((candidate) => candidate.id === clipId);
    return clip ? [[clipId, getAudioSyncGuardSignature(clip)]] : [];
  }));
}

function hasAudioSyncGuardChanged(clips: TimelineClip[], guard: Map<string, string>): boolean {
  for (const [clipId, signature] of guard) {
    const clip = clips.find((candidate) => candidate.id === clipId);
    if (!clip || getAudioSyncGuardSignature(clip) !== signature) return true;
  }
  return false;
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

    const cleanup = collectLinkCleanupTargets(clips, targetClipIds);
    if (hasLockedAffectedClip(clips, tracks, cleanup.affectedClipIds)) {
      log.warn('Cannot link clips with locked linked targets', { clipIds: targetClipIds });
      return;
    }

    const linkTargetClipIds = orderedAffectedClipIds(clips, cleanup.affectedClipIds);
    const useManualGroup = linkTargetClipIds.length > 2;
    const manualGroupId = useManualGroup ? generateManualLinkedGroupId() : null;
    const [firstClipId, secondClipId] = targetClipIds;

    captureSnapshot(useManualGroup ? 'Link clip group' : 'Link clips');
    set({
      clips: clips.map((clip) => {
        let nextClip = clip;
        if (!useManualGroup && cleanup.pairClipIds.has(clip.id)) {
          nextClip = { ...nextClip, linkedClipId: undefined };
        }
        if (nextClip.linkedGroupId && cleanup.manualGroupIds.has(nextClip.linkedGroupId)) {
          nextClip = { ...nextClip, linkedGroupId: undefined };
        }

        if (!useManualGroup) {
          if (clip.id === firstClipId) return { ...nextClip, linkedClipId: secondClipId };
          if (clip.id === secondClipId) return { ...nextClip, linkedClipId: firstClipId };
          return nextClip;
        }

        if (manualGroupId && cleanup.affectedClipIds.has(clip.id)) {
          return { ...nextClip, linkedGroupId: manualGroupId };
        }
        return nextClip;
      }),
      selectedClipIds: new Set(useManualGroup ? linkTargetClipIds : targetClipIds),
      primarySelectedClipId: (useManualGroup ? linkTargetClipIds[0] : targetClipIds[0]) ?? null,
    });
    invalidateCache();
    log.debug('Linked clips', { clipIds: linkTargetClipIds, groupId: manualGroupId });
  },

  syncClipsViaAudio: async (clipIds, masterClipId) => {
    const initialState = get();
    const targetClipIds = uniqueExistingClipIds(initialState.clips, clipIds);
    const audioClipIds = resolveAudioSyncClipIds(initialState.clips, targetClipIds);
    if (audioClipIds.length < 2) {
      log.warn('Cannot sync via audio without at least two audible clips', { clipIds: targetClipIds });
      return null;
    }

    const masterAudioClipId = masterClipId
      ? resolveAudibleAudioClip(initialState.clips, masterClipId)?.audioClip.id
      : undefined;
    const requestedMasterClipId = masterAudioClipId && audioClipIds.includes(masterAudioClipId)
      ? masterAudioClipId
      : audioClipIds[0];
    const syncGuard = createAudioSyncGuard(initialState.clips, audioClipIds);
    const audioInputs = audioClipIds
      .map((clipId) => initialState.clips.find((clip) => clip.id === clipId))
      .filter((clip): clip is TimelineClip => Boolean(clip))
      .map((clip) => ({
        clip,
        keyframes: initialState.clipKeyframes.get(clip.id) ?? [],
      }));

    let report: TimelineAudioSyncReport;
    try {
      report = await audioSync.syncTimelineClipsViaAudio(audioInputs, {
        masterClipId: requestedMasterClipId,
      });
    } catch (error) {
      log.warn('Audio sync failed', error);
      return null;
    }

    const syncedTargetCount = report.alignments.filter((alignment) => alignment.audioClipId !== report.masterAudioClipId).length;
    if (syncedTargetCount === 0) {
      log.warn('Audio sync did not produce any target alignment', { report });
      return report;
    }

    const currentState = get();
    if (hasAudioSyncGuardChanged(currentState.clips, syncGuard)) {
      log.warn('Audio sync result was discarded because synced clips changed during analysis', { clipIds: [...syncGuard.keys()] });
      return null;
    }

    const { clips, tracks, invalidateCache, updateDuration } = currentState;
    const alignmentByAudioClipId = new Map(report.alignments.map((alignment) => [alignment.audioClipId, alignment]));
    const movedClipIds = new Set<string>();
    const deltasByClipId = new Map<string, number>();
    for (const [audioClipId, alignment] of alignmentByAudioClipId) {
      const currentAudioClip = clips.find((clip) => clip.id === audioClipId);
      if (!currentAudioClip) continue;
      const delta = alignment.targetStartTime - currentAudioClip.startTime;
      for (const affectedId of collectAudioPairIds(clips, audioClipId)) {
        movedClipIds.add(affectedId);
        deltasByClipId.set(affectedId, delta);
      }
    }

    const minProjectedStart = Math.min(...[...deltasByClipId].map(([clipId, delta]) => {
      const clip = clips.find((candidate) => candidate.id === clipId);
      return clip ? clip.startTime + delta : Infinity;
    }));
    if (Number.isFinite(minProjectedStart) && minProjectedStart < 0) {
      for (const [clipId, delta] of deltasByClipId) {
        deltasByClipId.set(clipId, delta - minProjectedStart);
      }
    }

    if (movedClipIds.size < 2) {
      log.warn('Audio sync did not produce enough movable clips', { report });
      return report;
    }

    const cleanup = collectLinkCleanupTargets(clips, [...movedClipIds]);
    const lockedAffectedIds = new Set([...cleanup.affectedClipIds, ...movedClipIds]);
    if (hasLockedAffectedClip(clips, tracks, lockedAffectedIds)) {
      log.warn('Cannot sync clips via audio with locked linked targets', { clipIds: [...lockedAffectedIds] });
      return null;
    }

    const groupId = generateManualLinkedGroupId();
    captureSnapshot('Sync via audio');
    set({
      clips: clips.map((clip) => {
        const delta = deltasByClipId.get(clip.id);
        const clearsOldManualGroup = clip.linkedGroupId && cleanup.manualGroupIds.has(clip.linkedGroupId);
        if (delta === undefined) {
          return clearsOldManualGroup ? { ...clip, linkedGroupId: undefined } : clip;
        }
        return {
          ...clip,
          startTime: Math.max(0, clip.startTime + delta),
          linkedGroupId: groupId,
        };
      }),
      selectedClipIds: new Set(movedClipIds),
      primarySelectedClipId: report.masterAudioClipId,
    });
    updateDuration();
    invalidateCache();
    log.debug('Synced clips via audio', {
      groupId,
      masterClipId: report.masterAudioClipId,
      aligned: report.alignments.length,
      failed: report.failures.length,
    });
    return report;
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
