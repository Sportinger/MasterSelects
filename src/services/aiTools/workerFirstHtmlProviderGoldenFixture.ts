import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineTrack } from '../../types/timeline';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { renderHostPort } from '../render/renderHostPort';
import {
  attachHtmlVideoRuntimeSourceToClip,
  importPublicVideoFixtureAsset,
} from './handlers/media/publicFixtureImport';
import {
  beginTimelineCanvasSmokeMutation,
  captureTimelineCanvasSmokeRestoreState,
  restoreTimelineCanvasSmokeState,
  waitForFrames,
  type TimelineCanvasSmokeRestoreResult,
  type TimelineCanvasSmokeRestoreState,
} from './handlers/smokes/smokeRuntime';
import type { ToolResult } from './types';
import { handleCaptureWorkerFirstGoldenFixtureFingerprint } from './workerFirstGoldenFixtureBridge';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

export interface WorkerFirstHtmlProviderFixtureSummary {
  readonly projectId: 'html-provider-fallback';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly videoClipId: string;
  readonly mediaId: string;
  readonly assetName: string;
  readonly htmlVideo: {
    readonly readyState: number;
    readonly width: number;
    readonly height: number;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstHtmlProviderGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'html-provider-fallback' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 3;
const DEFAULT_ASSET = {
  url: '/masterselects_github.mp4',
  name: 'wfg-html-provider-masterselects.mp4',
  fallbackDurationSeconds: 59.966,
};

const DEFAULT_DEPS: WorkerFirstHtmlProviderGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstHtmlProviderFixture(args),
  captureGoldenFingerprint: (args) => captureHtmlProviderGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getHtmlProviderManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('html-provider-fallback golden manifest is missing');
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

function createFixtureTracks(): TimelineTrack[] {
  return [
    { id: 'wfg-html-provider-track', name: 'WFG HTML Video', type: 'video', height: 88, muted: false, visible: true, solo: false },
  ];
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) return null;

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - html-provider-fallback',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - HTML provider fallback',
            width,
            height,
            duration: durationSeconds,
            frameRate: 30,
            backgroundColor: '#05070d',
          }
        : composition
    )),
    activeCompositionId,
    openCompositionIds: mediaState.openCompositionIds.includes(activeCompositionId)
      ? mediaState.openCompositionIds
      : [...mediaState.openCompositionIds, activeCompositionId],
  });

  return activeCompositionId;
}

export async function materializeWorkerFirstHtmlProviderFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getHtmlProviderManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const requestedDurationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);

  if (resetProject) {
    useMediaStore.getState().newProject();
    await waitForFrames(2, 180);
  } else {
    useTimelineStore.getState().pause();
  }

  const activeCompositionId = updateActiveComposition(width, height, requestedDurationSeconds);
  const tracks = createFixtureTracks();
  useTimelineStore.setState({
    tracks,
    clips: [],
    layers: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks: new Set(tracks.map((track) => track.id)),
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: requestedDurationSeconds,
    durationLocked: false,
    playheadPosition: 0,
    scrollX: 0,
    zoom: 170,
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
    isPlaying: false,
  });

  const imported = await importPublicVideoFixtureAsset(DEFAULT_ASSET.url, DEFAULT_ASSET.name);
  const estimatedDuration = imported.duration && Number.isFinite(imported.duration)
    ? imported.duration
    : DEFAULT_ASSET.fallbackDurationSeconds;
  const clipId = await useTimelineStore.getState().addClip(
    tracks[0].id,
    imported.source,
    0,
    estimatedDuration,
    imported.id,
    'video',
  );
  if (!clipId) {
    throw new Error('Failed to add html-provider-fallback fixture clip.');
  }

  const htmlVideo = await attachHtmlVideoRuntimeSourceToClip({
    clipId,
    file: imported.source,
    mediaId: imported.id,
    fallbackDurationSeconds: estimatedDuration,
  });

  const durationSeconds = Math.max(requestedDurationSeconds, htmlVideo.naturalDuration);
  useTimelineStore.getState().updateClip(clipId, {
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.78, y: 0.78 },
      position: { x: -0.08, y: 0.02, z: 0 },
    },
  });
  useTimelineStore.setState({
    duration: durationSeconds,
    durationLocked: true,
    selectedClipIds: new Set([clipId]),
    primarySelectedClipId: clipId,
    expandedTracks: new Set(useTimelineStore.getState().tracks.map((track) => track.id)),
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(6, 240);

  const summary: WorkerFirstHtmlProviderFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds,
    width,
    height,
    trackCount: useTimelineStore.getState().tracks.length,
    clipCount: useTimelineStore.getState().clips.length,
    videoClipId: clipId,
    mediaId: imported.id,
    assetName: imported.name,
    htmlVideo: {
      readyState: htmlVideo.readyState,
      width: htmlVideo.width,
      height: htmlVideo.height,
    },
    timelineSignals: ['html-video', 'video'],
  };

  return {
    success: true,
    data: summary,
  };
}

function hasCallerProofFields(args: Record<string, unknown>): boolean {
  return args.source !== undefined
    || args.fingerprint !== undefined
    || args.sampleTimeSeconds !== undefined;
}

function hasCallerAssetOverrideFields(args: Record<string, unknown>): boolean {
  return args.assetUrls !== undefined
    || args.paths !== undefined
    || args.files !== undefined
    || args.videoElement !== undefined
    || args.webCodecsPlayer !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 1200,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

async function captureHtmlProviderGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
  const sampleTimeSeconds = typeof args.sampleTimeSeconds === 'number' && Number.isFinite(args.sampleTimeSeconds)
    ? args.sampleTimeSeconds
    : null;
  if (sampleTimeSeconds !== null) {
    useTimelineStore.getState().setPlayheadPosition(sampleTimeSeconds);
    renderHostPort.requestNewFrameRender();
    await waitForFrames(12, 420);
  }
  return handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
}

export async function handleRunWorkerFirstHtmlProviderGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstHtmlProviderGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the html-provider-fallback golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the html-provider-fallback manifest.',
    };
  }

  if (hasCallerAssetOverrideFields(args)) {
    return {
      success: false,
      error: 'The html-provider-fallback fixture asset and provider handles are controlled by the runner.',
    };
  }

  const manifest = getHtmlProviderManifest();
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
        ? { success: false, error: 'One or more html-provider-fallback golden fixture captures failed.', data }
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
