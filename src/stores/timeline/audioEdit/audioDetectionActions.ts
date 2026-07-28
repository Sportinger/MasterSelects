import type { ClipAudioEditOperation, TimelineClip } from '../../../types';
import type {
  ApplyDetectedSilenceRemovalOptions,
  ApplyRoomToneFillOptions,
  AudioEditActions,
  SliceCreator,
  TimelineAudioRegionSelection,
} from '../types';
import type {
  AudioSilenceDetectionOptions,
  AudioSilenceRange,
} from '../../../services/audio/audioSilenceDetection';
import { getClipAudioSourceRange } from '../../../services/audio/audioRepairSuggestionOperations';
import {
  detectRmsAudioSilence,
  detectSilenceWithAudioArtifacts,
  normalizeAudioEditSilenceRanges,
  resolveRoomToneProfileFillParams,
} from '../../../services/audio/intelligence/audioEditDetectionArtifacts';
import { Logger } from '../../../services/logger';
import { captureSnapshot } from '../../historyStore';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { createAudioEditOperationId, isAudioClip } from './audioEditHelpers';

const log = Logger.create('TimelineAudioEdit');

type DetectedAudioEditActions = Pick<
  AudioEditActions,
  | 'detectClipSilenceRanges'
  | 'applyDetectedSilenceRemoval'
  | 'applyRoomToneFill'
>;

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceRange = getClipAudioSourceRange(clip);
  const sourceSpan = Math.max(0.001, sourceRange.end - sourceRange.start);
  const ratio = Math.max(0, Math.min(1, (sourceTime - sourceRange.start) / sourceSpan));
  return clip.startTime + ratio * clip.duration;
}

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0.0005;
}

async function resolveDetectedSilenceRanges(
  options: ApplyDetectedSilenceRemovalOptions,
  detect: (options: AudioSilenceDetectionOptions) => Promise<AudioSilenceRange[]>,
): Promise<AudioSilenceRange[]> {
  if (options.ranges?.length) {
    return options.ranges;
  }
  return detect(options.detection ?? {});
}

function getSelectedRoomToneTargetRange(
  clip: TimelineClip,
  selection: TimelineAudioRegionSelection | null,
): { start: number; end: number } | null {
  if (!selection || selection.clipId !== clip.id) return null;
  const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
  const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
  return end - start > 0.0005 ? { start, end } : null;
}

function encodeRoomToneSourceRanges(ranges: readonly AudioSilenceRange[]): string | null {
  if (!ranges.length) return null;
  return JSON.stringify(ranges.slice(0, 12).map(range => ({
    start: Number(range.start.toFixed(6)),
    end: Number(range.end.toFixed(6)),
    duration: Number(range.duration.toFixed(6)),
    rmsDb: Number(range.rmsDb.toFixed(3)),
  })));
}

export const createAudioDetectionActions: SliceCreator<DetectedAudioEditActions> = (_set, get) => ({
  detectClipSilenceRanges: async (clipId, options = {}) => {
    const clip = get().clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot detect silence for missing or non-audio clip', { clipId });
      return [];
    }

    return detectSilenceWithAudioArtifacts(clip, options);
  },

  applyDetectedSilenceRemoval: async (clipId, options = {}) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot remove detected silence from missing or non-audio clip', { clipId });
      return [];
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove detected silence on locked track', { clipId, trackId: clip.trackId });
      return [];
    }

    const ranges = normalizeAudioEditSilenceRanges(
      clip,
      await resolveDetectedSilenceRanges(
        options,
        detection => detectSilenceWithAudioArtifacts(clip, detection),
      ),
    );
    if (ranges.length === 0) {
      log.info('No detected silence ranges to remove', { clipId });
      return [];
    }

    const now = Date.now();
    const totalRemovedSeconds = ranges.reduce((sum, range) => sum + range.duration, 0);
    const operations: ClipAudioEditOperation[] = ranges.map((range, index) => ({
      id: createAudioEditOperationId(),
      type: 'delete-silence',
      enabled: true,
      params: {
        label: 'Remove detected silence',
        detectedSilence: true,
        compactTimeline: true,
        preserveClipDuration: false,
        silenceThresholdDb: options.detection?.thresholdDb ?? -50,
        silenceRmsDb: Number(range.rmsDb.toFixed(3)),
        silenceDuration: Number(range.duration.toFixed(6)),
        sequenceIndex: index + 1,
        sequenceCount: ranges.length,
        timelineStart: sourceTimeToTimelineTime(clip, range.start),
        timelineEnd: sourceTimeToTimelineTime(clip, range.end),
      },
      timeRange: { start: range.start, end: range.end },
      createdAt: now + index,
    }));
    const operationIds = operations.map(operation => operation.id);
    const compactedDuration = Math.max(0.001, clip.duration - totalRemovedSeconds);
    const rippleShift = options.rippleTimeline ? clip.duration - compactedDuration : 0;
    const oldClipEnd = clip.startTime + clip.duration;

    captureSnapshot('Remove detected silence');
    _set({
      clips: clips.map(currentClip => {
        if (currentClip.id === clipId) {
          const audioState = currentClip.audioState ?? {};
          return clearProcessedAudioAnalysisRefs({
            ...currentClip,
            duration: compactedDuration,
            audioState: {
              ...audioState,
              editStack: [
                ...(audioState.editStack ?? []),
                ...operations,
              ],
            },
          });
        }

        if (
          rippleShift > 0 &&
          currentClip.trackId === clip.trackId &&
          currentClip.startTime >= oldClipEnd - 0.0005
        ) {
          return {
            ...currentClip,
            startTime: Math.max(0, currentClip.startTime - rippleShift),
          };
        }

        return currentClip;
      }),
    });
    get().updateDuration();
    get().invalidateCache();
    return operationIds;
  },

  applyRoomToneFill: async (clipId, options: ApplyRoomToneFillOptions = {}) => {
    const { clips, tracks, audioRegionSelection } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply room tone fill to missing or non-audio clip', { clipId });
      return null;
    }

    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot apply room tone fill on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const targetRange = options.targetRange ?? getSelectedRoomToneTargetRange(clip, audioRegionSelection);
    if (!targetRange || targetRange.end - targetRange.start <= 0.0005) {
      log.warn('Cannot apply room tone fill without a target audio region', { clipId });
      return null;
    }

    const sourceRange = getClipAudioSourceRange(clip);
    const clampedTarget = {
      start: Math.max(sourceRange.start, Math.min(sourceRange.end, Math.min(targetRange.start, targetRange.end))),
      end: Math.max(sourceRange.start, Math.min(sourceRange.end, Math.max(targetRange.start, targetRange.end))),
    };
    if (clampedTarget.end - clampedTarget.start <= 0.0005) {
      log.warn('Cannot apply room tone fill outside the clip source range', { clipId });
      return null;
    }

    const profileFillParams = options.sourceRanges?.length
      ? undefined
      : await resolveRoomToneProfileFillParams(clip);
    const detectedSourceRanges = options.sourceRanges?.length
      ? options.sourceRanges
      : profileFillParams
        ? []
        : await detectRmsAudioSilence(clip, {
          thresholdDb: options.detection?.thresholdDb ?? -48,
          minSilenceSeconds: options.detection?.minSilenceSeconds ?? 0.2,
          windowSeconds: options.detection?.windowSeconds,
          hopSeconds: options.detection?.hopSeconds,
          paddingSeconds: options.detection?.paddingSeconds ?? 0,
          mergeGapSeconds: options.detection?.mergeGapSeconds,
          maxRanges: options.detection?.maxRanges ?? 16,
        });
    const sourceRanges = normalizeAudioEditSilenceRanges(clip, detectedSourceRanges)
      .filter(range => !rangesOverlap(range, clampedTarget))
      .slice(0, 12);
    const encodedSourceRanges = profileFillParams?.roomToneSourceRanges
      ?? encodeRoomToneSourceRanges(sourceRanges);
    const profileSourceRanges = profileFillParams?.roomToneSourceRanges
      ? JSON.parse(profileFillParams.roomToneSourceRanges) as { start: number; end: number }[]
      : [];
    const firstSourceRange = profileSourceRanges[0] ?? sourceRanges[0];
    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type: 'room-tone-fill',
      enabled: true,
      params: {
        label: 'Room tone fill',
        timelineStart: sourceTimeToTimelineTime(clip, clampedTarget.start),
        timelineEnd: sourceTimeToTimelineTime(clip, clampedTarget.end),
        preserveClipDuration: true,
        roomToneGainDb: options.gainDb ?? 0,
        crossfadeSeconds: options.crossfadeSeconds ?? 0.025,
        generatedNoiseDb: -66,
        roomToneSourceCount: profileSourceRanges.length || sourceRanges.length,
        ...(encodedSourceRanges ? { roomToneSourceRanges: encodedSourceRanges } : {}),
        ...(firstSourceRange ? {
          sourceInPoint: firstSourceRange.start,
          sourceOutPoint: firstSourceRange.end,
        } : {}),
      },
      timeRange: clampedTarget,
      createdAt: Date.now(),
    };

    captureSnapshot('Room tone fill');
    _set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return operation.id;
  },
});
