import { useTimelineStore } from '../../stores/timeline';
import { FrameExporter } from '../../engine/export';
import type { ToolResult } from './types';
import { handleDebugExport } from './handlers/export';
import { handleSimulatePlayback } from './handlers/playback';
import { handleGetPlaybackTrace, handleGetStats } from './handlers/stats';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';

export interface WorkerFirstRuntimeExportPlaybackSmokeDeps {
  readonly materializeFixture?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly simulatePlayback?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly debugExport?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getStats?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getPlaybackTrace?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly now?: () => number;
}

const FORBIDDEN_CALLER_EVIDENCE_FIELDS = [
  'fingerprint',
  'mainFingerprint',
  'workerFingerprint',
  'proofCaptures',
  'goldenFixtures',
  'shadowSamples',
  'visibleProofs',
  'w5Prerequisites',
  'acceptedSnapshot',
  'allowW5StartFromCapturedEvidence',
  'canStartWorkerWebGpu',
  'canStartWorkerPresentation',
  'canStartRenderDispatcherCutover',
] as const;

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, readNumber(args[key], fallback)));
}

function findForbiddenEvidenceFields(args: Record<string, unknown>): string[] {
  return FORBIDDEN_CALLER_EVIDENCE_FIELDS.filter((field) => args[field] !== undefined);
}

function summarizePlayback(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  return {
    requestedDurationMs: readNumber(data.requestedDurationMs),
    actualDurationMs: readNumber(data.actualDurationMs),
    initialPosition: readNumber(data.initialPosition),
    finalPosition: readNumber(data.finalPosition),
    deltaSeconds: readNumber(data.deltaSeconds),
    framesObserved: readNumber(data.framesObserved),
    movingFrames: readNumber(data.movingFrames),
    stalledFrames: readNumber(data.stalledFrames),
    longestStallFrames: readNumber(data.longestStallFrames),
    endedPlaying: readBool(data.endedPlaying),
  };
}

function summarizeExport(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const blob = readObject(data.blob);
  return {
    elapsedMs: readNumber(data.elapsedMs),
    timedOut: readBool(data.timedOut),
    blobSize: readNumber(blob.size),
    blobType: typeof blob.type === 'string' ? blob.type : null,
    progressSamples: Array.isArray(data.progressSamples) ? data.progressSamples.length : 0,
  };
}

function summarizeStats(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const cacheRuntime = readObject(data.cacheRuntime);
  const providerRuntime = readObject(data.providerRuntime);
  const independentRenderScheduler = readObject(data.independentRenderScheduler);
  const workerFirstRenderer = readObject(data.workerFirstRenderer);
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites);

  return {
    engineReady: readBool(data.engineReady),
    cacheRuntimeRecordCount: Array.isArray(cacheRuntime.records) ? cacheRuntime.records.length : null,
    providerRuntimeRecordCount: Array.isArray(providerRuntime.providers) ? providerRuntime.providers.length : null,
    independentRenderSchedulerJobCount: Array.isArray(independentRenderScheduler.jobs)
      ? independentRenderScheduler.jobs.length
      : null,
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function summarizeTrace(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const playback = readObject(data.playback);
  const workerFirstRenderer = readObject(data.workerFirstRenderer);
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites);
  return {
    playbackStatus: playback.status ?? null,
    previewFrames: readNumber(playback.previewFrames),
    previewUpdates: readNumber(playback.previewUpdates),
    stalePreviewFrames: readNumber(playback.stalePreviewFrames),
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function runtimeFeedsPresent(statsSummary: Record<string, unknown>): boolean {
  return typeof statsSummary.cacheRuntimeRecordCount === 'number'
    && typeof statsSummary.providerRuntimeRecordCount === 'number'
    && typeof statsSummary.independentRenderSchedulerJobCount === 'number'
    && statsSummary.workerFirstRendererPresent === true;
}

function startPermissionsRemainFalse(summary: Record<string, unknown>): boolean {
  return summary.canStartWorkerWebGpu === false
    && summary.canStartWorkerPresentation === false
    && summary.canStartRenderDispatcherCutover === false;
}

async function resolveDebugExportCodec(
  width: number,
  height: number,
): Promise<{ readonly codec: 'h264' | 'vp9'; readonly container: 'mp4' | 'webm' }> {
  if (await FrameExporter.checkCodecSupport('h264', width, height)) {
    return { codec: 'h264', container: 'mp4' };
  }
  if (await FrameExporter.checkCodecSupport('vp9', width, height)) {
    return { codec: 'vp9', container: 'webm' };
  }
  return { codec: 'h264', container: 'mp4' };
}

export async function handleRunWorkerFirstRuntimeExportPlaybackSmoke(
  args: Record<string, unknown>,
  deps: WorkerFirstRuntimeExportPlaybackSmokeDeps = {},
): Promise<ToolResult> {
  const forbiddenFields = findForbiddenEvidenceFields(args);
  if (forbiddenFields.length > 0) {
    return {
      success: false,
      error: 'Runtime export/playback smoke captures browser evidence itself; caller-supplied proof fields are not accepted.',
      data: { forbiddenFields },
    };
  }

  const now = deps.now ?? (() => Date.now());
  const materializeFixture = deps.materializeFixture ?? materializeWorkerFirstSolidTextImageFixture;
  const simulatePlayback = deps.simulatePlayback ?? ((playbackArgs) =>
    handleSimulatePlayback(playbackArgs, useTimelineStore.getState()));
  const debugExport = deps.debugExport ?? handleDebugExport;
  const getStats = deps.getStats ?? handleGetStats;
  const getPlaybackTrace = deps.getPlaybackTrace ?? handleGetPlaybackTrace;
  const startedAt = now();

  const width = Math.round(readNumberArg(args, 'width', 1280, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', 720, 180, 2160));
  const durationSeconds = readNumberArg(args, 'durationSeconds', 2.25, 1.25, 10);
  const playbackDurationMs = Math.round(readNumberArg(args, 'playbackDurationMs', 1000, 250, 9000));
  const exportDurationSeconds = readNumberArg(args, 'exportDurationSeconds', 0.75, 0.25, durationSeconds);
  const exportWidth = Math.round(readNumberArg(args, 'exportWidth', 320, 64, 1920));
  const exportHeight = Math.round(readNumberArg(args, 'exportHeight', 180, 64, 1080));
  const exportFps = readNumberArg(args, 'exportFps', 8, 1, 60);
  const maxRuntimeMs = Math.round(readNumberArg(args, 'maxRuntimeMs', 45000, 1000, 120000));
  const exportCodec = await resolveDebugExportCodec(exportWidth, exportHeight);

  const fixtureResult = await materializeFixture({
    resetProject: true,
    width,
    height,
    durationSeconds,
  });
  if (!fixtureResult.success) {
    return {
      success: false,
      error: fixtureResult.error ?? 'Runtime smoke fixture materialization failed.',
      data: {
        projectId: 'runtime-export-playback',
        fixture: fixtureResult.data ?? null,
      },
    };
  }

  const statsBefore = await getStats({});
  const playbackResult = await simulatePlayback({
    startTime: 0,
    durationMs: playbackDurationMs,
    settleMs: 250,
    playbackSpeed: 1,
    resetDiagnostics: true,
    restorePlaybackState: false,
  });
  const exportResult = await debugExport({
    startTime: 0,
    durationSeconds: exportDurationSeconds,
    width: exportWidth,
    height: exportHeight,
    fps: exportFps,
    exportMode: 'fast',
    codec: exportCodec.codec,
    container: exportCodec.container,
    includeAudio: false,
    download: false,
    maxRuntimeMs,
  });
  const statsAfter = await getStats({});
  const playbackTrace = await getPlaybackTrace({ windowMs: 5000, limit: 200 });

  const statsBeforeSummary = summarizeStats(statsBefore);
  const statsAfterSummary = summarizeStats(statsAfter);
  const playbackSummary = summarizePlayback(playbackResult);
  const exportSummary = summarizeExport(exportResult);
  const traceSummary = summarizeTrace(playbackTrace);
  const checks = {
    statsBeforeSucceeded: statsBefore.success,
    playbackSucceeded: playbackResult.success,
    playbackObservedMotion: readNumber(playbackSummary.movingFrames) > 0,
    exportSucceeded: exportResult.success,
    exportProducedBlob: readNumber(exportSummary.blobSize) > 0,
    exportDidNotTimeout: exportSummary.timedOut === false,
    statsAfterSucceeded: statsAfter.success,
    playbackTraceSucceeded: playbackTrace.success,
    runtimeFeedsPresent: runtimeFeedsPresent(statsAfterSummary),
    statsStartPermissionsRemainFalse: startPermissionsRemainFalse(statsAfterSummary),
    traceStartPermissionsRemainFalse: startPermissionsRemainFalse(traceSummary),
  };
  const passed = Object.values(checks).every(Boolean);
  const finishedAt = now();
  const data = {
    projectId: 'runtime-export-playback',
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    fixture: fixtureResult.data,
    settings: {
      width,
      height,
      durationSeconds,
      playbackDurationMs,
      exportDurationSeconds,
      exportWidth,
      exportHeight,
      exportFps,
      exportCodec: exportCodec.codec,
      exportContainer: exportCodec.container,
      maxRuntimeMs,
    },
    checks,
    statsBefore: statsBeforeSummary,
    playback: playbackSummary,
    export: exportSummary,
    statsAfter: statsAfterSummary,
    playbackTrace: traceSummary,
    errors: {
      statsBefore: statsBefore.error ?? null,
      playback: playbackResult.error ?? null,
      export: exportResult.error ?? null,
      statsAfter: statsAfter.error ?? null,
      playbackTrace: playbackTrace.error ?? null,
    },
    w5StartPermissionsRemainStatsGuarded: true,
  };

  return passed
    ? { success: true, data }
    : {
        success: false,
        error: 'Runtime export/playback smoke did not satisfy all checks.',
        data,
      };
}
