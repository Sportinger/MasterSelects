import { cancelHistoryBatch, endBatch, startBatch } from '../../stores/historyStore';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { createHistoryTimelineEditState } from '../../stores/timeline/historyTimelineEditState';
import { getClipSourceRate } from '../../utils/clipPlaybackTiming';
import { applyAutomaticAudioFades } from '../audio/applyAutomaticCutDeClick';
import {
  collectAutomaticAudioFadeTargets,
  collectLinkedDeletionIds,
  collectMissingAudioJunctionFadeTargets,
  DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS,
} from '../audio/automaticCutDeClick';
import { layerBuilder } from '../layerBuilder';
import { renderHostPort } from '../render/renderHostPort';
import {
  invalidateTimelineRuntimeCache,
  readTimelineRuntimeState,
} from '../timeline/timelineRuntimeCoordinator';
import type { CaptionTimelineTranscriptEvent } from './captionTimelineTranscript';
import { recordTranscriptReviewOmission } from './transcriptReviewEdits';
import { remapTranscriptReviewOmissionsForMove } from './transcriptReviewEdits';

const RANGE_EPSILON = 0.001;
export const CAPTION_DELETE_DE_CLICK_SECONDS = DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS;

export type DeleteCaptionTimelineRangeResult =
  | { ok: false; error: string }
  | { ok: true; deClickFadesApplied: number; removedDuration: number };

export type MoveTranscriptTimelineRangeResult =
  | { ok: false; error: string }
  | { ok: true; movedDuration: number; targetStart: number };

function findClipContainingRange(
  trackId: string,
  start: number,
  end: number,
) {
  return readTimelineRuntimeState().clips.find(clip => (
    clip.trackId === trackId
    && clip.startTime <= start + RANGE_EPSILON
    && clip.startTime + clip.duration >= end - RANGE_EPSILON
  ));
}

function failBatch(opened: boolean, message: string): DeleteCaptionTimelineRangeResult {
  if (opened) cancelHistoryBatch();
  return { ok: false, error: message };
}

function rippleCaptionClips(start: number, end: number): void {
  const removedDuration = end - start;
  useTimelineStore.setState(state => {
    const removedIds = new Set<string>();
    const clips = state.clips.flatMap(clip => {
      if (!clip.captionProperties) return [clip];
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= start + RANGE_EPSILON) return [clip];
      if (clipStart >= end - RANGE_EPSILON) {
        return [{ ...clip, startTime: Math.max(0, clipStart - removedDuration) }];
      }

      const keptBefore = Math.max(0, start - clipStart);
      const keptAfter = Math.max(0, clipEnd - end);
      const duration = keptBefore + keptAfter;
      if (duration <= RANGE_EPSILON) {
        removedIds.add(clip.id);
        return [];
      }
      const startTime = keptBefore > RANGE_EPSILON ? clipStart : start;
      return [{
        ...clip,
        startTime,
        duration,
        outPoint: clip.inPoint + duration,
        source: clip.source
          ? { ...clip.source, naturalDuration: duration }
          : clip.source,
      }];
    });
    const selectedClipIds = new Set(
      [...state.selectedClipIds].filter(id => !removedIds.has(id)),
    );
    return {
      clips,
      selectedClipIds,
      primarySelectedClipId: state.primarySelectedClipId
        && !removedIds.has(state.primarySelectedClipId)
        ? state.primarySelectedClipId
        : null,
    };
  });
}

export function deleteTranscriptTimelineRange(input: {
  captionClipId?: string;
  compositionId?: string;
  deClickFadeSeconds?: number;
  label: string;
  sourceClipId: string;
  timelineEnd: number;
  timelineStart: number;
  transcriptEvent?: CaptionTimelineTranscriptEvent;
}): DeleteCaptionTimelineRangeResult {
  const initialState = readTimelineRuntimeState();
  const sourceClip = initialState.clips.find(clip => clip.id === input.sourceClipId);
  const captionClip = input.captionClipId
    ? initialState.clips.find(clip => clip.id === input.captionClipId)
    : undefined;
  if (!sourceClip || (input.captionClipId && !captionClip?.captionProperties)) {
    return { ok: false, error: 'Transcript-Quelle oder Caption wurde nicht gefunden.' };
  }
  const track = initialState.tracks.find(candidate => candidate.id === sourceClip.trackId);
  if (track?.locked) return { ok: false, error: 'Die Quellspur ist gesperrt.' };
  const captionTrack = captionClip
    ? initialState.tracks.find(candidate => candidate.id === captionClip.trackId)
    : undefined;
  if (captionTrack?.locked) return { ok: false, error: 'Die Caption-Spur ist gesperrt.' };

  const clipStart = sourceClip.startTime;
  const clipEnd = clipStart + sourceClip.duration;
  const captionStart = captionClip?.startTime ?? clipStart;
  const captionEnd = captionClip
    ? captionClip.startTime + captionClip.duration
    : clipEnd;
  const start = Math.max(clipStart, captionStart, Math.min(input.timelineStart, input.timelineEnd));
  const end = Math.min(clipEnd, captionEnd, Math.max(input.timelineStart, input.timelineEnd));
  if (end - start <= RANGE_EPSILON) {
    return { ok: false, error: 'Der gewählte Wort-/Pausenbereich ist zu kurz.' };
  }
  const reversed = Boolean(sourceClip.reversed) !== ((sourceClip.speed ?? 1) < 0);
  if (reversed || Math.abs(getClipSourceRate(sourceClip) - 1) > RANGE_EPSILON) {
    return { ok: false, error: 'Wort-/Pausenschnitte sind für Speed- oder Reverse-Clips noch nicht verfügbar.' };
  }

  const batch = startBatch(input.label);
  const operationBase = `${input.label}:${Date.now()}`;
  if (end < clipEnd - RANGE_EPSILON) {
    const splitEnd = readTimelineRuntimeState().applyTimelineEditOperation({
      id: `${operationBase}:split-end`,
      type: 'split-at-time',
      clipIds: [sourceClip.id],
      time: end,
      includeLinked: true,
    }, { source: 'ui', historyLabel: input.label });
    if (!splitEnd.success) {
      return failBatch(batch.opened, splitEnd.warnings[0]?.message ?? 'Schnittende konnte nicht gesetzt werden.');
    }
  }

  const clipForStart = findClipContainingRange(sourceClip.trackId, start, end);
  if (!clipForStart) return failBatch(batch.opened, 'Der Schnittbereich wurde nach dem ersten Schnitt nicht gefunden.');
  if (start > clipForStart.startTime + RANGE_EPSILON) {
    const splitStart = readTimelineRuntimeState().applyTimelineEditOperation({
      id: `${operationBase}:split-start`,
      type: 'split-at-time',
      clipIds: [clipForStart.id],
      time: start,
      includeLinked: true,
    }, { source: 'ui', historyLabel: input.label });
    if (!splitStart.success) {
      return failBatch(batch.opened, splitStart.warnings[0]?.message ?? 'Schnittanfang konnte nicht gesetzt werden.');
    }
  }

  const clipsBeforeDelete = readTimelineRuntimeState().clips;
  const clipToDelete = clipsBeforeDelete.find(clip => (
    clip.trackId === sourceClip.trackId
    && Math.abs(clip.startTime - start) <= RANGE_EPSILON
    && Math.abs(clip.startTime + clip.duration - end) <= RANGE_EPSILON
  ));
  if (!clipToDelete) return failBatch(batch.opened, 'Das zu löschende Timeline-Segment wurde nicht gefunden.');

  const deletionIds = collectLinkedDeletionIds(clipsBeforeDelete, [clipToDelete.id], true);
  const fadeTargets = collectAutomaticAudioFadeTargets(clipsBeforeDelete, deletionIds);
  const capturedState = readTimelineRuntimeState();
  const capturedEditState = createHistoryTimelineEditState({
    clipKeyframes: capturedState.clipKeyframes,
    clips: capturedState.clips,
    duration: capturedState.duration,
    durationLocked: capturedState.durationLocked,
    id: `${operationBase}:restore`,
    label: `Restore ${input.label}`,
    layers: capturedState.layers,
    markers: capturedState.markers,
    masterAudioState: capturedState.masterAudioState,
    scrollX: capturedState.scrollX,
    selectedClipIds: capturedState.selectedClipIds,
    selectedLayerId: capturedState.selectedLayerId,
    tempoMap: capturedState.tempoMap,
    timestamp: Date.now(),
    tracks: capturedState.tracks,
    zoom: capturedState.zoom,
  });
  const restoreState = {
    ...capturedEditState,
    timeline: {
      ...capturedEditState.timeline,
      clipKeyframes: Object.fromEntries(
        Object.entries(capturedEditState.timeline.clipKeyframes)
          .filter(([clipId]) => deletionIds.has(clipId)),
      ),
      clips: capturedEditState.timeline.clips.filter(clip => deletionIds.has(clip.id)),
      layers: [],
      selectedClipIds: [],
    },
  };
  const deletion = readTimelineRuntimeState().applyTimelineEditOperation({
    id: `${operationBase}:ripple-delete`,
    type: 'ripple-delete-selection',
    clipIds: [clipToDelete.id],
    includeLinked: true,
  }, { source: 'ui', historyLabel: input.label });
  if (!deletion.success) {
    return failBatch(batch.opened, deletion.warnings[0]?.message ?? 'Der Bereich konnte nicht gelöscht werden.');
  }

  const fadeDuration = input.deClickFadeSeconds ?? CAPTION_DELETE_DE_CLICK_SECONDS;
  const deClickFadesApplied = applyAutomaticAudioFades(fadeTargets, fadeDuration);
  rippleCaptionClips(start, end);
  const compositionId = input.compositionId ?? useMediaStore.getState().activeCompositionId;
  if (compositionId && input.transcriptEvent) {
    recordTranscriptReviewOmission({
      compositionId,
      eventKey: input.transcriptEvent.key,
      kind: input.transcriptEvent.kind,
      restoreState,
      text: input.transcriptEvent.kind === 'word'
        ? input.transcriptEvent.text
        : `Pause ${Math.max(0, end - start).toFixed(1)}s`,
      timelineEnd: end,
      timelineStart: start,
    });
  }
  const finalState = readTimelineRuntimeState();
  finalState.updateDuration();
  finalState.setPlayheadPosition(start);
  invalidateTimelineRuntimeCache();
  layerBuilder.invalidateCache();
  renderHostPort.requestNewFrameRender();
  if (batch.opened) endBatch();
  return { ok: true, deClickFadesApplied, removedDuration: end - start };
}

export function deleteCaptionTimelineRange(input: {
  captionClipId: string;
  compositionId?: string;
  deClickFadeSeconds?: number;
  label: string;
  sourceClipId: string;
  timelineEnd: number;
  timelineStart: number;
  transcriptEvent?: CaptionTimelineTranscriptEvent;
}): DeleteCaptionTimelineRangeResult {
  return deleteTranscriptTimelineRange(input);
}

export function moveTranscriptTimelineRange(input: {
  compositionId?: string;
  label?: string;
  sourceClipIds: string[];
  timelineEnd: number;
  timelineStart: number;
  targetTime: number;
}): MoveTranscriptTimelineRangeResult {
  const start = Math.max(0, Math.min(input.timelineStart, input.timelineEnd));
  const end = Math.max(start, Math.max(input.timelineStart, input.timelineEnd));
  const duration = end - start;
  const target = Math.max(0, input.targetTime);
  if (duration <= RANGE_EPSILON) {
    return { ok: false, error: 'Der markierte Bereich ist zu kurz.' };
  }
  if (target >= start - RANGE_EPSILON && target <= end + RANGE_EPSILON) {
    return { ok: false, error: 'Wähle eine Position außerhalb des markierten Bereichs.' };
  }

  const initial = readTimelineRuntimeState();
  const sourceClips = input.sourceClipIds
    .map(id => initial.clips.find(clip => clip.id === id))
    .filter(clip => clip !== undefined);
  if (sourceClips.length === 0) {
    return { ok: false, error: 'Der markierte Transcript-Bereich wurde nicht gefunden.' };
  }
  const corridorStart = Math.min(target, start);
  const corridorEnd = Math.max(target, end);
  const trackIds = new Set(initial.clips.filter(clip => (
    clip.startTime < corridorEnd - RANGE_EPSILON
    && clip.startTime + clip.duration > corridorStart + RANGE_EPSILON
  )).map(clip => clip.trackId));
  sourceClips.forEach(clip => trackIds.add(clip.trackId));
  for (const sourceClip of sourceClips) {
    if (!sourceClip.linkedClipId) continue;
    const linked = initial.clips.find(clip => clip.id === sourceClip.linkedClipId);
    if (linked) trackIds.add(linked.trackId);
  }
  const blockedTrack = initial.tracks.find(track => trackIds.has(track.id) && track.locked);
  if (blockedTrack) return { ok: false, error: `Die Spur „${blockedTrack.name}“ ist gesperrt.` };

  const label = input.label ?? 'Move transcript range';
  const batch = startBatch(label);
  try {
    for (const time of [start, end, target]) {
      const hasCrossingClip = readTimelineRuntimeState().clips.some(clip => (
        trackIds.has(clip.trackId)
        && clip.startTime < time - RANGE_EPSILON
        && clip.startTime + clip.duration > time + RANGE_EPSILON
      ));
      if (!hasCrossingClip) continue;
      const split = readTimelineRuntimeState().applyTimelineEditOperation({
        id: `${label}:split:${time}:${Date.now()}`,
        includeLinked: true,
        time,
        trackIds: [...trackIds],
        type: 'split-all-at-time',
      }, { historyLabel: label, source: 'ui' });
      if (!split.success) {
        return failMoveBatch(
          batch.opened,
          split.warnings[0]?.message ?? 'Eine Grenze des Bereichs konnte nicht gesetzt werden.',
        );
      }
    }

    const state = readTimelineRuntimeState();
    const rangeClips = state.clips.filter(clip => (
      trackIds.has(clip.trackId)
      && clip.startTime >= start - RANGE_EPSILON
      && clip.startTime + clip.duration <= end + RANGE_EPSILON
    ));
    if (rangeClips.length === 0) {
      return failMoveBatch(batch.opened, 'Im markierten Bereich wurden keine verschiebbaren Clips gefunden.');
    }

    const moves = state.clips.flatMap(clip => {
      if (!trackIds.has(clip.trackId)) return [];
      const clipEnd = clip.startTime + clip.duration;
      if (clip.startTime >= start - RANGE_EPSILON && clipEnd <= end + RANGE_EPSILON) {
        const targetStart = target < start
          ? target + (clip.startTime - start)
          : target - duration + (clip.startTime - start);
        return [{ clipId: clip.id, startTime: targetStart, trackId: clip.trackId }];
      }
      if (target < start && clip.startTime >= target - RANGE_EPSILON && clipEnd <= start + RANGE_EPSILON) {
        return [{ clipId: clip.id, startTime: clip.startTime + duration, trackId: clip.trackId }];
      }
      if (target > end && clip.startTime >= end - RANGE_EPSILON && clipEnd <= target + RANGE_EPSILON) {
        return [{ clipId: clip.id, startTime: clip.startTime - duration, trackId: clip.trackId }];
      }
      return [];
    });
    const move = state.applyTimelineEditOperation({
      id: `${label}:move:${Date.now()}`,
      includeLinked: false,
      moves,
      type: 'move-clips',
    }, { historyLabel: label, source: 'ui' });
    if (!move.success) {
      return failMoveBatch(batch.opened, move.warnings[0]?.message ?? 'Der Bereich konnte nicht verschoben werden.');
    }

    if (input.compositionId) {
      remapTranscriptReviewOmissionsForMove({
        compositionId: input.compositionId,
        end,
        start,
        target,
      });
    }
    const final = readTimelineRuntimeState();
    const fadeTargets = collectMissingAudioJunctionFadeTargets(final.clips);
    applyAutomaticAudioFades(fadeTargets, CAPTION_DELETE_DE_CLICK_SECONDS);
    final.updateDuration();
    const targetStart = target < start ? target : target - duration;
    final.setPlayheadPosition(targetStart);
    invalidateTimelineRuntimeCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
    if (batch.opened) endBatch();
    return { ok: true, movedDuration: duration, targetStart };
  } catch (error) {
    return failMoveBatch(
      batch.opened,
      error instanceof Error ? error.message : 'Der Bereich konnte nicht verschoben werden.',
    );
  }
}

function failMoveBatch(opened: boolean, error: string): MoveTranscriptTimelineRangeResult {
  if (opened) cancelHistoryBatch();
  return { ok: false, error };
}
