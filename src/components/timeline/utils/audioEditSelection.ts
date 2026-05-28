import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types';

export interface AudioRegionSelectionInput {
  clip: Pick<TimelineClip, 'id' | 'trackId' | 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'reversed' | 'waveform'>;
  anchorTimelineTime: number;
  focusTimelineTime: number;
  snapThresholdSeconds?: number;
}

export interface MoveAudioRegionSelectionInput {
  clip: AudioRegionSelectionInput['clip'];
  selection: TimelineAudioRegionSelection;
  deltaTimelineSeconds: number;
}

export interface ResizeAudioRegionSelectionInput {
  clip: AudioRegionSelectionInput['clip'];
  selection: TimelineAudioRegionSelection;
  edge: 'left' | 'right';
  focusTimelineTime: number;
  snapThresholdSeconds?: number;
}

interface SnapResult {
  timelineTime: number;
  sourceTime: number;
  snapped: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function timelineTimeToSourceTime(
  clip: AudioRegionSelectionInput['clip'],
  timelineTime: number,
): number {
  const clipDuration = Math.max(0.001, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = Math.max(0.001, sourceEnd - sourceStart);
  const timelineRatio = clamp((timelineTime - clip.startTime) / clipDuration, 0, 1);

  return clip.reversed
    ? sourceEnd - timelineRatio * sourceSpan
    : sourceStart + timelineRatio * sourceSpan;
}

function sourceTimeToTimelineTime(
  clip: AudioRegionSelectionInput['clip'],
  sourceTime: number,
): number {
  const clipDuration = Math.max(0.001, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart, clip.outPoint ?? sourceStart + clipDuration);
  const sourceSpan = Math.max(0.001, sourceEnd - sourceStart);
  const sourceRatio = clamp((sourceTime - sourceStart) / sourceSpan, 0, 1);
  const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;

  return clip.startTime + timelineRatio * clipDuration;
}

function snapTimelineTimeToWaveformValley(
  clip: AudioRegionSelectionInput['clip'],
  timelineTime: number,
  thresholdSeconds: number,
): SnapResult {
  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + Math.max(0.001, clip.duration);
  const clampedTimelineTime = clamp(timelineTime, clipStart, clipEnd);
  const sourceTime = timelineTimeToSourceTime(clip, clampedTimelineTime);
  const waveform = clip.waveform ?? [];

  if (waveform.length < 3 || thresholdSeconds <= 0) {
    return { timelineTime: clampedTimelineTime, sourceTime, snapped: false };
  }

  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart, clip.outPoint ?? sourceStart + clip.duration);
  const sourceSpan = Math.max(0.001, sourceEnd - sourceStart);
  const sourceRatio = clamp((sourceTime - sourceStart) / sourceSpan, 0, 1);
  const centerIndex = Math.round(sourceRatio * (waveform.length - 1));
  const indexRadius = Math.max(1, Math.round((thresholdSeconds / sourceSpan) * waveform.length));
  const startIndex = Math.max(0, centerIndex - indexRadius);
  const endIndex = Math.min(waveform.length - 1, centerIndex + indexRadius);
  let bestIndex = centerIndex;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const amplitude = Math.abs(waveform[index] ?? 0);
    const distancePenalty = Math.abs(index - centerIndex) / Math.max(1, indexRadius);
    const score = amplitude + distancePenalty * 0.08;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  const snappedSourceTime = sourceStart + (bestIndex / Math.max(1, waveform.length - 1)) * sourceSpan;
  const snappedTimelineTime = clamp(sourceTimeToTimelineTime(clip, snappedSourceTime), clipStart, clipEnd);

  return {
    timelineTime: snappedTimelineTime,
    sourceTime: snappedSourceTime,
    snapped: bestIndex !== centerIndex,
  };
}

export function resolveTimelineAudioRegionSelection(
  input: AudioRegionSelectionInput,
): TimelineAudioRegionSelection {
  const threshold = Math.max(0, input.snapThresholdSeconds ?? 0);
  const anchor = snapTimelineTimeToWaveformValley(input.clip, input.anchorTimelineTime, threshold);
  const focus = snapTimelineTimeToWaveformValley(input.clip, input.focusTimelineTime, threshold);
  const startTime = Math.min(anchor.timelineTime, focus.timelineTime);
  const endTime = Math.max(anchor.timelineTime, focus.timelineTime);
  const sourceStart = Math.min(anchor.sourceTime, focus.sourceTime);
  const sourceEnd = Math.max(anchor.sourceTime, focus.sourceTime);

  return {
    clipId: input.clip.id,
    trackId: input.clip.trackId,
    startTime,
    endTime,
    sourceInPoint: sourceStart,
    sourceOutPoint: sourceEnd,
    snappedToZeroCrossing: anchor.snapped || focus.snapped,
  };
}

export function moveTimelineAudioRegionSelection(
  input: MoveAudioRegionSelectionInput,
): TimelineAudioRegionSelection {
  const clipStart = input.clip.startTime;
  const clipEnd = input.clip.startTime + Math.max(0.001, input.clip.duration);
  const regionDuration = Math.max(0.001, input.selection.endTime - input.selection.startTime);
  const maxStart = Math.max(clipStart, clipEnd - regionDuration);
  const nextStart = clamp(input.selection.startTime + input.deltaTimelineSeconds, clipStart, maxStart);
  const nextEnd = Math.min(clipEnd, nextStart + regionDuration);

  return resolveTimelineAudioRegionSelection({
    clip: input.clip,
    anchorTimelineTime: nextStart,
    focusTimelineTime: nextEnd,
    snapThresholdSeconds: 0,
  });
}

export function resizeTimelineAudioRegionSelection(
  input: ResizeAudioRegionSelectionInput,
): TimelineAudioRegionSelection {
  return resolveTimelineAudioRegionSelection({
    clip: input.clip,
    anchorTimelineTime: input.edge === 'left'
      ? input.selection.endTime
      : input.selection.startTime,
    focusTimelineTime: input.focusTimelineTime,
    snapThresholdSeconds: input.snapThresholdSeconds,
  });
}
