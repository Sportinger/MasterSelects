import { useTimelineStore } from '../../stores/timeline';
import { renderHostPort } from '../render/renderHostPort';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeRestoreState,
} from './handlers/smokes/smokeRuntime';
import { handleRunTimelineCanvasRamPreviewSmoke } from './handlers/smokes/ramPreview';
import type { ToolResult } from './types';
import {
  collectCurrentRamCacheSignals,
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
} from './workerFirstGoldenFixtureBridge';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

export interface WorkerFirstRamCacheFixtureSummary {
  readonly projectId: 'ram-cache';
  readonly contentFixture: unknown;
  readonly range: { readonly start: number; readonly end: number };
  readonly mode: string;
  readonly completed: boolean;
  readonly ramPreviewRange: { readonly start: number; readonly end: number } | null;
  readonly cachedFrameCount: number;
  readonly cachedRanges: readonly { readonly start: number; readonly end: number }[];
  readonly compositeCacheStats: ReturnType<typeof renderHostPort.getCompositeCacheStats>;
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstRamCacheGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly runRamPreviewSmoke: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'ram-cache' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 1.35;

const DEFAULT_DEPS: WorkerFirstRamCacheGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstRamCacheFixture(args),
  runRamPreviewSmoke: (args) => handleRunTimelineCanvasRamPreviewSmoke(args),
  captureGoldenFingerprint: (args) => captureRamCacheGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getRamCacheManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('ram-cache golden manifest is missing');
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

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

function summarizeRamCacheFixture(
  contentFixture: unknown,
  smokeData: unknown,
  range: { readonly start: number; readonly end: number },
): WorkerFirstRamCacheFixtureSummary {
  const timelineState = useTimelineStore.getState();
  const cachedRanges = timelineState.getCachedRanges();
  const compositeCacheStats = renderHostPort.getCompositeCacheStats();
  const cacheSignals = collectCurrentRamCacheSignals({
    ramPreviewRange: timelineState.ramPreviewRange,
    cachedFrameCount: timelineState.cachedFrameTimes.size,
    cachedRanges,
    isRamPreviewing: timelineState.isRamPreviewing,
    ramPreviewProgress: timelineState.ramPreviewProgress,
    compositeCacheStats,
  });
  const smokeRecord = readObject(smokeData);
  return {
    projectId: PROJECT_ID,
    contentFixture,
    range,
    mode: getString(smokeRecord.mode, 'unknown'),
    completed: smokeRecord.completed === true,
    ramPreviewRange: timelineState.ramPreviewRange,
    cachedFrameCount: timelineState.cachedFrameTimes.size,
    cachedRanges,
    compositeCacheStats,
    timelineSignals: ['image', 'solid', 'text', ...cacheSignals].toSorted(),
  };
}

export async function materializeWorkerFirstRamCacheFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const manifest = getRamCacheManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);
  const range = {
    start: 0,
    end: Math.min(durationSeconds, Math.max(...manifest.sampleTimesSeconds) + 0.15),
  };

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

  const smokeResult = await handleRunTimelineCanvasRamPreviewSmoke({
    startTime: range.start,
    endTime: range.end,
    requireVideo: false,
    requireTimelineDom: false,
    createSynthetic: false,
    restoreTimelineAfterRun: false,
    allowDirectEngineFallback: true,
  });
  if (!smokeResult.success) {
    return {
      success: false,
      error: `RAM preview generation failed for ram-cache golden fixture: ${smokeResult.error ?? 'unknown error'}`,
      data: {
        projectId: PROJECT_ID,
        contentFixture: contentResult.data,
        ramPreviewSmoke: smokeResult.data,
      },
    };
  }

  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 220);

  return {
    success: true,
    data: summarizeRamCacheFixture(contentResult.data, smokeResult.data, range),
  };
}

function hasCallerProofFields(args: Record<string, unknown>): boolean {
  return args.source !== undefined
    || args.fingerprint !== undefined
    || args.sampleTimeSeconds !== undefined
    || args.targetSnapshot !== undefined;
}

function hasCallerCacheOverrideFields(args: Record<string, unknown>): boolean {
  return args.startTime !== undefined
    || args.endTime !== undefined
    || args.createSynthetic !== undefined
    || args.requireVideo !== undefined
    || args.allowDirectEngineFallback !== undefined
    || args.ramPreviewRange !== undefined
    || args.cachedFrameTimes !== undefined
    || args.cachedRanges !== undefined
    || args.compositeCache !== undefined
    || args.compositeCacheStats !== undefined
    || args.ramPreviewSmoke !== undefined
    || args.ramPreviewFrames !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 700,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

async function captureRamCacheGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
  const sampleTimeSeconds = typeof args.sampleTimeSeconds === 'number' && Number.isFinite(args.sampleTimeSeconds)
    ? args.sampleTimeSeconds
    : null;
  let cachedFrameHit = false;
  if (sampleTimeSeconds !== null) {
    useTimelineStore.getState().setPlayheadPosition(sampleTimeSeconds);
    cachedFrameHit = renderHostPort.renderCachedFrame(sampleTimeSeconds);
    await waitForFrames(2, 160);
    if (!cachedFrameHit) {
      return {
        success: false,
        error: 'RAM preview composite cache did not contain the requested golden sample frame.',
        data: {
          projectId: PROJECT_ID,
          sampleTimeSeconds,
          cachedRanges: useTimelineStore.getState().getCachedRanges(),
          compositeCacheStats: renderHostPort.getCompositeCacheStats(),
        },
      };
    }
  }

  const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
  if (result.success && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return {
      ...result,
      data: {
        ...result.data,
        cachedFrameHit,
        ramPreviewRange: useTimelineStore.getState().ramPreviewRange,
        cachedRanges: useTimelineStore.getState().getCachedRanges(),
        compositeCacheStats: renderHostPort.getCompositeCacheStats(),
      },
    };
  }
  return result;
}

export async function handleRunWorkerFirstRamCacheGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstRamCacheGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the ram-cache golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, sample times, and target snapshots are controlled by the ram-cache manifest.',
    };
  }

  if (hasCallerCacheOverrideFields(args)) {
    return {
      success: false,
      error: 'The ram-cache preview range, cached frames, composite cache, and smoke path are controlled by the runner.',
    };
  }

  const manifest = getRamCacheManifest();
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
        const captureResult = await deps.captureGoldenFingerprint(captureArgsForSample(args, sampleTimeSeconds));
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
        ? { success: false, error: 'One or more ram-cache golden fixture captures failed.', data }
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
