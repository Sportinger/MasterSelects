import { useTimelineStore } from '../../stores/timeline';
import { captureRenderTargetSnapshot } from '../render/renderTargetSnapshotFactory';
import { renderHostPort, type RenderCaptureCanvas } from '../render/renderHostPort';
import { ensureRenderForDiagnostics } from './handlers/renderOnce';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeRestoreState,
} from './handlers/smokes/smokeRuntime';
import { handleRunTimelineCanvasExportPreviewParitySmoke } from './handlers/smokes/exportPreviewParity';
import type { ToolResult } from './types';
import {
  collectCurrentExportSignals,
  collectCurrentRenderTargetSignals,
  collectCurrentTimelineSignals,
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
  type WorkerFirstExportSignalContext,
  type WorkerFirstGoldenFixtureBridgeDeps,
} from './workerFirstGoldenFixtureBridge';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

interface ExportFixtureRunSummary extends WorkerFirstExportSignalContext {
  readonly sampleTime: number | null;
  readonly exportDurationSeconds: number;
  readonly exportWidth: number;
  readonly exportHeight: number;
  readonly exportFps: number;
  readonly exportMode: 'fast';
  readonly codec: string | null;
  readonly container: string | null;
  readonly referenceCaptured: boolean;
  readonly fastRun: unknown;
}

export interface WorkerFirstExportFixtureSummary {
  readonly projectId: 'export';
  readonly contentFixture: unknown;
  readonly exportRun: ExportFixtureRunSummary;
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstExportGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>, fixtureData: unknown) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'export' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 2.35;
const EXPORT_WIDTH = 320;
const EXPORT_HEIGHT = 180;
const EXPORT_FPS = 8;

const DEFAULT_DEPS: WorkerFirstExportGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstExportFixture(args),
  captureGoldenFingerprint: (args, fixtureData) => captureExportGoldenFingerprint(args, fixtureData),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getExportManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('export golden manifest is missing');
  }
  return manifest;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = args[key];
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readFailures(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function combineSignals(...groups: readonly (readonly string[])[]): readonly string[] {
  return Array.from(new Set(groups.flat())).toSorted();
}

async function resolveExportCodec(): Promise<{ readonly codec: string; readonly container: string }> {
  const { FrameExporter } = await import('../../engine/export');
  if (await FrameExporter.checkCodecSupport('h264', EXPORT_WIDTH, EXPORT_HEIGHT)) {
    return { codec: 'h264', container: 'mp4' };
  }
  if (await FrameExporter.checkCodecSupport('vp9', EXPORT_WIDTH, EXPORT_HEIGHT)) {
    return { codec: 'vp9', container: 'webm' };
  }
  return { codec: 'h264', container: 'mp4' };
}

function extractExportRunSummary(
  smokeData: unknown,
  exportDurationSeconds: number,
  codec: string | null,
  container: string | null,
): ExportFixtureRunSummary {
  const smoke = readObject(smokeData);
  const fastRun = readObject(smoke.fastRun);
  const failures = readFailures(smoke.failures);
  return {
    completed: fastRun.success === true && failures.length === 0,
    blobSize: readNumber(fastRun.blobSize, 0),
    previewSampleCount: readNumber(smoke.previewSampleCount, readNumber(fastRun.sampleCount, 0)),
    failures,
    sampleTime: typeof smoke.sampleTime === 'number' && Number.isFinite(smoke.sampleTime)
      ? smoke.sampleTime
      : null,
    exportDurationSeconds,
    exportWidth: EXPORT_WIDTH,
    exportHeight: EXPORT_HEIGHT,
    exportFps: EXPORT_FPS,
    exportMode: 'fast',
    codec,
    container,
    referenceCaptured: Boolean(smoke.reference),
    fastRun: smoke.fastRun ?? null,
  };
}

function summarizeExportFixture(contentFixture: unknown, exportRun: ExportFixtureRunSummary): WorkerFirstExportFixtureSummary {
  const timelineState = useTimelineStore.getState();
  return {
    projectId: PROJECT_ID,
    contentFixture,
    exportRun,
    timelineSignals: combineSignals(
      collectCurrentTimelineSignals(timelineState.clips),
      collectCurrentRenderTargetSignals(captureRenderTargetSnapshot()),
      collectCurrentExportSignals(exportRun),
    ),
  };
}

export async function materializeWorkerFirstExportFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const manifest = getExportManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);
  const exportDurationSeconds = Math.min(durationSeconds, Math.max(...manifest.sampleTimesSeconds) + 0.15);

  const contentResult = await materializeWorkerFirstSolidTextImageFixture({
    ...args,
    projectId: 'solid-text-image',
    width,
    height,
    durationSeconds,
  });
  if (!contentResult.success) {
    return contentResult;
  }

  const codecChoice = await resolveExportCodec();
  const exportResult = await handleRunTimelineCanvasExportPreviewParitySmoke({
    createSynthetic: false,
    restoreTimelineAfterRun: false,
    requireTimelineDom: false,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    fps: EXPORT_FPS,
    sampleTimes: [0],
    exportDurationSeconds,
    includePrecise: false,
    captureMode: 'gpu',
    codec: codecChoice.codec,
    container: codecChoice.container,
    maxRuntimeMs: 45000,
    sampleWidth: args.sampleWidth,
    sampleHeight: args.sampleHeight,
  });

  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 220);

  const exportRun = extractExportRunSummary(
    exportResult.data,
    exportDurationSeconds,
    codecChoice.codec,
    codecChoice.container,
  );
  const summary = summarizeExportFixture(contentResult.data, exportRun);

  if (!exportResult.success || collectCurrentExportSignals(exportRun).length === 0) {
    return {
      success: false,
      error: `Export preview parity failed for export golden fixture: ${exportResult.error ?? 'missing export signal'}`,
      data: {
        projectId: PROJECT_ID,
        contentFixture: contentResult.data,
        exportPreviewParity: exportResult.data,
        summary,
      },
    };
  }

  return {
    success: true,
    data: summary,
  };
}

function hasCallerProofFields(args: Record<string, unknown>): boolean {
  return args.source !== undefined
    || args.fingerprint !== undefined
    || args.sampleTimeSeconds !== undefined
    || args.targetSnapshot !== undefined;
}

function hasCallerExportOverrideFields(args: Record<string, unknown>): boolean {
  return args.startTime !== undefined
    || args.endTime !== undefined
    || args.exportDurationSeconds !== undefined
    || args.exportWidth !== undefined
    || args.exportHeight !== undefined
    || args.exportFps !== undefined
    || args.fps !== undefined
    || args.sampleTimes !== undefined
    || args.exportMode !== undefined
    || args.includePrecise !== undefined
    || args.download !== undefined
    || args.codec !== undefined
    || args.container !== undefined
    || args.maxRuntimeMs !== undefined
    || args.createSynthetic !== undefined
    || args.captureMode !== undefined
    || args.requireTimelineDom !== undefined
    || args.exportRun !== undefined
    || args.fastRun !== undefined
    || args.preciseRun !== undefined
    || args.blob !== undefined
    || args.blobSize !== undefined
    || args.progressSamples !== undefined
    || args.exportStats !== undefined
    || args.exportPreviewFrame !== undefined
    || args.exportPreviewFrameTime !== undefined
    || args.previewSampleCount !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 900,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

function extractExportSignalContext(fixtureData: unknown): WorkerFirstExportSignalContext {
  const fixture = readObject(fixtureData);
  const exportRun = readObject(fixture.exportRun);
  return {
    completed: exportRun.completed === true,
    blobSize: readNumber(exportRun.blobSize, 0),
    previewSampleCount: readNumber(exportRun.previewSampleCount, 0),
    failures: readFailures(exportRun.failures),
  };
}

function createExportCaptureDeps(exportContext: WorkerFirstExportSignalContext): WorkerFirstGoldenFixtureBridgeDeps {
  return {
    getCaptureCanvas: (): RenderCaptureCanvas | null => renderHostPort.getCaptureCanvas(),
    setPlayheadPosition: (timeSeconds) => {
      useTimelineStore.getState().setPlayheadPosition(timeSeconds);
    },
    ensureRender: () => ensureRenderForDiagnostics(),
    getTimelineSignals: () => {
      const timelineState = useTimelineStore.getState();
      return combineSignals(
        collectCurrentTimelineSignals(timelineState.clips),
        collectCurrentRenderTargetSignals(captureRenderTargetSnapshot()),
        collectCurrentExportSignals(exportContext),
      );
    },
    getTimelineDuration: () => useTimelineStore.getState().duration,
  };
}

async function captureExportGoldenFingerprint(
  args: Record<string, unknown>,
  fixtureData: unknown,
): Promise<ToolResult> {
  const exportContext = extractExportSignalContext(fixtureData);
  return handleCaptureWorkerFirstGoldenFixtureFingerprint(args, createExportCaptureDeps(exportContext));
}

export async function handleRunWorkerFirstExportGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstExportGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the export golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, sample times, and target snapshots are controlled by the export manifest.',
    };
  }

  if (hasCallerExportOverrideFields(args)) {
    return {
      success: false,
      error: 'Export range, codec, preview parity, blob, and export preview evidence are controlled by the export runner.',
    };
  }

  const manifest = getExportManifest();
  const shouldRestoreTimeline = args.restoreTimelineAfterRun === true;
  const restoreState = shouldRestoreTimeline ? deps.captureRestoreState() : null;
  const endMutation = deps.beginMutation();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let result: ToolResult;

  try {
    const fixtureResult = await deps.materializeFixture({ ...args, projectId: PROJECT_ID });
    if (!fixtureResult.success) {
      result = fixtureResult;
    } else {
      const captureResults: ToolResult[] = [];
      const failures: ToolResult[] = [];
      for (const sampleTimeSeconds of manifest.sampleTimesSeconds) {
        const captureResult = await deps.captureGoldenFingerprint(
          captureArgsForSample(args, sampleTimeSeconds),
          fixtureResult.data,
        );
        captureResults.push(captureResult);
        if (!captureResult.success) failures.push(captureResult);
      }

      const data = {
        projectId: PROJECT_ID,
        manifestSampleTimesSeconds: manifest.sampleTimesSeconds,
        fixture: fixtureResult.data,
        captures: captureResults.map((captureResult) => captureResult.data ?? { error: captureResult.error ?? null }),
        failures,
        restoredTimeline: restoreResult,
        w5StartPermissionsRemainStatsGuarded: true,
      };

      result = failures.length > 0
        ? { success: false, error: 'One or more export golden fixture captures failed.', data }
        : { success: true, data };
    }
  } finally {
    if (restoreState) {
      restoreResult = await deps.restoreTimeline(restoreState);
    }
    endMutation();
  }

  if (restoreResult && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return {
      ...result,
      data: {
        ...result.data,
        restoredTimeline: restoreResult,
      },
    };
  }
  return result;
}
