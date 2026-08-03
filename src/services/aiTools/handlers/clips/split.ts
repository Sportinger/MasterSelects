import { useTimelineStore } from '../../../../stores/timeline';
import { isExclusiveTimelineMutationLeaseActive } from '../../../../stores/timeline/exclusiveMutationLease';
import type { TimelineClip } from '../../../../types/timeline';
import { audioExtractor } from '../../../../engine/audio/AudioExtractor';
import { snapSourceTimeToLowDiscontinuity } from '../../../audio/sampleAccurateSnap';
import type { ToolResult } from '../../types.ts';
import { isAIExecutionActive } from '../../executionState';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from '../mutationEntityResults';
import type { TimelineStore } from './runtime';
import { logSplitCheckpoint, splitClipBatch } from './runtime';

const SPEECH_SAFE_SNAP_WINDOW_SECONDS = 0.008;
const SPLIT_BOUNDARY_EPSILON_SECONDS = 0.001;

interface AudioBoundaryResolution {
  appliedCount: number;
  requested: boolean;
  adjustments: Array<{ delta: number; requested: number; resolved: number }>;
}

type ResolvedAudioBoundaries = { resolution: AudioBoundaryResolution; times: number[] };

function isAudioClip(clip: TimelineClip): boolean {
  return clip.source?.type === 'audio' || clip.file?.type?.startsWith('audio/') === true;
}

function timelineTimeToSourceTime(clip: TimelineClip, timelineTime: number): number {
  const timelineRatio = Math.max(0, Math.min(1, (
    timelineTime - clip.startTime
  ) / Math.max(SPLIT_BOUNDARY_EPSILON_SECONDS, clip.duration)));
  const sourceSpan = Math.max(SPLIT_BOUNDARY_EPSILON_SECONDS, clip.outPoint - clip.inPoint);
  const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
  return reversed
    ? clip.outPoint - timelineRatio * sourceSpan
    : clip.inPoint + timelineRatio * sourceSpan;
}

function sourceTimeToTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const sourceSpan = Math.max(SPLIT_BOUNDARY_EPSILON_SECONDS, clip.outPoint - clip.inPoint);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - clip.inPoint) / sourceSpan));
  const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
  return clip.startTime + (reversed ? 1 - sourceRatio : sourceRatio) * clip.duration;
}

function fallbackAudioBoundaries(times: readonly number[]): ResolvedAudioBoundaries {
  return {
    resolution: {
      appliedCount: 0,
      requested: true,
      adjustments: times.map((time) => ({ delta: 0, requested: time, resolved: time })),
    },
    times: [...times],
  };
}

function boundaryAudioClip(clip: TimelineClip): TimelineClip {
  const linked = clip.linkedClipId
    ? useTimelineStore.getState().clips.find((candidate) => candidate.id === clip.linkedClipId)
    : undefined;
  return linked && isAudioClip(linked) ? linked : clip;
}

function resolveSpeechSafeSplitTimesFromBuffer(
  clip: TimelineClip,
  audioClip: TimelineClip,
  times: readonly number[],
  buffer: AudioBuffer,
): ResolvedAudioBoundaries {
  const fallback = fallbackAudioBoundaries(times);
  const adjustments = times.map((time) => {
    const sourceTime = timelineTimeToSourceTime(audioClip, time);
    const snappedSourceTime = snapSourceTimeToLowDiscontinuity(buffer, sourceTime, {
      maxDistanceSeconds: SPEECH_SAFE_SNAP_WINDOW_SECONDS,
    });
    if (snappedSourceTime === null) return { delta: 0, requested: time, resolved: time };
    const resolved = sourceTimeToTimelineTime(audioClip, snappedSourceTime);
    return { delta: resolved - time, requested: time, resolved };
  });
  const resolvedTimes = adjustments.map((adjustment) => adjustment.resolved);
  const clipEnd = clip.startTime + clip.duration;
  const invalid = resolvedTimes.some((time, index) => (
    !Number.isFinite(time)
    || time <= clip.startTime + SPLIT_BOUNDARY_EPSILON_SECONDS
    || time >= clipEnd - SPLIT_BOUNDARY_EPSILON_SECONDS
    || (index > 0 && time <= resolvedTimes[index - 1] + SPLIT_BOUNDARY_EPSILON_SECONDS)
  ));
  if (invalid) return fallback;
  return {
    resolution: {
      appliedCount: adjustments.filter((adjustment) => Math.abs(adjustment.delta) > 1e-7).length,
      requested: true,
      adjustments,
    },
    times: resolvedTimes,
  };
}

function resolveSpeechSafeSplitTimesFromCache(
  clip: TimelineClip,
  times: readonly number[],
): ResolvedAudioBoundaries {
  const audioClip = boundaryAudioClip(clip);
  const mediaFileId = audioClip.source?.mediaFileId ?? audioClip.mediaFileId ?? audioClip.id;
  const buffer = audioExtractor.getCached(mediaFileId);
  return buffer === null
    ? fallbackAudioBoundaries(times)
    : resolveSpeechSafeSplitTimesFromBuffer(clip, audioClip, times, buffer);
}

async function resolveSpeechSafeSplitTimes(
  clip: TimelineClip,
  times: readonly number[],
): Promise<ResolvedAudioBoundaries> {
  const fallback = fallbackAudioBoundaries(times);
  const audioClip = boundaryAudioClip(clip);
  try {
    const mediaFileId = audioClip.source?.mediaFileId ?? audioClip.mediaFileId ?? audioClip.id;
    const buffer = await audioExtractor.extractAudio(audioClip.file, mediaFileId);
    return resolveSpeechSafeSplitTimesFromBuffer(clip, audioClip, times, buffer);
  } catch {
    // Decoding is best effort. The transcript boundary remains valid when the
    // source has no decodable audio or the browser cannot open an AudioContext.
    return fallback;
  }
}

export async function handleSplitClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const requestedClipId = args.clipId as string;
  const splitTime = args.splitTime as number;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const clip = resolveSplitClipTarget(timelineStore, requestedClipId, splitTime, args);
  const clipId = clip?.id ?? requestedClipId;

  if (!clip) {
    return { success: false, error: `Clip not found: ${requestedClipId}` };
  }

  const clipEnd = clip.startTime + clip.duration;
  if (splitTime <= clip.startTime || splitTime >= clipEnd) {
    return { success: false, error: `Split time ${splitTime}s is outside clip range (${clip.startTime}s - ${clipEnd}s)` };
  }

  const targetClipIds = [
    clip.id,
    withLinked ? clip.linkedClipId : undefined,
  ].filter((id): id is string => id !== undefined);
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  const splitResult = timelineStore.applyTimelineEditOperation({
    id: `ai-split-clip:${clipId}:${splitTime}`,
    type: 'split-at-time',
    clipIds: [clipId],
    time: splitTime,
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: split clip',
  });

  if (!splitResult.success) {
    return {
      success: false,
      error: splitResult.warnings.map((warning) => warning.message).join(' ') || 'Split clip operation failed',
    };
  }

  // Visual feedback: split glow at cut position
  if (isAIExecutionActive()) {
    const store = useTimelineStore.getState();
    store.addAIOverlay({ type: 'split-glow', trackId: clip.trackId, timePosition: splitTime, duration: 1000 });
    // Also show on linked audio track
    if (withLinked && clip.linkedClipId) {
      const linked = store.clips.find(c => c.linkedClipId === clip.linkedClipId || c.id === clip.linkedClipId);
      if (linked && linked.trackId !== clip.trackId) {
        store.addAIOverlay({ type: 'split-glow', trackId: linked.trackId, timePosition: splitTime, duration: 1000 });
      }
    }
  }

  return {
    success: true,
    data: {
      splitAt: splitTime,
      originalClipId: clipId,
      withLinked,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
        {
          updatedEntityIds: targetClipIds,
          // Source clips are transformed into parts, not semantically deleted by a split.
          excludedDeletedEntityIds: targetClipIds,
        },
      ),
    },
  };
}

function resolveSplitClipTarget(
  timelineStore: TimelineStore,
  clipId: string,
  splitTime: number,
  args: Record<string, unknown>,
): TimelineClip | undefined {
  const direct = timelineStore.clips.find(c => c.id === clipId);
  if (direct) return direct;

  const fallbackTrackId = typeof args.guidedResolveClipAtTimeTrackId === 'string'
    ? args.guidedResolveClipAtTimeTrackId
    : null;
  if (!fallbackTrackId || typeof splitTime !== 'number' || !Number.isFinite(splitTime)) {
    return undefined;
  }

  return timelineStore.clips.find((candidate) => (
    candidate.trackId === fallbackTrackId
    && splitTime > candidate.startTime
    && splitTime < candidate.startTime + candidate.duration
  ));
}

export async function handleSplitClipEvenly(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const parts = args.parts as number;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  if (parts < 2 || !Number.isInteger(parts)) {
    return { success: false, error: `Parts must be an integer >= 2, got: ${parts}` };
  }

  const clipStart = clip.startTime;
  const clipDuration = clip.duration;
  const clipName = clip.name;
  const partDuration = clipDuration / parts;

  // Calculate N-1 split times
  const splitTimes: number[] = [];
  for (let i = 1; i < parts; i++) {
    splitTimes.push(clipStart + partDuration * i);
  }

  const targetClipIds = [
    clip.id,
    withLinked ? clip.linkedClipId : undefined,
  ].filter((id): id is string => id !== undefined);
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  if (isAIExecutionActive()) {
    logSplitCheckpoint('split-evenly:start', clip, splitTimes.length, withLinked);
    const trackId = clip.trackId;
    // Bulk split: single state update for all cuts at once
    splitClipBatch(clip, splitTimes, withLinked);
    logSplitCheckpoint('split-evenly:after-batch', clip, splitTimes.length, withLinked);
    // Staggered overlays via CSS animation-delay (single state update, no JS timers)
    const totalAnimMs = Math.min(3000, splitTimes.length * 100);
    const delayStep = splitTimes.length <= 1 ? 0 : totalAnimMs / (splitTimes.length - 1);
    useTimelineStore.getState().addAIOverlaysBatch(
      splitTimes.map((t, i) => ({
        type: 'split-glow' as const, trackId, timePosition: t,
        duration: 1000, animationDelay: Math.round(i * delayStep),
      }))
    );
    logSplitCheckpoint('split-evenly:after-overlays', clip, splitTimes.length, withLinked);
  } else {
    splitClipBatch(clip, splitTimes, withLinked);
  }

  return {
    success: true,
    data: {
      parts,
      splitTimes,
      clipName,
      partDuration,
      withLinked,
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips,
        {
          updatedEntityIds: targetClipIds,
          excludedDeletedEntityIds: targetClipIds,
        },
      ),
    },
  };
}

export async function handleSplitClipAtTimes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const times = args.times as number[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  const clipStart = clip.startTime;
  const clipEnd = clip.startTime + clip.duration;

  // Sort and filter to valid times within clip range
  const validTimes = [...times]
    .sort((a, b) => a - b)
    .filter(t => t > clipStart + 0.001 && t < clipEnd - 0.001);

  if (validTimes.length === 0) {
    return { success: false, error: `No valid split times within clip range (${clipStart}s - ${clipEnd}s)` };
  }

  const boundaryResolution = args.snapToAudioZeroCrossing === true
    ? isExclusiveTimelineMutationLeaseActive()
      ? resolveSpeechSafeSplitTimesFromCache(clip, validTimes)
      : await resolveSpeechSafeSplitTimes(clip, validTimes)
    : {
        resolution: {
          appliedCount: 0,
          requested: false,
          adjustments: validTimes.map((time) => ({ delta: 0, requested: time, resolved: time })),
        },
        times: validTimes,
      };
  const resolvedTimes = boundaryResolution.times;

  const targetClipIds = [
    clip.id,
    withLinked ? clip.linkedClipId : undefined,
  ].filter((id): id is string => id !== undefined);
  const mutationSnapshot = captureMutationEntitySnapshot(
    'clip',
    useTimelineStore.getState().clips,
  );
  if (isAIExecutionActive()) {
    logSplitCheckpoint('split-at-times:start', clip, resolvedTimes.length, withLinked);
    const trackId = clip.trackId;
    // Bulk split: single state update for all cuts at once
    splitClipBatch(clip, resolvedTimes, withLinked);
    logSplitCheckpoint('split-at-times:after-batch', clip, resolvedTimes.length, withLinked);
    // Staggered overlays via CSS animation-delay (single state update, no JS timers)
    const totalAnimMs = Math.min(3000, resolvedTimes.length * 100);
    const delayStep = resolvedTimes.length <= 1 ? 0 : totalAnimMs / (resolvedTimes.length - 1);
    useTimelineStore.getState().addAIOverlaysBatch(
      resolvedTimes.map((t, i) => ({
        type: 'split-glow' as const, trackId, timePosition: t,
        duration: 1000, animationDelay: Math.round(i * delayStep),
      }))
    );
    logSplitCheckpoint('split-at-times:after-overlays', clip, resolvedTimes.length, withLinked);
  } else {
    splitClipBatch(clip, resolvedTimes, withLinked);
  }

  const clipsAfter = useTimelineStore.getState().clips;
  const videoSegments = clipsAfter
    .filter((candidate) => (
      candidate.trackId === clip.trackId
      && candidate.startTime >= clipStart - 0.001
      && candidate.startTime + candidate.duration <= clipEnd + 0.001
    ))
    .toSorted((a, b) => a.startTime - b.startTime);

  return {
    success: true,
    data: {
      splitCount: resolvedTimes.length,
      splitTimes: resolvedTimes,
      resultingParts: resolvedTimes.length + 1,
      withLinked,
      audioBoundaryResolution: boundaryResolution.resolution,
      // Runtime segment binding payload (agent-kernel plan section 6.2):
      // segment ids in timeline order so downstream steps never copy ID lists.
      segments: {
        videoClipIds: videoSegments.map((segment) => segment.id),
        audioClipIds: videoSegments
          .map((segment) => segment.linkedClipId)
          .filter((id): id is string => typeof id === 'string'),
      },
      ...describeMutationEntities(
        mutationSnapshot,
        clipsAfter,
        {
          updatedEntityIds: targetClipIds,
          excludedDeletedEntityIds: targetClipIds,
        },
      ),
    },
  };
}
