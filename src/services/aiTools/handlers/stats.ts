import { useEngineStore } from '../../../stores/engineStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { Logger } from '../../logger';
import { redactSecrets, redactObject } from '../../security/redact';
import {
  buildPlaybackDebugStats,
  summarizeWorkerGpuOnlyPlaybackPaths,
  type PlaybackDebugStats,
} from '../../playbackDebugStats';
import { playbackHealthMonitor } from '../../playbackHealthMonitor';
import { vfPipelineMonitor } from '../../vfPipelineMonitor';
import { wcPipelineMonitor } from '../../wcPipelineMonitor';
import { slotDeckManager } from '../../slotDeckManager';
import { exportDiagnostics } from '../../export/exportDiagnostics';
import {
  clearRuntimeDiagnostics,
  getRuntimeDiagnostics,
} from '../../runtimeDiagnostics';
import { collectAudioDiagnostics } from '../../audio/audioDiagnostics';
import {
  buildTimelineCanvasStoreDiagnostics,
  getTimelineCanvasDiagnostics,
} from '../../timeline/timelineCanvasDiagnostics';
import { timelineRuntimeCoordinator } from '../../timeline/timelineRuntimeCoordinator';
import { buildWorkerFirstProviderRuntimeSnapshot } from '../../timeline/providerRuntimeDiagnostics';
import { captureRenderTargetSnapshot } from '../../render/renderTargetSnapshotFactory';
import { renderHostPort } from '../../render/renderHostPort';
import { renderScheduler } from '../../renderScheduler';
import { getReverseWorkerWebCodecsRuntimeDebugSnapshot } from '../../layerBuilder/reverseWorkerWebCodecsRuntime';
import { createWorkerFirstProofSnapshot } from '../workerFirstProofHarness';
import { getWorkerFirstProofCaptures } from '../workerFirstProofCaptures';
import {
  getWorkerFirstCounterSources,
  getWorkerFirstPresentedFrameEvents,
  type WorkerFirstPresentedFrameEvent,
} from '../workerFirstCounterSources';
import {
  buildWorkerFirstRuntimeCounterSources,
  mergeWorkerFirstCounterSources,
} from '../workerFirstRuntimeCounterAdapter';
import {
  getLastRenderCapabilityProbe,
} from '../../render/renderCapabilityProbe';
import { derivePlaybackStatus } from '../../playbackDebug/status';
import type { ToolResult } from '../types';
import type { TimelineRuntimeCoordinatorBridgeStats } from '../../timeline/runtimeCoordinatorTypes';
import type { IndependentRenderSchedulerRuntimeSnapshot } from '../../renderScheduler';
import type { WorkerFirstCacheRuntimeSnapshot } from '../../../engine/texture/ScrubbingCache';
import type { WorkerFirstProviderRuntimeSnapshot } from '../../timeline/providerRuntimeDiagnostics';
import {
  buildMotionTimelineDiagnostics,
  getMotionRendererDiagnostics,
} from '../../../engine/motion/MotionDiagnostics';

const DEFAULT_PLAYBACK_WINDOW_MS = 5000;
const MAX_TRACE_WINDOW_MS = 120000;
const MAX_TRACE_EVENTS = 2000;

function serializeProjectLoadProgress(progress: ReturnType<typeof useMediaStore.getState>['projectLoadProgress']) {
  return {
    active: progress?.active ?? false,
    phase: progress?.phase ?? 'idle',
    percent: progress?.percent ?? 0,
    message: progress?.message ?? '',
    detail: progress?.detail,
    itemsDone: progress?.itemsDone,
    itemsTotal: progress?.itemsTotal,
    blocking: progress?.blocking ?? false,
  };
}

function roundOptional(v: number | undefined): number | undefined {
  return typeof v === 'number' ? round(v) : undefined;
}

function cloneCounts(counts: Record<string, number> | undefined): Record<string, number> | undefined {
  return counts ? { ...counts } : undefined;
}

function summarizePreviewCadence(events: readonly WorkerFirstPresentedFrameEvent[]): {
  readonly fps: number;
  readonly avgGapMs: number;
  readonly p95GapMs: number;
  readonly maxGapMs: number;
} {
  const gaps: number[] = [];
  for (let index = 1; index < events.length; index++) {
    const gap = events[index].t - events[index - 1].t;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) {
    return { fps: 0, avgGapMs: 0, p95GapMs: 0, maxGapMs: 0 };
  }
  const sorted = gaps.toSorted((a, b) => a - b);
  const avgGapMs = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const percentileIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95GapMs = sorted[percentileIndex] ?? 0;
  const maxGapMs = sorted.at(-1) ?? 0;
  return {
    fps: avgGapMs > 0 ? round(1000 / avgGapMs) : 0,
    avgGapMs: round(avgGapMs),
    p95GapMs: round(p95GapMs),
    maxGapMs: round(maxGapMs),
  };
}

function resolveVisualTargetFps(renderTargetFps: number, compositionFrameRate: number | undefined): number {
  const safeRenderTarget = Number.isFinite(renderTargetFps) && renderTargetFps > 0
    ? Math.round(renderTargetFps)
    : 60;
  const safeCompositionFps = typeof compositionFrameRate === 'number'
    && Number.isFinite(compositionFrameRate)
    && compositionFrameRate > 0
    ? Math.round(compositionFrameRate)
    : null;
  return safeCompositionFps === null
    ? safeRenderTarget
    : Math.max(1, Math.min(safeRenderTarget, safeCompositionFps));
}

function mergeWorkerPreviewTelemetry(
  playback: PlaybackDebugStats,
  workerPreviewEvents: readonly WorkerFirstPresentedFrameEvent[],
): PlaybackDebugStats {
  if (workerPreviewEvents.length === 0) return playback;
  const previewPathCounts = { ...(playback.previewPathCounts ?? {}) };
  const workerPreviewSources = new Set(
    workerPreviewEvents.map((event) => event.source || 'worker-presenting')
  );
  const alreadyCounted = [...workerPreviewSources].reduce((sum, source) => {
    return sum + (previewPathCounts[source] ?? 0);
  }, 0);
  const missingEvents = workerPreviewEvents.slice(alreadyCounted);
  if (missingEvents.length === 0) return playback;

  const cadence = summarizePreviewCadence(missingEvents);
  const missingUpdates = missingEvents.filter((event) => event.changed !== false).length;
  for (const event of missingEvents) {
    const source = event.source || 'worker-presenting';
    previewPathCounts[source] = (previewPathCounts[source] ?? 0) + 1;
  }

  const nextWithoutStatus: Omit<PlaybackDebugStats, 'status'> = {
    ...playback,
    previewFrames: playback.previewFrames + missingEvents.length,
    previewUpdates: playback.previewUpdates + missingUpdates,
    previewRenderFps: playback.previewFrames > 0 ? playback.previewRenderFps : cadence.fps,
    previewUpdateFps: playback.previewUpdates > 0 ? playback.previewUpdateFps : cadence.fps,
    avgPreviewRenderGapMs: playback.previewFrames > 0 ? playback.avgPreviewRenderGapMs : cadence.avgGapMs,
    p95PreviewRenderGapMs: playback.previewFrames > 0 ? playback.p95PreviewRenderGapMs : cadence.p95GapMs,
    maxPreviewRenderGapMs: Math.max(playback.maxPreviewRenderGapMs, cadence.maxGapMs),
    avgPreviewUpdateGapMs: playback.previewUpdates > 0 ? playback.avgPreviewUpdateGapMs : cadence.avgGapMs,
    p95PreviewUpdateGapMs: playback.previewUpdates > 0 ? playback.p95PreviewUpdateGapMs : cadence.p95GapMs,
    maxPreviewUpdateGapMs: Math.max(playback.maxPreviewUpdateGapMs, cadence.maxGapMs),
    previewPathCounts,
  };
  return {
    ...nextWithoutStatus,
    status: derivePlaybackStatus(nextWithoutStatus),
    workerGpuOnly: summarizeWorkerGpuOnlyPlaybackPaths(previewPathCounts),
  };
}

function serializeWorkerGpuOnlyPlayback(
  playback: PlaybackDebugStats,
): Record<string, unknown> | undefined {
  if (!playback.workerGpuOnly) return undefined;
  return {
    ...playback.workerGpuOnly,
    pathCounts: { ...playback.workerGpuOnly.pathCounts },
  };
}

function serializePlayback(playback: PlaybackDebugStats): Record<string, unknown> {
  return {
    status: playback.status,
    windowMs: playback.windowMs,
    pipeline: playback.pipeline,
    frameEvents: playback.frameEvents,
    cadenceFps: round(playback.cadenceFps),
    avgFrameGapMs: round(playback.avgFrameGapMs),
    p95FrameGapMs: round(playback.p95FrameGapMs),
    maxFrameGapMs: round(playback.maxFrameGapMs),
    previewFrames: playback.previewFrames,
    previewUpdates: playback.previewUpdates,
    previewRenderFps: round(playback.previewRenderFps),
    previewUpdateFps: round(playback.previewUpdateFps),
    avgPreviewRenderGapMs: round(playback.avgPreviewRenderGapMs),
    p95PreviewRenderGapMs: round(playback.p95PreviewRenderGapMs),
    maxPreviewRenderGapMs: round(playback.maxPreviewRenderGapMs),
    avgPreviewUpdateGapMs: round(playback.avgPreviewUpdateGapMs),
    p95PreviewUpdateGapMs: round(playback.p95PreviewUpdateGapMs),
    maxPreviewUpdateGapMs: round(playback.maxPreviewUpdateGapMs),
    stalePreviewFrames: playback.stalePreviewFrames,
    stalePreviewWhileTargetMoved: playback.stalePreviewWhileTargetMoved,
    previewFreezeEvents: playback.previewFreezeEvents,
    previewFreezeFrames: playback.previewFreezeFrames,
    longestPreviewFreezeFrames: playback.longestPreviewFreezeFrames,
    longestPreviewFreezeMs: round(playback.longestPreviewFreezeMs),
    lastPreviewFreezePath: playback.lastPreviewFreezePath,
    lastPreviewFreezeClipId: playback.lastPreviewFreezeClipId,
    lastPreviewFreezeDurationMs: roundOptional(playback.lastPreviewFreezeDurationMs),
    previewPathCounts: cloneCounts(playback.previewPathCounts),
    scrubPathCounts: cloneCounts(playback.scrubPathCounts),
    workerGpuOnly: serializeWorkerGpuOnlyPlayback(playback),
    avgPreviewDriftMs: round(playback.avgPreviewDriftMs),
    maxPreviewDriftMs: round(playback.maxPreviewDriftMs),
    stalls: playback.stalls,
    seeks: playback.seeks,
    advanceSeeks: playback.advanceSeeks,
    driftCorrections: playback.driftCorrections,
    readyStateDrops: playback.readyStateDrops,
    queuePressureEvents: playback.queuePressureEvents,
    healthAnomalies: playback.healthAnomalies,
    activeVideos: playback.activeVideos,
    playingVideos: playback.playingVideos,
    seekingVideos: playback.seekingVideos,
    warmingUpVideos: playback.warmingUpVideos,
    coldVideos: playback.coldVideos,
    worstReadyState: playback.worstReadyState,
    avgDecodeLatencyMs: roundOptional(playback.avgDecodeLatencyMs),
    avgSeekLatencyMs: roundOptional(playback.avgSeekLatencyMs),
    avgQueueDepth: roundOptional(playback.avgQueueDepth),
    maxQueueDepth: roundOptional(playback.maxQueueDepth),
    avgAudioDriftMs: roundOptional(playback.avgAudioDriftMs),
    decoderResets: playback.decoderResets,
    pendingSeekResolves: playback.pendingSeekResolves,
    avgPendingSeekMs: roundOptional(playback.avgPendingSeekMs),
    maxPendingSeekMs: roundOptional(playback.maxPendingSeekMs),
    collectorHolds: playback.collectorHolds,
    collectorDrops: playback.collectorDrops,
    lastAnomalyType: playback.lastAnomalyType,
  };
}

function collectCacheSnapshot(): Record<string, unknown> {
  return {
    scrubbing: renderHostPort.getScrubbingCacheStats(),
    composite: renderHostPort.getCompositeCacheStats(),
  };
}

function collectWorkerFirstRendererSnapshot(input: {
  readonly timelineRuntimeCoordinatorStats: TimelineRuntimeCoordinatorBridgeStats;
  readonly cacheStats: ReturnType<typeof collectCacheSnapshot>;
  readonly cacheRuntime: WorkerFirstCacheRuntimeSnapshot;
  readonly providerRuntime: WorkerFirstProviderRuntimeSnapshot;
  readonly renderLoop: Record<string, unknown> | null;
  readonly independentRenderScheduler: IndependentRenderSchedulerRuntimeSnapshot;
}): Record<string, unknown> {
  const recordedSources = getWorkerFirstCounterSources();
  const runtimeSources = buildWorkerFirstRuntimeCounterSources({
    timelineRuntime: input.timelineRuntimeCoordinatorStats,
    cacheStats: input.cacheStats,
    cacheRuntime: input.cacheRuntime,
    providerRuntime: input.providerRuntime,
    renderLoop: input.renderLoop,
    independentRenderScheduler: input.independentRenderScheduler,
  });
  return createWorkerFirstProofSnapshot({
    targetSnapshot: captureRenderTargetSnapshot(),
    capabilityProbe: getLastRenderCapabilityProbe(),
    proofCaptures: getWorkerFirstProofCaptures(),
    counterSources: mergeWorkerFirstCounterSources(recordedSources, runtimeSources),
    renderHostTelemetry: renderHostPort.getTelemetry(),
  }) as unknown as Record<string, unknown>;
}

function collectSnapshot(playbackWindowMs = DEFAULT_PLAYBACK_WINDOW_MS) {
  const { engineStats, gpuInfo, isEngineReady } = useEngineStore.getState();
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const s = engineStats;
  const activeComposition = mediaState.compositions.find(
    (composition) => composition.id === mediaState.activeCompositionId
  );
  const visualTargetFps = resolveVisualTargetFps(s.targetFps, activeComposition?.frameRate);
  const playbackNow = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const workerPreviewEvents = getWorkerFirstPresentedFrameEvents(playbackWindowMs, playbackNow);
  const playback = mergeWorkerPreviewTelemetry(buildPlaybackDebugStats({
    decoder: s.decoder,
    now: playbackNow,
    windowMs: playbackWindowMs,
    wcTimeline: wcPipelineMonitor.timeline(playbackWindowMs),
    vfTimeline: vfPipelineMonitor.timeline(playbackWindowMs),
    workerPreviewEvents,
    healthVideos: playbackHealthMonitor.videos(),
    healthAnomalies: playbackHealthMonitor.anomalies(),
  }), workerPreviewEvents);
  const cacheStats = collectCacheSnapshot();
  const cacheRuntime = renderHostPort.getWorkerFirstCacheRuntimeSnapshot();
  const timelineRuntimeCoordinatorStats = timelineRuntimeCoordinator.getBridgeStats();
  const providerRuntime = buildWorkerFirstProviderRuntimeSnapshot(timelineRuntimeCoordinatorStats);
  const independentRenderScheduler = renderScheduler.getWorkerFirstRuntimeSnapshot();
  const renderLoop = renderHostPort.getRenderLoop() as (Record<string, unknown> & {
    getLastSuccessfulRenderTime?: () => number;
    getRenderCount?: () => number;
    getIsIdle?: () => boolean;
    getIsPlaying?: () => boolean;
    getTimelineVisualDemand?: () => boolean;
  }) | null;

  const snapshot: Record<string, unknown> = {
    timestamp: Date.now(),
    engineReady: isEngineReady,
    document: {
      visibilityState: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
      hidden: typeof document !== 'undefined' ? document.hidden : undefined,
      hasFocus: typeof document !== 'undefined' && typeof document.hasFocus === 'function'
        ? document.hasFocus()
        : undefined,
    },
    fps: s.fps,
    targetFps: s.targetFps,
    visualTargetFps,
    activeComposition: activeComposition ? {
      id: activeComposition.id,
      name: activeComposition.name,
      frameRate: activeComposition.frameRate,
    } : null,
    isIdle: s.isIdle,
    timing: {
      rafGap: round(s.timing.rafGap),
      importTexture: round(s.timing.importTexture),
      renderPass: round(s.timing.renderPass),
      submit: round(s.timing.submit),
      total: round(s.timing.total),
    },
    mainThread: s.mainThread,
    drops: s.drops,
    decoder: s.decoder,
    layerCount: s.layerCount,
    projectLoadProgress: serializeProjectLoadProgress(mediaState.projectLoadProgress),
    audio: s.audio,
    audioDiagnostics: collectAudioDiagnostics({ windowMs: playbackWindowMs, eventLimit: 20 }),
    health: playbackHealthMonitor.snapshot(),
    cache: cacheStats,
    cacheRuntime,
    providerRuntime,
    timelineCanvas: getTimelineCanvasDiagnostics(buildTimelineCanvasStoreDiagnostics({
      tracks: timelineState.tracks,
      clips: timelineState.clips,
    })),
    motionDesign: {
      timeline: buildMotionTimelineDiagnostics(
        timelineState.clips,
        timelineState.playheadPosition,
      ),
      renderer: getMotionRendererDiagnostics(),
    },
    timelineRuntimeCoordinator: timelineRuntimeCoordinatorStats,
    independentRenderScheduler,
    slotDecks: slotDeckManager.getSnapshot(),
    pipelineStats: {
      wc: wcPipelineMonitor.stats(),
      vf: vfPipelineMonitor.stats(),
    },
    engineInfra: renderHostPort.getDebugInfrastructureState(),
    workerFirstRenderer: collectWorkerFirstRendererSnapshot({
      timelineRuntimeCoordinatorStats,
      cacheStats,
      cacheRuntime,
      providerRuntime,
      renderLoop: renderLoop as Record<string, unknown> | null,
      independentRenderScheduler,
    }),
    renderLoop: renderLoop ? {
      isRunning: renderLoop.isRunning,
      animationIdNull: renderLoop.animationId == null,
      idleSuppressed: renderLoop.idleSuppressed,
      renderRequested: renderLoop.renderRequested,
      hasActiveVideo: renderLoop.hasActiveVideo,
      isScrubbing: renderLoop.isScrubbing,
      timelineVisualDemand: renderLoop.getTimelineVisualDemand?.(),
      isIdle: renderLoop.getIsIdle?.(),
      isPlaying: renderLoop.getIsPlaying?.(),
      renderCount: renderLoop.getRenderCount?.(),
      lastSuccessfulRenderTime: renderLoop.getLastSuccessfulRenderTime?.(),
      lastRenderTime: renderLoop.lastRenderTime,
      watchdogActive: renderLoop.watchdogTimer != null,
    } : null,
    renderDispatcher: renderHostPort.getRenderDispatcherDebugSnapshot(),
    reverseWorkerWebCodecs: getReverseWorkerWebCodecsRuntimeDebugSnapshot(),
    export: exportDiagnostics.snapshot(),
  };

  snapshot.playback = serializePlayback(playback);

  if (s.webCodecsInfo) {
    snapshot.webCodecs = s.webCodecsInfo;
  }

  if (gpuInfo) {
    snapshot.gpu = gpuInfo;
  }

  return snapshot;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function handleGetStats(): Promise<ToolResult> {
  return {
    success: true,
    data: collectSnapshot(),
  };
}

export async function handleGetAudioDiagnostics(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const windowMs = Math.min(
    Math.max(Number(args.windowMs) || DEFAULT_PLAYBACK_WINDOW_MS, 100),
    MAX_TRACE_WINDOW_MS
  );
  const eventLimit = Math.min(Math.max(Number(args.eventLimit) || 50, 1), 500);

  return {
    success: true,
    data: collectAudioDiagnostics({ windowMs, eventLimit }),
  };
}

export async function handleGetStatsHistory(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const samples = Math.min(Math.max((args.samples as number) || 5, 1), 30);
  const intervalMs = Math.max((args.intervalMs as number) || 200, 100);

  const history: Record<string, unknown>[] = [];

  // Collect first sample immediately
  history.push(collectSnapshot());

  // Collect remaining samples
  for (let i = 1; i < samples; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    history.push(collectSnapshot());
  }

  // Compute summary
  const fpsList = history.map(s => s.fps as number);
  const totalList = history.map(s => (s.timing as { total: number }).total);

  return {
    success: true,
    data: {
      samples: history.length,
      intervalMs,
      durationMs: (samples - 1) * intervalMs,
      summary: {
        fpsMin: Math.min(...fpsList),
        fpsMax: Math.max(...fpsList),
        fpsAvg: round(fpsList.reduce((a, b) => a + b, 0) / fpsList.length),
        renderTimeMin: Math.min(...totalList),
        renderTimeMax: Math.max(...totalList),
        renderTimeAvg: round(totalList.reduce((a, b) => a + b, 0) / totalList.length),
      },
      snapshots: history,
    },
  };
}

export async function handleGetLogs(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
  const moduleFilter = typeof args.module === 'string' ? args.module.trim().toLowerCase() : '';
  const search = typeof args.search === 'string' ? args.search.trim().toLowerCase() : '';
  const level = typeof args.level === 'string' ? args.level.toUpperCase() : '';
  const sinceIso = typeof args.sinceIso === 'string' ? args.sinceIso.trim() : '';

  let logs = Logger.getBuffer(
    level === 'DEBUG' || level === 'INFO' || level === 'WARN' || level === 'ERROR'
      ? level
      : undefined
  );

  if (moduleFilter) {
    logs = logs.filter((entry) => entry.module.toLowerCase().includes(moduleFilter));
  }

  if (search) {
    logs = logs.filter((entry) =>
      entry.message.toLowerCase().includes(search) ||
      JSON.stringify(entry.data ?? '').toLowerCase().includes(search)
    );
  }

  if (sinceIso) {
    logs = logs.filter((entry) => entry.timestamp >= sinceIso);
  }

  const recentLogs = logs.slice(-limit);

  // Defense-in-depth: redact log entries before exposing via AI tool bridge.
  // The logger already redacts at entry creation time, but this catches any
  // entries that may have been buffered before redaction was integrated.
  const redactedLogs = recentLogs.map(entry => ({
    ...entry,
    message: redactSecrets(entry.message),
    data: entry.data !== undefined ? redactObject(entry.data) : undefined,
    stack: entry.stack ? redactSecrets(entry.stack) : undefined,
  }));

  return {
    success: true,
    data: {
      count: redactedLogs.length,
      totalMatched: logs.length,
      logs: redactedLogs,
    },
  };
}

export async function handleGetRuntimeDiagnostics(
  args: Record<string, unknown>
): Promise<ToolResult> {
  return {
    success: true,
    data: getRuntimeDiagnostics({
      limit: typeof args.limit === 'number' ? args.limit : undefined,
      level: typeof args.level === 'string' ? args.level : undefined,
      source: typeof args.source === 'string' ? args.source : undefined,
      search: typeof args.search === 'string' ? args.search : undefined,
      sinceId: typeof args.sinceId === 'number' ? args.sinceId : undefined,
    }),
  };
}

export async function handleClearRuntimeDiagnostics(): Promise<ToolResult> {
  return {
    success: true,
    data: clearRuntimeDiagnostics(),
  };
}

export async function handleGetPlaybackTrace(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const windowMs = Math.min(
    Math.max(Number(args.windowMs) || DEFAULT_PLAYBACK_WINDOW_MS, 100),
    MAX_TRACE_WINDOW_MS
  );
  const limit = Math.min(Math.max(Number(args.limit) || 200, 1), MAX_TRACE_EVENTS);
  const { engineStats, isEngineReady, gpuInfo } = useEngineStore.getState();

  const now = performance.now();
  const wcTimeline = wcPipelineMonitor.timeline(windowMs);
  const vfTimeline = vfPipelineMonitor.timeline(windowMs);
  const workerPreviewEvents = getWorkerFirstPresentedFrameEvents(windowMs, now);
  const healthVideos = playbackHealthMonitor.videos();
  const healthAnomalies = playbackHealthMonitor
    .anomalies()
    .filter((anomaly) => anomaly.timestamp >= now - windowMs);
  const playback = mergeWorkerPreviewTelemetry(buildPlaybackDebugStats({
    decoder: engineStats.decoder,
    now,
    windowMs,
    wcTimeline,
    vfTimeline,
    workerPreviewEvents,
    healthVideos,
    healthAnomalies,
  }), workerPreviewEvents);
  const cacheStats = collectCacheSnapshot();
  const cacheRuntime = renderHostPort.getWorkerFirstCacheRuntimeSnapshot();
  const timelineRuntimeCoordinatorStats = timelineRuntimeCoordinator.getBridgeStats();
  const providerRuntime = buildWorkerFirstProviderRuntimeSnapshot(timelineRuntimeCoordinatorStats);
  const independentRenderScheduler = renderScheduler.getWorkerFirstRuntimeSnapshot();
  const renderLoop = renderHostPort.getRenderLoop() as Record<string, unknown> | null;

  return {
    success: true,
    data: {
      timestamp: Date.now(),
      decoder: engineStats.decoder,
      engineReady: isEngineReady,
      windowMs,
      limit,
      playback: serializePlayback(playback),
      health: playbackHealthMonitor.snapshot(),
      cache: cacheStats,
      cacheRuntime,
      providerRuntime,
      independentRenderScheduler,
      workerFirstRenderer: collectWorkerFirstRendererSnapshot({
        timelineRuntimeCoordinatorStats,
        cacheStats,
        cacheRuntime,
        providerRuntime,
        renderLoop,
        independentRenderScheduler,
      }),
      slotDecks: slotDeckManager.getSnapshot(),
      gpu: gpuInfo,
      wcStats: wcPipelineMonitor.stats(),
      vfStats: vfPipelineMonitor.stats(),
      wcEvents: wcTimeline.slice(-limit),
      vfEvents: vfTimeline.slice(-limit),
      workerPreviewEvents: workerPreviewEvents.slice(-limit),
      healthVideos,
      healthAnomalies,
    },
  };
}

export async function handlePurgePlaybackPath(
  args: Record<string, unknown>
): Promise<ToolResult> {
  const mode = args.mode === 'full' ? 'full' : 'targeted';
  const result = playbackHealthMonitor.purgePlaybackPath({
    reason: typeof args.reason === 'string' && args.reason.trim()
      ? args.reason.trim()
      : 'ai-tool',
    mode,
    resumePlayback: typeof args.resumePlayback === 'boolean'
      ? args.resumePlayback
      : undefined,
  });

  return {
    success: true,
    data: result,
  };
}
