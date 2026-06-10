import type { PipelineEvent } from '../wcPipelineMonitor';
import type { VFPipelineEvent } from '../vfPipelineMonitor';
import {
  average,
  getNumericDetail,
  incrementCount,
  max,
  percentile,
  round,
} from './math';

export interface FrameCadenceSummary {
  frameEvents: number;
  cadenceFps: number;
  avgFrameGapMs: number;
  p95FrameGapMs: number;
  maxFrameGapMs: number;
}

export interface WcTimelineSummary {
  cadence: FrameCadenceSummary;
  stalls: number;
  seeks: number;
  advanceSeeks: number;
  driftCorrections: number;
  queuePressureEvents: number;
  avgDecodeLatencyMs: number;
  avgSeekLatencyMs: number;
  avgQueueDepth: number;
  maxQueueDepth: number;
  decoderResets: number;
  pendingSeekResolves: number;
  avgPendingSeekMs: number;
  maxPendingSeekMs: number;
  collectorHolds: number;
  collectorDrops: number;
}

export interface VfTimelineSummary {
  cadence: FrameCadenceSummary;
  previewRenderCadence: FrameCadenceSummary;
  previewUpdateCadence: FrameCadenceSummary;
  previewFrames: number;
  previewUpdates: number;
  stalePreviewFrames: number;
  stalePreviewWhileTargetMoved: number;
  previewFreezeEvents: number;
  previewFreezeFrames: number;
  longestPreviewFreezeFrames: number;
  longestPreviewFreezeMs: number;
  lastPreviewFreezePath?: string;
  lastPreviewFreezeClipId?: string;
  lastPreviewFreezeDurationMs?: number;
  previewPathCounts: Record<string, number>;
  scrubPathCounts: Record<string, number>;
  avgPreviewDriftMs: number;
  maxPreviewDriftMs: number;
  stalls: number;
  seeks: number;
  advanceSeeks: number;
  driftCorrections: number;
  readyStateDrops: number;
  avgSeekLatencyMs: number;
  avgAudioDriftMs: number;
}

export function summarizeFrameCadence(timestamps: number[]): FrameCadenceSummary {
  if (timestamps.length === 0) {
    return {
      frameEvents: 0,
      cadenceFps: 0,
      avgFrameGapMs: 0,
      p95FrameGapMs: 0,
      maxFrameGapMs: 0,
    };
  }

  const gaps: number[] = [];
  for (let index = 1; index < timestamps.length; index++) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > 0) {
      gaps.push(gap);
    }
  }

  const avgFrameGapMs = average(gaps);

  return {
    frameEvents: timestamps.length,
    cadenceFps: avgFrameGapMs > 0 ? round(1000 / avgFrameGapMs, 1) : 0,
    avgFrameGapMs: round(avgFrameGapMs, 1),
    p95FrameGapMs: round(percentile(gaps, 0.95), 1),
    maxFrameGapMs: round(max(gaps), 1),
  };
}

export function summarizeWcTimeline(events: PipelineEvent[]): WcTimelineSummary {
  const frameTimes = events
    .filter((event) => event.type === 'decode_output')
    .map((event) => event.t);

  const decodeLatencies: number[] = [];
  const seekDurations: number[] = [];
  const pendingSeekDurations: number[] = [];
  const queueDepths: number[] = [];
  let lastFeedTime: number | null = null;
  let decoderResets = 0;
  let pendingSeekResolves = 0;
  let collectorHolds = 0;
  let collectorDrops = 0;

  for (const event of events) {
    if (event.type === 'decode_feed') {
      lastFeedTime = event.t;
      continue;
    }

    if (event.type === 'decode_output') {
      if (lastFeedTime !== null) {
        decodeLatencies.push(event.t - lastFeedTime);
      }
      const queueSize = getNumericDetail(event.detail, 'queueSize');
      if (queueSize !== undefined) {
        queueDepths.push(queueSize);
      }
      continue;
    }

    if (event.type === 'queue_pressure') {
      const queueSize = getNumericDetail(event.detail, 'queueSize');
      if (queueSize !== undefined) {
        queueDepths.push(queueSize);
      }
      continue;
    }

    if (event.type === 'seek_end') {
      const durationMs = getNumericDetail(event.detail, 'durationMs');
      if (durationMs !== undefined) {
        seekDurations.push(durationMs);
      }
      continue;
    }

    if (event.type === 'pending_seek_end') {
      pendingSeekResolves++;
      const durationMs = getNumericDetail(event.detail, 'durationMs');
      if (durationMs !== undefined) {
        pendingSeekDurations.push(durationMs);
      }
      continue;
    }

    if (event.type === 'decoder_reset') {
      decoderResets++;
      continue;
    }

    if (event.type === 'collector_hold') {
      collectorHolds++;
      continue;
    }

    if (event.type === 'collector_drop') {
      collectorDrops++;
    }
  }

  return {
    cadence: summarizeFrameCadence(frameTimes),
    stalls: events.filter((event) => event.type === 'stall').length,
    seeks: events.filter(
      (event) => event.type === 'seek_start' || event.type === 'advance_seek'
    ).length,
    advanceSeeks: events.filter((event) => event.type === 'advance_seek').length,
    driftCorrections: events.filter((event) => event.type === 'drift_correct').length,
    queuePressureEvents: events.filter((event) => event.type === 'queue_pressure').length,
    avgDecodeLatencyMs: round(average(decodeLatencies), 1),
    avgSeekLatencyMs: round(average(seekDurations), 1),
    avgQueueDepth: round(average(queueDepths), 1),
    maxQueueDepth: round(max(queueDepths), 1),
    decoderResets,
    pendingSeekResolves,
    avgPendingSeekMs: round(average(pendingSeekDurations), 1),
    maxPendingSeekMs: round(max(pendingSeekDurations), 1),
    collectorHolds,
    collectorDrops,
  };
}

export function summarizeVfTimeline(events: VFPipelineEvent[]): VfTimelineSummary {
  const frameTimes = events
    .filter((event) => event.type === 'vf_capture')
    .map((event) => event.t);
  const previewEvents = events.filter((event) => event.type === 'vf_preview_frame');
  const previewRenderTimes = previewEvents.map((event) => event.t);
  const previewUpdateTimes = previewEvents
    .filter((event) => event.detail?.changed === 'true')
    .map((event) => event.t);

  const seekDurations: number[] = [];
  const audioDrifts: number[] = [];
  const previewDrifts: number[] = [];
  const previewPathCounts: Record<string, number> = {};
  const scrubPathCounts: Record<string, number> = {};
  let stalePreviewFrames = 0;
  let stalePreviewWhileTargetMoved = 0;
  let previewFreezeEvents = 0;
  let previewFreezeFrames = 0;
  let longestPreviewFreezeFrames = 0;
  let longestPreviewFreezeMs = 0;
  let lastPreviewFreezePath: string | undefined;
  let lastPreviewFreezeClipId: string | undefined;
  let lastPreviewFreezeDurationMs: number | undefined;
  let lastSeekStartTime: number | null = null;
  let activeFreeze:
    | {
      start: number;
      end: number;
      frames: number;
      previewPath?: string;
      clipId?: string;
    }
    | null = null;

  const finalizeFreeze = () => {
    if (!activeFreeze) {
      return;
    }
    if (activeFreeze.frames >= 2) {
      const durationMs = Math.max(0, activeFreeze.end - activeFreeze.start);
      previewFreezeEvents++;
      previewFreezeFrames += activeFreeze.frames;
      if (activeFreeze.frames > longestPreviewFreezeFrames) {
        longestPreviewFreezeFrames = activeFreeze.frames;
      }
      if (durationMs > longestPreviewFreezeMs) {
        longestPreviewFreezeMs = durationMs;
      }
      lastPreviewFreezePath = activeFreeze.previewPath;
      lastPreviewFreezeClipId = activeFreeze.clipId;
      lastPreviewFreezeDurationMs = durationMs;
    }
    activeFreeze = null;
  };

  for (const event of events) {
    if (event.type === 'vf_seek_fast' || event.type === 'vf_seek_precise') {
      lastSeekStartTime = event.t;
      continue;
    }

    if (event.type === 'vf_seek_done') {
      if (lastSeekStartTime !== null) {
        seekDurations.push(event.t - lastSeekStartTime);
        lastSeekStartTime = null;
      }
      continue;
    }

    if (event.type === 'audio_drift') {
      const driftMs = getNumericDetail(event.detail, 'driftMs');
      if (driftMs !== undefined) {
        audioDrifts.push(Math.abs(driftMs));
      }
      continue;
    }

    if (event.type === 'vf_preview_frame') {
      const previewPath =
        typeof event.detail?.previewPath === 'string'
          ? event.detail.previewPath
          : 'unknown';
      incrementCount(previewPathCounts, previewPath);
      if (event.detail?.changed !== 'true') {
        stalePreviewFrames++;
        if (event.detail?.targetMoved === 'true') {
          stalePreviewWhileTargetMoved++;
        }
      }
      const driftMs = getNumericDetail(event.detail, 'driftMs');
      if (driftMs !== undefined) {
        previewDrifts.push(Math.abs(driftMs));
      }
      const isFreezeFrame =
        event.detail?.changed !== 'true' &&
        event.detail?.targetMoved === 'true';
      if (isFreezeFrame) {
        const clipId =
          typeof event.detail?.clipId === 'string'
            ? event.detail.clipId
            : undefined;
        if (
          activeFreeze &&
          activeFreeze.previewPath === previewPath &&
          activeFreeze.clipId === clipId
        ) {
          activeFreeze.frames++;
          activeFreeze.end = event.t;
        } else {
          finalizeFreeze();
          activeFreeze = {
            start: event.t,
            end: event.t,
            frames: 1,
            previewPath,
            clipId,
          };
        }
      } else {
        finalizeFreeze();
      }
      continue;
    }

    if (event.type === 'vf_scrub_path') {
      const scrubPath =
        typeof event.detail?.path === 'string'
          ? event.detail.path
          : 'unknown';
      incrementCount(scrubPathCounts, scrubPath);
    }
  }

  finalizeFreeze();

  return {
    cadence: summarizeFrameCadence(frameTimes),
    previewRenderCadence: summarizeFrameCadence(previewRenderTimes),
    previewUpdateCadence: summarizeFrameCadence(previewUpdateTimes),
    previewFrames: previewEvents.length,
    previewUpdates: previewUpdateTimes.length,
    stalePreviewFrames,
    stalePreviewWhileTargetMoved,
    previewFreezeEvents,
    previewFreezeFrames,
    longestPreviewFreezeFrames,
    longestPreviewFreezeMs: round(longestPreviewFreezeMs, 1),
    lastPreviewFreezePath,
    lastPreviewFreezeClipId,
    lastPreviewFreezeDurationMs:
      typeof lastPreviewFreezeDurationMs === 'number'
        ? round(lastPreviewFreezeDurationMs, 1)
        : undefined,
    previewPathCounts,
    scrubPathCounts,
    avgPreviewDriftMs: round(average(previewDrifts), 1),
    maxPreviewDriftMs: round(max(previewDrifts), 1),
    stalls: events.filter((event) => event.type === 'vf_stall').length,
    seeks: events.filter(
      (event) => event.type === 'vf_seek_fast' || event.type === 'vf_seek_precise'
    ).length,
    advanceSeeks: 0,
    driftCorrections: events.filter((event) => event.type === 'vf_drift').length,
    readyStateDrops: events.filter((event) => event.type === 'vf_readystate_drop').length,
    avgSeekLatencyMs: round(average(seekDurations), 1),
    avgAudioDriftMs: round(average(audioDrifts), 1),
  };
}
