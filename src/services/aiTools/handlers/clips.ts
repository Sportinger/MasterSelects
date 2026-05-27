// Clip Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TimelineClip } from '../../../types';
import type { ToolResult } from '../types';
import { formatClipInfo } from '../utils';
import { isAIExecutionActive } from '../executionState';
import { activateDockPanel } from '../aiFeedback';
import { Logger } from '../../../services/logger';
import { getGaussianSplatGpuRenderer } from '../../../engine/gaussian/core/GaussianSplatGpuRenderer';
import { resolveSharedSplatSceneKey } from '../../../engine/scene/runtime/SharedSplatRuntimeUtils';
import { ensureRenderForDiagnostics } from './renderOnce';

const log = Logger.create('AITool:Clips');

/** Resolve clip background color for ghost overlays */
function getClipColor(clip: TimelineClip): string {
  if (clip.source?.type === 'audio') return '#2d6b4a';
  if (clip.source?.type === 'text') return '#5c3d7a';
  if (clip.source?.type === 'solid' && clip.solidColor) return clip.solidColor;
  return '#3d5a80';
}

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

function getHeapSnapshot():
  | {
      heapUsedMB: number;
      heapTotalMB: number;
      heapLimitMB: number;
    }
  | undefined {
  const perf = performance as Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  };
  const memory = perf.memory;
  if (!memory) return undefined;

  return {
    heapUsedMB: Math.round(memory.usedJSHeapSize / (1024 * 1024)),
    heapTotalMB: Math.round(memory.totalJSHeapSize / (1024 * 1024)),
    heapLimitMB: Math.round(memory.jsHeapSizeLimit / (1024 * 1024)),
  };
}

function logSplitCheckpoint(
  stage: string,
  clip: TimelineClip,
  splitCount: number,
  withLinked: boolean
): void {
  const state = useTimelineStore.getState();
  log.warn(`[split-checkpoint:${stage}] ${clip.id}`, {
    clipId: clip.id,
    clipName: clip.name,
    splitCount,
    withLinked,
    aiExecutionActive: isAIExecutionActive(),
    totalClips: state.clips.length,
    totalTracks: state.tracks.length,
    selectedClipIds: state.selectedClipIds.size,
    ...getHeapSnapshot(),
  });
}

/**
 * Bulk split via the shared timeline operation kernel.
 * The kernel owns clip cloning, linked-audio handling, export lock, and history.
 */
function splitClipBatch(clip: TimelineClip, splitTimes: number[], withLinked = true): void {
  const result = useTimelineStore.getState().applyTimelineEditOperation({
    id: `ai-split-at-times:${clip.id}:${splitTimes.join(',')}`,
    type: 'split-at-times',
    clipId: clip.id,
    times: splitTimes,
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: split clip at times',
  });
  if (!result.success) {
    throw new Error(result.warnings.map((warning) => warning.message).join(' ') || 'Split operation failed');
  }
}

export async function handleGetClipDetails(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  const track = timelineStore.tracks.find(t => t.id === clip.trackId);
  const gaussianRenderer = clip.source?.type === 'gaussian-splat'
    ? getGaussianSplatGpuRenderer()
    : null;
  const gaussianSceneKey = clip.source?.type === 'gaussian-splat'
    ? resolveSharedSplatSceneKey({
        clipId: clip.id,
        runtimeKey: clip.source.gaussianSplatRuntimeKey,
      })
    : null;
  const renderDiagnostics = gaussianRenderer
    ? await ensureRenderForDiagnostics()
    : undefined;
  const gaussianSceneLoaded = gaussianSceneKey
    ? gaussianRenderer?.hasScene(gaussianSceneKey)
    : undefined;
  const gaussianRenderDebug = gaussianSceneKey
    ? gaussianRenderer?.getLastRenderDebug(gaussianSceneKey) ?? undefined
    : undefined;
  const gaussianTargetSummary = args.includeGaussianTargetSummary === true && gaussianRenderer && gaussianSceneKey
    ? await gaussianRenderer.readLastRenderTargetSummary(gaussianSceneKey)
    : undefined;

  return {
    success: true,
    data: {
      ...formatClipInfo(clip, track),
      source: clip.source
        ? {
            type: clip.source.type,
            mediaFileId: clip.source.mediaFileId,
            gaussianSplatUrl: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatUrl : undefined,
            gaussianSplatRuntimeKey: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatRuntimeKey : undefined,
            gaussianSplatSettings: clip.source.type === 'gaussian-splat' ? clip.source.gaussianSplatSettings : undefined,
          }
        : null,
      isLoading: clip.isLoading ?? false,
      hasFile: clip.file instanceof File,
      waveform: {
        generating: clip.waveformGenerating === true,
        progress: clip.waveformProgress ?? null,
        sampleCount: clip.waveform?.length ?? 0,
        channelCount: clip.waveformChannels?.length ?? null,
        hasSourcePyramid: Boolean(clip.audioState?.sourceAnalysisRefs?.waveformPyramidId),
        hasProcessedPyramid: Boolean(clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId),
        audioAnalysisJob: clip.audioAnalysisJob ?? null,
      },
      gaussianSceneKey,
      gaussianSceneLoaded,
      renderDiagnostics,
      gaussianRenderDebug,
      gaussianTargetSummary,
      effects: clip.effects || [],
      masks: clip.masks || [],
      transcript: clip.transcript,
      analysisStatus: clip.analysisStatus,
    },
  };
}

export async function handleGetClipsInTimeRange(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const startTime = args.startTime as number;
  const endTime = args.endTime as number;
  const trackType = (args.trackType as string) || 'all';

  const { clips, tracks } = timelineStore;

  const filteredClips = clips.filter(clip => {
    const clipEnd = clip.startTime + clip.duration;
    const overlaps = clip.startTime < endTime && clipEnd > startTime;
    if (!overlaps) return false;

    if (trackType === 'all') return true;
    const track = tracks.find(t => t.id === clip.trackId);
    return track?.type === trackType;
  });

  return {
    success: true,
    data: {
      clips: filteredClips.map(c => {
        const track = tracks.find(t => t.id === c.trackId);
        return formatClipInfo(c, track);
      }),
      count: filteredClips.length,
    },
  };
}

export async function handleSplitClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const splitTime = args.splitTime as number;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
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

export async function handleDeleteClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Visual feedback: delete ghost before removing
  if (isAIExecutionActive()) {
    const store = useTimelineStore.getState();
    store.addAIOverlay({
      type: 'delete-ghost', trackId: clip.trackId,
      timePosition: clip.startTime, width: clip.duration,
      clipName: clip.name, clipColor: getClipColor(clip), duration: 350,
    });
    if (withLinked && clip.linkedClipId) {
      const linked = timelineStore.clips.find(c => c.id === clip.linkedClipId);
      if (linked) {
        store.addAIOverlay({
          type: 'delete-ghost', trackId: linked.trackId,
          timePosition: linked.startTime, width: linked.duration,
          clipName: linked.name, clipColor: getClipColor(linked), duration: 350,
        });
      }
    }
  }

  const deleteResult = timelineStore.applyTimelineEditOperation({
    id: `ai-delete-clip:${clipId}`,
    type: 'delete-clips',
    clipIds: [clipId],
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: delete clip',
  });
  if (!deleteResult.success) {
    return {
      success: false,
      error: deleteResult.warnings.map((warning) => warning.message).join(' ') || 'Delete clip operation failed',
    };
  }

  return { success: true, data: { deletedClipId: clipId, clipName: clip.name, withLinked } };
}

export async function handleDeleteClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;
  const currentClips = useTimelineStore.getState().clips;
  const deleted = clipIds.filter((clipId) => currentClips.some((clip) => clip.id === clipId));
  const notFound = clipIds.filter((clipId) => !currentClips.some((clip) => clip.id === clipId));

  if (deleted.length === 0) {
    return {
      success: true,
      data: { deleted, notFound, deletedCount: 0, withLinked },
    };
  }

  for (const clipId of deleted) {
    const clip = currentClips.find(c => c.id === clipId);
    if (clip) {
      // Visual feedback: delete ghost
      if (isAIExecutionActive()) {
        useTimelineStore.getState().addAIOverlay({
          type: 'delete-ghost', trackId: clip.trackId,
          timePosition: clip.startTime, width: clip.duration,
          clipName: clip.name, clipColor: getClipColor(clip), duration: 350,
        });
      }
    }
  }

  const deleteResult = timelineStore.applyTimelineEditOperation({
    id: `ai-delete-clips:${clipIds.join(',')}`,
    type: 'delete-clips',
    clipIds,
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: delete clips',
  });
  if (!deleteResult.success) {
    return {
      success: false,
      error: deleteResult.warnings.map((warning) => warning.message).join(' ') || 'Delete clips operation failed',
    };
  }

  return {
    success: true,
    data: { deleted, notFound, deletedCount: deleted.length, withLinked },
  };
}

export async function handleCutRangesFromClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const ranges = args.ranges as Array<{ timelineStart: number; timelineEnd: number }>;

  // Get initial clip info
  const initialClip = timelineStore.clips.find(c => c.id === clipId);
  if (!initialClip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  const trackId = initialClip.trackId;
  const results: Array<{ range: { start: number; end: number }; status: string }> = [];

  // Sort ranges from END to START (so we don't shift positions)
  const sortedRanges = [...ranges].sort((a, b) => b.timelineStart - a.timelineStart);

  for (const range of sortedRanges) {
    const { timelineStart, timelineEnd } = range;

    // Find the clip that currently contains this range
    // (clip IDs change after splits, so we need to find by position)
    const currentClips = useTimelineStore.getState().clips;
    const targetClip = currentClips.find(c =>
      c.trackId === trackId &&
      c.startTime <= timelineStart &&
      c.startTime + c.duration >= timelineEnd
    );

    if (!targetClip) {
      results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'skipped - no clip at this position' });
      continue;
    }

    const clipEnd = targetClip.startTime + targetClip.duration;

    try {
      // Split at the end of the range (if not at clip boundary)
      if (timelineEnd < clipEnd - 0.01) {
        const splitEndResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-split-end:${targetClip.id}:${timelineEnd}`,
          type: 'split-at-time',
          clipIds: [targetClip.id],
          time: timelineEnd,
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range split end',
        });
        if (!splitEndResult.success) {
          results.push({
            range: { start: timelineStart, end: timelineEnd },
            status: `error - ${splitEndResult.warnings.map((warning) => warning.message).join(' ')}`,
          });
          continue;
        }
      }

      // Find the clip again (it may have changed after the split)
      const clipsAfterEndSplit = useTimelineStore.getState().clips;
      const clipForStartSplit = clipsAfterEndSplit.find(c =>
        c.trackId === trackId &&
        c.startTime <= timelineStart &&
        c.startTime + c.duration >= timelineStart + 0.01
      );

      if (!clipForStartSplit) {
        results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'error - lost clip after end split' });
        continue;
      }

      // Split at the start of the range (if not at clip boundary)
      if (timelineStart > clipForStartSplit.startTime + 0.01) {
        const splitStartResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-split-start:${clipForStartSplit.id}:${timelineStart}`,
          type: 'split-at-time',
          clipIds: [clipForStartSplit.id],
          time: timelineStart,
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range split start',
        });
        if (!splitStartResult.success) {
          results.push({
            range: { start: timelineStart, end: timelineEnd },
            status: `error - ${splitStartResult.warnings.map((warning) => warning.message).join(' ')}`,
          });
          continue;
        }
      }

      // Find and delete the middle clip (the unwanted section)
      const clipsAfterSplits = useTimelineStore.getState().clips;
      const clipToDelete = clipsAfterSplits.find(c =>
        c.trackId === trackId &&
        Math.abs(c.startTime - timelineStart) < 0.1
      );

      if (clipToDelete) {
        const deleteResult = timelineStore.applyTimelineEditOperation({
          id: `ai-cut-range-delete:${clipToDelete.id}`,
          type: 'delete-clips',
          clipIds: [clipToDelete.id],
          includeLinked: true,
        }, {
          source: 'ai-tool',
          historyLabel: 'AI: cut range delete',
        });
        results.push({
          range: { start: timelineStart, end: timelineEnd },
          status: deleteResult.success
            ? 'removed'
            : `error - ${deleteResult.warnings.map((warning) => warning.message).join(' ')}`,
        });
      } else {
        results.push({ range: { start: timelineStart, end: timelineEnd }, status: 'error - could not find section to delete' });
      }
    } catch (err) {
      results.push({ range: { start: timelineStart, end: timelineEnd }, status: `error: ${err}` });
    }
  }

  const removedCount = results.filter(r => r.status === 'removed').length;
  return {
    success: true,
    data: {
      originalClipId: clipId,
      rangesProcessed: ranges.length,
      rangesRemoved: removedCount,
      results,
    },
  };
}

export async function handleMoveClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const newStartTime = (args.newStartTime ?? args.startTime) as number;
  const newTrackId = (args.newTrackId ?? args.trackId) as string | undefined;
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  if (newStartTime == null || isNaN(newStartTime)) {
    return { success: false, error: 'newStartTime is required and must be a valid number' };
  }

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (newTrackId) {
    const track = timelineStore.tracks.find(t => t.id === newTrackId);
    if (!track) {
      return { success: false, error: `Track not found: ${newTrackId}` };
    }
  }

  // Visual feedback: animate move from old to new position
  const oldStartTime = clip.startTime;
  if (isAIExecutionActive() && Math.abs(oldStartTime - newStartTime) > 0.01) {
    const store = useTimelineStore.getState();
    store.setAIMovingClip(clipId, oldStartTime, 200);
    // Also animate linked clip
    if (withLinked && clip.linkedClipId) {
      store.setAIMovingClip(clip.linkedClipId, oldStartTime, 200);
    }
  }

  const moveResult = timelineStore.applyTimelineEditOperation({
    id: `ai-move-clip:${clipId}:${newStartTime}:${newTrackId ?? clip.trackId}`,
    type: 'move-clips',
    moves: [{ clipId, startTime: newStartTime, trackId: newTrackId }],
    includeLinked: withLinked,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: move clip',
  });

  if (!moveResult.success) {
    return {
      success: false,
      error: moveResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  return {
    success: true,
    data: {
      clipId,
      newStartTime,
      newTrackId: newTrackId || clip.trackId,
      withLinked,
    },
  };
}

export async function handleTrimClip(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const inPoint = args.inPoint as number;
  const outPoint = args.outPoint as number;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (inPoint >= outPoint) {
    return { success: false, error: 'In point must be less than out point' };
  }

  const oldInPoint = clip.inPoint;
  const oldOutPoint = clip.outPoint;
  const trimResult = timelineStore.applyTimelineEditOperation({
    id: `ai-trim-clip:${clipId}:${inPoint}:${outPoint}`,
    type: 'trim-clip',
    clipId,
    inPoint,
    outPoint,
    includeLinked: true,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: trim clip',
  });

  if (!trimResult.success) {
    return {
      success: false,
      error: trimResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  // Visual feedback: trim highlight at the changed edge
  if (isAIExecutionActive()) {
    const store = useTimelineStore.getState();
    const trimmedClip = store.clips.find(c => c.id === clipId);
    if (trimmedClip) {
      // Show highlight at left edge if inPoint changed, right edge if outPoint changed
      if (Math.abs(inPoint - oldInPoint) > 0.01) {
        store.addAIOverlay({ type: 'trim-highlight', trackId: trimmedClip.trackId, timePosition: trimmedClip.startTime, duration: 400 });
      }
      if (Math.abs(outPoint - oldOutPoint) > 0.01) {
        store.addAIOverlay({ type: 'trim-highlight', trackId: trimmedClip.trackId, timePosition: trimmedClip.startTime + trimmedClip.duration, duration: 400 });
      }
    }
  }

  return { success: true, data: { clipId, inPoint, outPoint, newDuration: outPoint - inPoint } };
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

export async function handleReorderClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  const withLinked = (args.withLinked as boolean | undefined) ?? true;

  if (!clipIds || clipIds.length < 2) {
    return { success: false, error: 'Need at least 2 clip IDs to reorder' };
  }

  // Get fresh state
  const state = useTimelineStore.getState();
  const allClips = state.clips;

  // Resolve all clips and validate
  const orderedClips = clipIds.map(id => allClips.find(c => c.id === id));
  const missing = clipIds.filter((_id, i) => !orderedClips[i]);
  if (missing.length > 0) {
    return { success: false, error: `Clips not found: ${missing.join(', ')}` };
  }

  // Find the earliest startTime among the clips to reorder
  const startPosition = Math.min(...orderedClips.map(c => c!.startTime));

  // Build a map of new positions: clipId -> newStartTime
  const newPositions = new Map<string, number>();
  let currentTime = startPosition;

  for (const clip of orderedClips) {
    newPositions.set(clip!.id, currentTime);
    currentTime += clip!.duration;
  }

  // Also move linked audio clips (same delta as their video clip)
  if (withLinked) {
    for (const clip of orderedClips) {
      if (clip!.linkedClipId) {
        const linkedClip = allClips.find(c => c.id === clip!.linkedClipId);
        if (linkedClip && !newPositions.has(linkedClip.id)) {
          const delta = newPositions.get(clip!.id)! - clip!.startTime;
          newPositions.set(linkedClip.id, linkedClip.startTime + delta);
        }
      }
    }
  }

  // Reorder as one kernel operation so linked behavior, export lock, and history stay consistent.
  if (isAIExecutionActive()) {
    const moves: { clipId: string; linkedId?: string }[] = [];
    for (const clip of orderedClips) {
      const newStart = newPositions.get(clip!.id)!;
      if (Math.abs(clip!.startTime - newStart) > 0.01) {
        const linkedId = withLinked && clip!.linkedClipId ? clip!.linkedClipId : undefined;
        moves.push({ clipId: clip!.id, linkedId });
      }
    }

    for (const { clipId, linkedId } of moves) {
      const store = useTimelineStore.getState();
      const currentClip = store.clips.find(c => c.id === clipId);
      if (currentClip) {
        store.setAIMovingClip(clipId, currentClip.startTime, 200);
      }
      if (linkedId) {
        const linkedClip = store.clips.find(c => c.id === linkedId);
        if (linkedClip) {
          store.setAIMovingClip(linkedId, linkedClip.startTime, 200);
        }
      }
    }
  }

  const reorderResult = timelineStore.applyTimelineEditOperation({
    id: `ai-reorder-clips:${clipIds.join(',')}`,
    type: 'move-clips',
    moves: [...newPositions].map(([clipId, startTime]) => ({ clipId, startTime })),
    includeLinked: false,
  }, {
    source: 'ai-tool',
    historyLabel: 'AI: reorder clips',
  });

  if (!reorderResult.success) {
    return {
      success: false,
      error: reorderResult.warnings.map((warning) => warning.message).join(' '),
    };
  }

  return {
    success: true,
    data: {
      reorderedCount: clipIds.length,
      withLinked,
      newOrder: clipIds.map((id, i) => ({
        clipId: id,
        newStartTime: newPositions.get(id),
        position: i + 1,
      })),
    },
  };
}

export async function handleSelectClips(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipIds = args.clipIds as string[];
  timelineStore.selectClips(clipIds);

  // Visual feedback: activate properties panel
  activateDockPanel('clip-properties');

  return { success: true, data: { selectedClipIds: clipIds } };
}

export async function handleClearSelection(
  _args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  timelineStore.clearClipSelection();
  return { success: true, data: { message: 'Selection cleared' } };
}

/**
 * Add a clip segment from the media pool with specific in/out points.
 * Self-contained handler — fetches both stores internally.
 */
export async function handleAddClipSegment(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const mediaFileId = args.mediaFileId as string;
  const trackId = args.trackId as string;
  const startTime = args.startTime as number;
  const inPoint = args.inPoint as number;
  const outPoint = args.outPoint as number;

  if (inPoint >= outPoint) {
    return { success: false, error: 'inPoint must be less than outPoint' };
  }
  if (isNaN(startTime) || isNaN(inPoint) || isNaN(outPoint)) {
    return { success: false, error: 'startTime, inPoint, and outPoint must be valid numbers' };
  }

  const mediaStore = useMediaStore.getState();
  const timelineStore = useTimelineStore.getState();

  // Find media file
  const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
  if (!mediaFile) {
    return { success: false, error: `Media file not found: ${mediaFileId}` };
  }
  if (!mediaFile.file) {
    return { success: false, error: `File object not available for media: ${mediaFileId}. Try re-importing the file.` };
  }

  // Validate track
  const track = timelineStore.tracks.find(t => t.id === trackId);
  if (!track) {
    return { success: false, error: `Track not found: ${trackId}` };
  }

  const duration = outPoint - inPoint;

  // Snapshot clip count before adding
  const clipsBefore = new Set(timelineStore.clips.map(c => c.id));

  // Add the clip (this creates video + linked audio for video files)
  await timelineStore.addClip(trackId, mediaFile.file, startTime, duration, mediaFileId);

  // Find newly created clips
  const clipsAfter = useTimelineStore.getState().clips;
  const newClips = clipsAfter.filter(c => !clipsBefore.has(c.id));

  if (newClips.length === 0) {
    return { success: false, error: 'Failed to create clip' };
  }

  // Trim all new clips (video + linked audio) to the desired segment
  const ts = useTimelineStore.getState();
  for (const clip of newClips) {
    ts.trimClip(clip.id, inPoint, outPoint);
  }

  // Return info about created clips
  const createdClips = useTimelineStore.getState().clips.filter(c => newClips.some(n => n.id === c.id));
  return {
    success: true,
    data: {
      clipCount: createdClips.length,
      clips: createdClips.map(c => ({
        id: c.id,
        trackId: c.trackId,
        startTime: c.startTime,
        duration: c.duration,
        inPoint: c.inPoint,
        outPoint: c.outPoint,
        linkedClipId: c.linkedClipId,
      })),
    },
  };
}
