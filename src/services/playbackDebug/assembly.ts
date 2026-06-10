import type {
  PlaybackDebugBuildParams,
  PlaybackDebugStats,
  PlaybackPipeline,
} from '../playbackDebugStats';
import { summarizeVfTimeline, summarizeWcTimeline } from './collectors';
import { derivePlaybackStatus } from './status';

const DEFAULT_WINDOW_MS = 5000;

export function mapDecoderToPlaybackPipeline(
  decoder: PlaybackDebugBuildParams['decoder']
): PlaybackPipeline {
  if (decoder === 'WebCodecs') {
    return 'webcodecs';
  }
  if (decoder === 'HTMLVideo(VF)') {
    return 'vf';
  }
  if (decoder === 'NativeHelper') {
    return 'native';
  }
  if (decoder === 'ParallelDecode') {
    return 'parallel';
  }
  if (decoder.startsWith('HTMLVideo')) {
    return 'html';
  }
  return 'none';
}

export function buildPlaybackDebugStats(
  params: PlaybackDebugBuildParams
): PlaybackDebugStats {
  const now = params.now ?? performance.now();
  const windowMs = params.windowMs ?? DEFAULT_WINDOW_MS;
  const pipeline = mapDecoderToPlaybackPipeline(params.decoder);
  const healthVideos = params.healthVideos ?? [];
  const recentHealthAnomalies = (params.healthAnomalies ?? []).filter(
    (anomaly) => anomaly.timestamp >= now - windowMs
  );

  const wcSummary = summarizeWcTimeline(params.wcTimeline ?? []);
  const vfSummary = summarizeVfTimeline(params.vfTimeline ?? []);
  const activeVideos = healthVideos.length;
  const worstReadyState = activeVideos > 0
    ? Math.min(...healthVideos.map((video) => video.readyState))
    : 0;

  const base: Omit<PlaybackDebugStats, 'status'> = {
    windowMs,
    pipeline,
    frameEvents: 0,
    cadenceFps: 0,
    avgFrameGapMs: 0,
    p95FrameGapMs: 0,
    maxFrameGapMs: 0,
    previewFrames: 0,
    previewUpdates: 0,
    previewRenderFps: 0,
    previewUpdateFps: 0,
    avgPreviewRenderGapMs: 0,
    p95PreviewRenderGapMs: 0,
    maxPreviewRenderGapMs: 0,
    avgPreviewUpdateGapMs: 0,
    p95PreviewUpdateGapMs: 0,
    maxPreviewUpdateGapMs: 0,
    stalePreviewFrames: 0,
    stalePreviewWhileTargetMoved: 0,
    previewFreezeEvents: 0,
    previewFreezeFrames: 0,
    longestPreviewFreezeFrames: 0,
    longestPreviewFreezeMs: 0,
    avgPreviewDriftMs: 0,
    maxPreviewDriftMs: 0,
    stalls: 0,
    seeks: 0,
    advanceSeeks: 0,
    driftCorrections: 0,
    readyStateDrops: 0,
    queuePressureEvents: 0,
    healthAnomalies: recentHealthAnomalies.length,
    activeVideos,
    playingVideos: healthVideos.filter((video) => !video.paused).length,
    seekingVideos: healthVideos.filter((video) => video.seeking).length,
    warmingUpVideos: healthVideos.filter((video) => video.warmingUp).length,
    coldVideos: healthVideos.filter((video) => !video.gpuReady).length,
    worstReadyState,
    lastAnomalyType: recentHealthAnomalies.at(-1)?.type,
    previewPathCounts: {},
    scrubPathCounts: {},
  };

  const previewTelemetry = {
    previewFrames: vfSummary.previewFrames,
    previewUpdates: vfSummary.previewUpdates,
    previewRenderFps: vfSummary.previewRenderCadence.cadenceFps,
    previewUpdateFps: vfSummary.previewUpdateCadence.cadenceFps,
    avgPreviewRenderGapMs: vfSummary.previewRenderCadence.avgFrameGapMs,
    p95PreviewRenderGapMs: vfSummary.previewRenderCadence.p95FrameGapMs,
    maxPreviewRenderGapMs: vfSummary.previewRenderCadence.maxFrameGapMs,
    avgPreviewUpdateGapMs: vfSummary.previewUpdateCadence.avgFrameGapMs,
    p95PreviewUpdateGapMs: vfSummary.previewUpdateCadence.p95FrameGapMs,
    maxPreviewUpdateGapMs: vfSummary.previewUpdateCadence.maxFrameGapMs,
    stalePreviewFrames: vfSummary.stalePreviewFrames,
    stalePreviewWhileTargetMoved: vfSummary.stalePreviewWhileTargetMoved,
    previewFreezeEvents: vfSummary.previewFreezeEvents,
    previewFreezeFrames: vfSummary.previewFreezeFrames,
    longestPreviewFreezeFrames: vfSummary.longestPreviewFreezeFrames,
    longestPreviewFreezeMs: vfSummary.longestPreviewFreezeMs,
    avgPreviewDriftMs: vfSummary.avgPreviewDriftMs,
    maxPreviewDriftMs: vfSummary.maxPreviewDriftMs,
    avgAudioDriftMs: vfSummary.avgAudioDriftMs,
    lastPreviewFreezePath: vfSummary.lastPreviewFreezePath,
    lastPreviewFreezeClipId: vfSummary.lastPreviewFreezeClipId,
    lastPreviewFreezeDurationMs: vfSummary.lastPreviewFreezeDurationMs,
    previewPathCounts: vfSummary.previewPathCounts,
    scrubPathCounts: vfSummary.scrubPathCounts,
  };

  Object.assign(base, previewTelemetry);

  if (pipeline === 'webcodecs') {
    Object.assign(base, wcSummary.cadence, {
      stalls: wcSummary.stalls,
      seeks: wcSummary.seeks,
      advanceSeeks: wcSummary.advanceSeeks,
      driftCorrections: wcSummary.driftCorrections,
      queuePressureEvents: wcSummary.queuePressureEvents,
      avgDecodeLatencyMs: wcSummary.avgDecodeLatencyMs,
      avgSeekLatencyMs: wcSummary.avgSeekLatencyMs,
      avgQueueDepth: wcSummary.avgQueueDepth,
      maxQueueDepth: wcSummary.maxQueueDepth,
      decoderResets: wcSummary.decoderResets,
      pendingSeekResolves: wcSummary.pendingSeekResolves,
      avgPendingSeekMs: wcSummary.avgPendingSeekMs,
      maxPendingSeekMs: wcSummary.maxPendingSeekMs,
      collectorHolds: wcSummary.collectorHolds,
      collectorDrops: wcSummary.collectorDrops,
    });
  } else if (pipeline === 'vf' || pipeline === 'html') {
    Object.assign(base, vfSummary.cadence, {
      stalls: vfSummary.stalls,
      seeks: vfSummary.seeks,
      advanceSeeks: vfSummary.advanceSeeks,
      driftCorrections: vfSummary.driftCorrections,
      readyStateDrops: vfSummary.readyStateDrops,
      avgSeekLatencyMs: vfSummary.avgSeekLatencyMs,
    });
  }

  return {
    ...base,
    status: derivePlaybackStatus(base),
  };
}
