import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { renderHostPort } from '../render/renderHostPort';
import {
  attachWebCodecsRuntimeSourceToClip,
  enableWebCodecsFixtureFlags,
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

export interface WorkerFirstWebCodecsProviderFixtureSummary {
  readonly projectId: 'webcodecs-provider';
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
  readonly webCodecs: {
    readonly ready: boolean;
    readonly fullMode: boolean;
    readonly hasFrame: boolean;
    readonly width: number;
    readonly height: number;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstWebCodecsProviderGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly enableFixtureFlags: () => () => void;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'webcodecs-provider' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 2.25;
const DEFAULT_ASSET = {
  url: '/masterselects_github.mp4',
  name: 'wfg-webcodecs-provider-masterselects.mp4',
  fallbackDurationSeconds: 59.966,
};

const DEFAULT_DEPS: WorkerFirstWebCodecsProviderGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstWebCodecsProviderFixture(args),
  captureGoldenFingerprint: (args) => captureWebCodecsProviderGoldenFingerprint(args),
  enableFixtureFlags: () => enableWebCodecsFixtureFlags(),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getWebCodecsProviderManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('webcodecs-provider golden manifest is missing');
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
    { id: 'wfg-webcodecs-provider-track', name: 'WFG WebCodecs Video', type: 'video', height: 88, muted: false, visible: true, solo: false },
  ];
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) return null;

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - webcodecs-provider',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - WebCodecs provider',
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

export async function materializeWorkerFirstWebCodecsProviderFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return materializeWorkerFirstWebCodecsProviderFixtureWithOptions(args, {
    prepareSequentialExport: true,
  });
}

export async function materializeWorkerFirstWebCodecsProviderShadowFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return materializeWorkerFirstWebCodecsProviderFixtureWithOptions(args, {
    prepareSequentialExport: false,
  });
}

async function materializeWorkerFirstWebCodecsProviderFixtureWithOptions(
  args: Record<string, unknown>,
  options: { readonly prepareSequentialExport: boolean },
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getWebCodecsProviderManifest();
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
  const clipId = 'wfg-webcodecs-provider-clip';
  const clip: TimelineClip = {
    id: clipId,
    trackId: tracks[0].id,
    name: imported.name,
    file: imported.source,
    startTime: 0,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: {
      type: 'video',
      naturalDuration: estimatedDuration,
    },
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.78, y: 0.78 },
      position: { x: -0.08, y: 0.02, z: 0 },
    },
    effects: [],
    isLoading: true,
  };
  useTimelineStore.setState({
    clips: [clip],
  });

  const runtime = await attachWebCodecsRuntimeSourceToClip({
    clipId,
    file: imported.source,
    mediaId: imported.id,
    fileName: imported.name,
    fallbackDurationSeconds: estimatedDuration,
    includeHtmlVideoElement: false,
    prepareSequentialExport: options.prepareSequentialExport,
  });

  const durationSeconds = Math.max(requestedDurationSeconds, runtime.naturalDuration);
  useTimelineStore.setState({
    duration: durationSeconds,
    durationLocked: true,
    selectedClipIds: new Set([clipId]),
    primarySelectedClipId: clipId,
    expandedTracks: new Set(useTimelineStore.getState().tracks.map((track) => track.id)),
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(8, 260);

  const summary: WorkerFirstWebCodecsProviderFixtureSummary = {
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
      readyState: runtime.readyState,
      width: runtime.width,
      height: runtime.height,
    },
    webCodecs: {
      ready: runtime.webCodecsReady,
      fullMode: runtime.webCodecsFullMode,
      hasFrame: runtime.webCodecsHasFrame,
      width: runtime.webCodecsWidth,
      height: runtime.webCodecsHeight,
    },
    timelineSignals: ['video', 'webcodecs'],
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
    settleMs: args.settleMs ?? 1500,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

async function seekWebCodecsFixtureProvider(sampleTimeSeconds: number): Promise<void> {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.source?.webCodecsPlayer);
  const provider = clip?.source?.webCodecsPlayer;
  if (!provider?.isFullMode?.()) {
    throw new Error('The webcodecs-provider fixture does not expose a full-mode WebCodecs provider.');
  }

  const hasFreshFrame = () => (
    provider.hasFrame?.() === true &&
    Number.isFinite(provider.currentTime) &&
    Math.abs(provider.currentTime - sampleTimeSeconds) <= 0.25
  );

  const waitForFreshFrame = async (timeoutMs: number): Promise<boolean> => {
    if (hasFreshFrame()) return true;
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const poll = () => {
        if (hasFreshFrame() || performance.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(poll, 16);
      };
      poll();
    });
    return hasFreshFrame();
  };

  if (typeof provider.seekDuringExport === 'function') {
    await provider.seekDuringExport(sampleTimeSeconds);
    if (await waitForFreshFrame(750)) {
      return;
    }
  }

  provider.seek?.(sampleTimeSeconds, { previewMode: 'interactive' });
  if (await waitForFreshFrame(2500)) {
    return;
  }

  if (typeof provider.seekAsync === 'function') {
    await provider.seekAsync(sampleTimeSeconds);
    if (await waitForFreshFrame(750)) {
      return;
    }
  }

  throw new Error('The webcodecs-provider fixture did not produce a fresh WebCodecs frame for the sample.');
}

async function captureWebCodecsProviderGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
  const sampleTimeSeconds = typeof args.sampleTimeSeconds === 'number' && Number.isFinite(args.sampleTimeSeconds)
    ? args.sampleTimeSeconds
    : null;
  if (sampleTimeSeconds !== null) {
    useTimelineStore.getState().setPlayheadPosition(sampleTimeSeconds);
    await seekWebCodecsFixtureProvider(sampleTimeSeconds);
    renderHostPort.requestNewFrameRender();
    await waitForFrames(14, 500);
  }
  return handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
}

export async function handleRunWorkerFirstWebCodecsProviderGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstWebCodecsProviderGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the webcodecs-provider golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the webcodecs-provider manifest.',
    };
  }

  if (hasCallerAssetOverrideFields(args)) {
    return {
      success: false,
      error: 'The webcodecs-provider fixture asset and provider handles are controlled by the runner.',
    };
  }

  const manifest = getWebCodecsProviderManifest();
  const shouldRestoreTimeline = args.restoreTimelineAfterRun === true;
  const restoreState = shouldRestoreTimeline ? deps.captureRestoreState() : null;
  const restoreFlags = deps.enableFixtureFlags();
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
        ? { success: false, error: 'One or more webcodecs-provider golden fixture captures failed.', data }
        : { success: true, data };
    }
  } finally {
    if (restoreState) {
      restoreResult = await deps.restoreTimeline(restoreState);
    }
    restoreFlags();
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
