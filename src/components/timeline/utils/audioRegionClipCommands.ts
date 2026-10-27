// Split and Cut of an audio region: the two region commands that change clips instead of adding an
// operation to the clip's audio edit stack. Shared by the desktop clip interaction shell and the
// phone region sheet so both run the same timeline edit operations with the same history labels.

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import { Logger } from '../../../services/logger';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  resolveAudioRegionTimelineRangeForClip,
} from './audioRegionDisplay';

const log = Logger.create('AudioRegionClipCommands');

export type AudioRegionClipCommandResult =
  | { ok: true; middleClipId?: string }
  | { ok: false; reason: string };

type RegionClip = Pick<TimelineClip, 'id' | 'trackId' | 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed'>;

function currentClipOf(clipId: string, fallback?: RegionClip): RegionClip | null {
  return useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId) ?? fallback ?? null;
}

/**
 * Splits the clip at both edges of the region (edges on the clip boundary are skipped), selects the
 * middle piece and clears the region selection.
 */
export function splitAudioRegionOfClip(
  clipId: string,
  selection: TimelineAudioRegionSelection | null,
  fallbackClip?: RegionClip,
): AudioRegionClipCommandResult {
  const timelineState = useTimelineStore.getState();
  const currentClip = currentClipOf(clipId, fallbackClip);
  if (!selection || !currentClip) {
    log.warn('Cannot split audio region without an active selection', { clipId });
    return { ok: false, reason: 'Select a range of the sound first.' };
  }
  const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
  if (!range) {
    log.warn('Cannot split audio region outside clip bounds', { clipId, selection });
    return { ok: false, reason: 'The range lies outside the clip.' };
  }

  const clipStart = currentClip.startTime;
  const clipEnd = currentClip.startTime + Math.max(AUDIO_REGION_TIMELINE_EPSILON, currentClip.duration);
  const splitTimes = [range.start, range.end].filter((time) =>
    time > clipStart + AUDIO_REGION_TIMELINE_EPSILON &&
    time < clipEnd - AUDIO_REGION_TIMELINE_EPSILON
  );
  const result = splitTimes.length > 0
    ? timelineState.applyTimelineEditOperation({
      id: `split-audio-region:${clipId}:${range.start}:${range.end}`,
      type: 'split-at-times',
      clipId: currentClip.id,
      times: splitTimes,
      includeLinked: false,
    }, {
      source: 'context-menu',
      historyLabel: 'Split audio region',
    })
    : { success: true };

  const latestState = useTimelineStore.getState();
  if (!result.success) {
    log.warn('Split audio region operation failed', { clipId: currentClip.id, range, result });
    latestState.clearAudioRegionSelection();
    return { ok: false, reason: 'The clip could not be split here (is its track locked?).' };
  }
  const middleClip = latestState.clips.find((candidate) =>
    candidate.trackId === currentClip.trackId &&
    Math.abs(candidate.startTime - range.start) <= AUDIO_REGION_TIMELINE_EPSILON &&
    Math.abs(candidate.duration - range.duration) <= AUDIO_REGION_TIMELINE_EPSILON
  );
  if (middleClip) latestState.selectClip(middleClip.id);
  latestState.clearAudioRegionSelection();
  return { ok: true, ...(middleClip ? { middleClipId: middleClip.id } : {}) };
}

/** Copies the region to the audio region clipboard, then lifts it out of the track (leaves a gap). */
export function cutAudioRegionOfClip(
  clipId: string,
  selection: TimelineAudioRegionSelection | null,
  fallbackClip?: RegionClip,
): AudioRegionClipCommandResult {
  const timelineState = useTimelineStore.getState();
  const currentClip = currentClipOf(clipId, fallbackClip);
  if (!selection || !currentClip) {
    log.warn('Cannot cut audio region without an active selection', { clipId });
    return { ok: false, reason: 'Select a range of the sound first.' };
  }
  const range = resolveAudioRegionTimelineRangeForClip(currentClip, selection);
  if (!range) {
    log.warn('Cannot cut audio region outside clip bounds', { clipId, selection });
    return { ok: false, reason: 'The range lies outside the clip.' };
  }

  if (timelineState.audioRegionSelection?.clipId !== currentClip.id) {
    timelineState.setAudioRegionSelection(selection);
  }
  useTimelineStore.getState().copySelectedAudioRegion();
  const result = useTimelineStore.getState().applyTimelineEditOperation({
    id: `cut-audio-region:${clipId}:${range.start}:${range.end}`,
    type: 'lift-range',
    range: {
      startTime: range.start,
      endTime: range.end,
      trackIds: [currentClip.trackId],
    },
    includeLinked: false,
  }, {
    source: 'context-menu',
    historyLabel: 'Cut audio region',
  });
  if (result.success) {
    useTimelineStore.getState().clearAudioRegionSelection();
    return { ok: true };
  }
  log.warn('Cut audio region operation failed', { clipId: currentClip.id, range, result });
  return { ok: false, reason: 'The range could not be cut (is the track locked?).' };
}
