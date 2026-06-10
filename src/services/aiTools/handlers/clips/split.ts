import { useTimelineStore } from '../../../../stores/timeline';
import type { TimelineClip } from '../../../../types/timeline';
import type { ToolResult } from '../../types.ts';
import { isAIExecutionActive } from '../../executionState';
import type { TimelineStore } from './runtime';
import { logSplitCheckpoint, splitClipBatch } from './runtime';

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

  return { success: true, data: { splitAt: splitTime, originalClipId: clipId, withLinked } };
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
    data: { parts, splitTimes, clipName, partDuration, withLinked },
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

  if (isAIExecutionActive()) {
    logSplitCheckpoint('split-at-times:start', clip, validTimes.length, withLinked);
    const trackId = clip.trackId;
    // Bulk split: single state update for all cuts at once
    splitClipBatch(clip, validTimes, withLinked);
    logSplitCheckpoint('split-at-times:after-batch', clip, validTimes.length, withLinked);
    // Staggered overlays via CSS animation-delay (single state update, no JS timers)
    const totalAnimMs = Math.min(3000, validTimes.length * 100);
    const delayStep = validTimes.length <= 1 ? 0 : totalAnimMs / (validTimes.length - 1);
    useTimelineStore.getState().addAIOverlaysBatch(
      validTimes.map((t, i) => ({
        type: 'split-glow' as const, trackId, timePosition: t,
        duration: 1000, animationDelay: Math.round(i * delayStep),
      }))
    );
    logSplitCheckpoint('split-at-times:after-overlays', clip, validTimes.length, withLinked);
  } else {
    splitClipBatch(clip, validTimes, withLinked);
  }

  return {
    success: true,
    data: { splitCount: validTimes.length, splitTimes: validTimes, resultingParts: validTimes.length + 1, withLinked },
  };
}
