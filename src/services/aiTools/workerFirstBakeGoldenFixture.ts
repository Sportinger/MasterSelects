import { useTimelineStore } from '../../stores/timeline';
import type { VideoBakeRegion } from '../../types/clipMetadata';
import { renderHostPort } from '../render/renderHostPort';
import { videoBakeProxyCache } from '../videoBakeProxyCache';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeRestoreState,
} from './handlers/smokes/smokeRuntime';
import type { ToolResult } from './types';
import {
  collectCurrentBakeSignals,
  collectCurrentRamCacheSignals,
  collectCurrentTimelineSignals,
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
} from './workerFirstGoldenFixtureBridge';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

interface BakeRange {
  readonly start: number;
  readonly end: number;
}

interface BakeRegionSummary {
  readonly regionId: string | null;
  readonly status: VideoBakeRegion['status'] | null;
  readonly progress: number | null;
  readonly range: BakeRange;
  readonly completed: boolean;
}

export interface WorkerFirstBakeFixtureSummary {
  readonly projectId: 'bake';
  readonly contentFixture: unknown;
  readonly clipBake: BakeRegionSummary & {
    readonly clipId: string | null;
    readonly trackId: string | null;
    readonly cachedFrameCount: number;
    readonly cachedRanges: readonly BakeRange[];
  };
  readonly compositionBake: BakeRegionSummary & {
    readonly proxyReady: boolean;
  };
  readonly compositeCacheStats: ReturnType<typeof renderHostPort.getCompositeCacheStats>;
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstBakeGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'bake' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 2.35;

const DEFAULT_DEPS: WorkerFirstBakeGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstBakeFixture(args),
  captureGoldenFingerprint: (args) => captureBakeGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getBakeManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('bake golden manifest is missing');
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

function getStatus(region: VideoBakeRegion | null): VideoBakeRegion['status'] | null {
  return region?.status ?? null;
}

function getProgress(region: VideoBakeRegion | null): number | null {
  return typeof region?.progress === 'number' && Number.isFinite(region.progress)
    ? region.progress
    : null;
}

function getClipBakeRegion(regionId: string | null): VideoBakeRegion | null {
  if (!regionId) return null;
  for (const clip of useTimelineStore.getState().clips) {
    const region = clip.videoState?.bakeRegions?.find((candidate) => candidate.id === regionId);
    if (region) return region;
  }
  return null;
}

function getCompositionBakeRegion(regionId: string | null): VideoBakeRegion | null {
  if (!regionId) return null;
  return useTimelineStore.getState().videoBakeRegions.find((region) => region.id === regionId) ?? null;
}

function combineSignals(...groups: readonly (readonly string[])[]): readonly string[] {
  return Array.from(new Set(groups.flat())).toSorted();
}

function summarizeBakeFixture(params: {
  readonly contentFixture: unknown;
  readonly clipId: string | null;
  readonly trackId: string | null;
  readonly clipRegionId: string | null;
  readonly compositionRegionId: string | null;
  readonly clipRange: BakeRange;
  readonly compositionRange: BakeRange;
  readonly clipCompleted: boolean;
  readonly compositionCompleted: boolean;
}): WorkerFirstBakeFixtureSummary {
  const timelineState = useTimelineStore.getState();
  const clipRegion = getClipBakeRegion(params.clipRegionId);
  const compositionRegion = getCompositionBakeRegion(params.compositionRegionId);
  const cachedRanges = timelineState.getCachedRanges();
  const compositeCacheStats = renderHostPort.getCompositeCacheStats();

  return {
    projectId: PROJECT_ID,
    contentFixture: params.contentFixture,
    clipBake: {
      regionId: params.clipRegionId,
      clipId: params.clipId,
      trackId: params.trackId,
      status: getStatus(clipRegion),
      progress: getProgress(clipRegion),
      range: params.clipRange,
      completed: params.clipCompleted,
      cachedFrameCount: timelineState.cachedFrameTimes.size,
      cachedRanges,
    },
    compositionBake: {
      regionId: params.compositionRegionId,
      status: getStatus(compositionRegion),
      progress: getProgress(compositionRegion),
      range: params.compositionRange,
      completed: params.compositionCompleted,
      proxyReady: params.compositionRegionId ? videoBakeProxyCache.has(params.compositionRegionId) : false,
    },
    compositeCacheStats,
    timelineSignals: combineSignals(
      collectCurrentTimelineSignals(timelineState.clips),
      collectCurrentBakeSignals({
        clips: timelineState.clips,
        videoBakeRegions: timelineState.videoBakeRegions,
      }),
      collectCurrentRamCacheSignals({
        ramPreviewRange: timelineState.ramPreviewRange,
        cachedFrameCount: timelineState.cachedFrameTimes.size,
        cachedRanges,
        isRamPreviewing: timelineState.isRamPreviewing,
        ramPreviewProgress: timelineState.ramPreviewProgress,
        compositeCacheStats,
      }),
    ),
  };
}

function findClipBakeTarget(): { readonly clipId: string; readonly trackId: string } | null {
  const timelineState = useTimelineStore.getState();
  const clip = timelineState.clips.find((candidate) => candidate.id === 'wfg-image-clip')
    ?? timelineState.clips.find((candidate) => candidate.source?.type !== 'audio');
  if (!clip) return null;
  return { clipId: clip.id, trackId: clip.trackId };
}

function failureResult(message: string, summary: WorkerFirstBakeFixtureSummary): ToolResult {
  return {
    success: false,
    error: message,
    data: summary,
  };
}

export async function materializeWorkerFirstBakeFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const manifest = getBakeManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);
  const compositionRange = {
    start: 0,
    end: Math.min(durationSeconds, Math.max(1.15, manifest.sampleTimesSeconds[1] + 0.15)),
  };
  const clipRange = {
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

  const compositionRegionId = useTimelineStore.getState().addCompositionVideoBakeRegion(
    compositionRange.start,
    compositionRange.end,
  );
  if (!compositionRegionId) {
    return failureResult(
      'Could not mark a composition video bake region for the bake golden fixture.',
      summarizeBakeFixture({
        contentFixture: contentResult.data,
        clipId: null,
        trackId: null,
        clipRegionId: null,
        compositionRegionId,
        clipRange,
        compositionRange,
        clipCompleted: false,
        compositionCompleted: false,
      }),
    );
  }

  const compositionCompleted = await useTimelineStore.getState().bakeCompositionVideoBakeRegion(compositionRegionId);
  const compositionRegion = getCompositionBakeRegion(compositionRegionId);
  const compositionProxyReady = videoBakeProxyCache.has(compositionRegionId);

  const bakeTarget = findClipBakeTarget();
  const clipRegionId = bakeTarget
    ? useTimelineStore.getState().addClipVideoBakeRegion(bakeTarget.clipId, {
        startTime: clipRange.start,
        endTime: clipRange.end,
        trackId: bakeTarget.trackId,
      })
    : null;
  const clipCompleted = bakeTarget && clipRegionId
    ? await useTimelineStore.getState().bakeClipVideoBakeRegion(bakeTarget.clipId, clipRegionId)
    : false;
  const clipRegion = getClipBakeRegion(clipRegionId);

  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 220);

  const summary = summarizeBakeFixture({
    contentFixture: contentResult.data,
    clipId: bakeTarget?.clipId ?? null,
    trackId: bakeTarget?.trackId ?? null,
    clipRegionId,
    compositionRegionId,
    clipRange,
    compositionRange,
    clipCompleted,
    compositionCompleted,
  });

  if (!compositionCompleted || compositionRegion?.status !== 'baked' || !compositionProxyReady) {
    return failureResult('Composition video bake did not produce a ready bake proxy artifact.', summary);
  }
  if (!clipCompleted || clipRegion?.status !== 'baked' || summary.clipBake.cachedFrameCount <= 0) {
    return failureResult('Clip video bake did not produce baked RAM-preview cache frames.', summary);
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

function hasCallerBakeOverrideFields(args: Record<string, unknown>): boolean {
  return args.clipId !== undefined
    || args.trackId !== undefined
    || args.regionId !== undefined
    || args.clipRegionId !== undefined
    || args.compositionRegionId !== undefined
    || args.videoBakeRegions !== undefined
    || args.bakeRegions !== undefined
    || args.clipBake !== undefined
    || args.compositionBake !== undefined
    || args.startTime !== undefined
    || args.endTime !== undefined
    || args.sourceInPoint !== undefined
    || args.sourceOutPoint !== undefined
    || args.clipBakeRange !== undefined
    || args.compositionBakeRange !== undefined
    || args.proxyReady !== undefined
    || args.videoBakeProxyCache !== undefined
    || args.cachedFrameTimes !== undefined
    || args.cachedRanges !== undefined
    || args.compositeCache !== undefined
    || args.compositeCacheStats !== undefined;
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

function getActiveCompositionBakeAtSample(sampleTimeSeconds: number | null): VideoBakeRegion | null {
  if (sampleTimeSeconds === null) return null;
  return useTimelineStore.getState().videoBakeRegions.find((region) => (
    region.scope === 'composition'
    && region.status === 'baked'
    && sampleTimeSeconds >= region.startTime
    && sampleTimeSeconds < region.endTime
  )) ?? null;
}

async function captureBakeGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
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
        error: 'Clip video bake cache did not contain the requested golden sample frame.',
        data: {
          projectId: PROJECT_ID,
          sampleTimeSeconds,
          cachedRanges: useTimelineStore.getState().getCachedRanges(),
          compositeCacheStats: renderHostPort.getCompositeCacheStats(),
        },
      };
    }
  }

  const activeCompositionBake = getActiveCompositionBakeAtSample(sampleTimeSeconds);
  const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
  if (result.success && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return {
      ...result,
      data: {
        ...result.data,
        cachedFrameHit,
        activeCompositionBakeRegionId: activeCompositionBake?.id ?? null,
        activeCompositionBakeProxyReady: activeCompositionBake
          ? videoBakeProxyCache.has(activeCompositionBake.id)
          : false,
        cachedRanges: useTimelineStore.getState().getCachedRanges(),
        compositeCacheStats: renderHostPort.getCompositeCacheStats(),
      },
    };
  }
  return result;
}

export async function handleRunWorkerFirstBakeGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstBakeGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the bake golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, sample times, and target snapshots are controlled by the bake manifest.',
    };
  }

  if (hasCallerBakeOverrideFields(args)) {
    return {
      success: false,
      error: 'Clip bake regions, composition bake regions, bake proxy state, and cached frames are controlled by the bake runner.',
    };
  }

  const manifest = getBakeManifest();
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
        ? { success: false, error: 'One or more bake golden fixture captures failed.', data }
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
