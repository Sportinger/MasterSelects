import {
  WORKER_GPU_ONLY_PREVIEW_PATH_LABELS,
  type EngineStats,
  type WorkerGpuOnlyFrameState,
  type WorkerGpuOnlyPlaybackDiagnostics,
  type WorkerGpuOnlyPreviewPathLabel,
} from '../types/engineStats';
import type { PipelineEvent } from './wcPipelineMonitor';
import type { VFPipelineEvent } from './vfPipelineMonitor';
import {
  buildPlaybackDebugStats as buildPlaybackDebugStatsBase,
  mapDecoderToPlaybackPipeline,
} from './playbackDebug/assembly';
import { buildPlaybackRunDiagnostics as buildPlaybackRunDiagnosticsBase } from './playbackDebug/runDiagnostics';
import { summarizeFrameCadence } from './playbackDebug/collectors';

export type PlaybackDebugStats = NonNullable<EngineStats['playback']>;
export type PlaybackPipeline = PlaybackDebugStats['pipeline'];
export type PlaybackCadenceStats = NonNullable<PlaybackDebugStats['recentCadence']>;

export const EFFECTIVE_PLAYBACK_CADENCE_WINDOW_MS = 1_000;

export interface PlaybackRunStartupStats {
  firstDecodeOutputMs?: number;
  firstPreviewFrameMs?: number;
  firstPreviewUpdateMs?: number;
  startupCatchUpMs?: number;
  initialTargetMovedStaleFrames: number;
  initialTargetMovedStaleMs: number;
}

export interface PlaybackRunDiagnostics {
  windowMs: number;
  playback: PlaybackDebugStats;
  startup: PlaybackRunStartupStats;
  wcEventCount: number;
  vfEventCount: number;
}

export interface PlaybackHealthVideoState {
  clipId: string;
  src: string;
  currentTime: number;
  readyState: number;
  seeking: boolean;
  paused: boolean;
  played: number;
  warmingUp: boolean;
  gpuReady: boolean;
}

export interface PlaybackHealthAnomaly {
  type: string;
  timestamp: number;
  clipId?: string;
  detail?: string;
  recovered: boolean;
}

export interface PlaybackPreviewFrameEvent {
  t: number;
  frameId: string;
  targetId: string;
  source: string;
  changed?: boolean;
  targetMoved?: boolean;
  driftMs?: number;
}

export interface PlaybackDebugBuildParams {
  decoder: EngineStats['decoder'];
  now?: number;
  windowMs?: number;
  wcTimeline?: PipelineEvent[];
  vfTimeline?: VFPipelineEvent[];
  workerPreviewEvents?: readonly PlaybackPreviewFrameEvent[];
  healthVideos?: PlaybackHealthVideoState[];
  healthAnomalies?: PlaybackHealthAnomaly[];
}

export interface PlaybackRunDiagnosticsParams {
  decoder: EngineStats['decoder'];
  startMs: number;
  endMs: number;
  wcEvents?: PipelineEvent[];
  vfEvents?: VFPipelineEvent[];
  workerPreviewEvents?: readonly PlaybackPreviewFrameEvent[];
  healthVideos?: PlaybackHealthVideoState[];
  healthAnomalies?: PlaybackHealthAnomaly[];
}

const WORKER_GPU_ONLY_TEST_PATTERN_LABEL = 'worker-gpu-only:gpu-test-pattern';
const WORKER_GPU_ONLY_PREFIX = 'worker-gpu-only:';

const WORKER_GPU_ONLY_PREVIEW_PATH_LABEL_SET = new Set<string>(
  WORKER_GPU_ONLY_PREVIEW_PATH_LABELS,
);

function createEmptyWorkerGpuOnlyPathCounts(): Record<WorkerGpuOnlyPreviewPathLabel, number> {
  return Object.fromEntries(
    WORKER_GPU_ONLY_PREVIEW_PATH_LABELS.map((label) => [label, 0]),
  ) as Record<WorkerGpuOnlyPreviewPathLabel, number>;
}

function readCounter(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export function isWorkerGpuOnlyPreviewPathLabel(
  path: string,
): path is WorkerGpuOnlyPreviewPathLabel {
  return WORKER_GPU_ONLY_PREVIEW_PATH_LABEL_SET.has(path);
}

export function summarizeWorkerGpuOnlyPlaybackPaths(
  previewPathCounts: Record<string, number> | undefined,
): WorkerGpuOnlyPlaybackDiagnostics {
  const pathCounts = createEmptyWorkerGpuOnlyPathCounts();
  let testPatternFrames = 0;
  let realSourceFrames = 0;
  let unknownSourceFrames = 0;

  for (const [path, value] of Object.entries(previewPathCounts ?? {})) {
    const count = readCounter(value);
    if (count === 0) continue;
    if (isWorkerGpuOnlyPreviewPathLabel(path)) {
      pathCounts[path] += count;
      if (path === WORKER_GPU_ONLY_TEST_PATTERN_LABEL) {
        testPatternFrames += count;
      } else {
        realSourceFrames += count;
      }
      continue;
    }
    if (path.startsWith(WORKER_GPU_ONLY_PREFIX)) {
      unknownSourceFrames += count;
    }
  }

  const previewFrames = testPatternFrames + realSourceFrames + unknownSourceFrames;
  const frameState: WorkerGpuOnlyFrameState = realSourceFrames > 0 || unknownSourceFrames > 0
    ? 'real-gpu-source'
    : testPatternFrames > 0
      ? 'gpu-test-pattern'
      : 'no-gpu-frame';

  return {
    frameState,
    previewFrames,
    testPatternFrames,
    realSourceFrames,
    unknownSourceFrames,
    pathCounts,
  };
}

function withWorkerGpuOnlyDiagnostics(playback: PlaybackDebugStats): PlaybackDebugStats {
  return {
    ...playback,
    workerGpuOnly: summarizeWorkerGpuOnlyPlaybackPaths(playback.previewPathCounts),
  };
}

export function buildPlaybackDebugStats(
  params: PlaybackDebugBuildParams,
): PlaybackDebugStats {
  return withWorkerGpuOnlyDiagnostics(buildPlaybackDebugStatsBase(params));
}

export function toPlaybackCadenceStats(playback: PlaybackDebugStats): PlaybackCadenceStats {
  return {
    windowMs: playback.windowMs,
    frameEvents: playback.frameEvents,
    cadenceFps: playback.cadenceFps,
    previewFrames: playback.previewFrames,
    previewUpdates: playback.previewUpdates,
    previewRenderFps: playback.previewRenderFps,
    previewUpdateFps: playback.previewUpdateFps,
  };
}

export function buildPlaybackRunDiagnostics(
  params: PlaybackRunDiagnosticsParams,
): PlaybackRunDiagnostics {
  const diagnostics = buildPlaybackRunDiagnosticsBase(params);
  return {
    ...diagnostics,
    playback: withWorkerGpuOnlyDiagnostics(diagnostics.playback),
  };
}

export { mapDecoderToPlaybackPipeline, summarizeFrameCadence };
