import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineTrack } from '../../types/timeline';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { renderHostPort } from '../render/renderHostPort';
import { importPublicVideoFixtureAsset } from './handlers/media/publicFixtureImport';
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

interface MultiVideoAsset {
  readonly url: string;
  readonly name: string;
  readonly fallbackDurationSeconds: number;
  readonly trackId: string;
  readonly transform: typeof DEFAULT_TRANSFORM;
}

export interface WorkerFirstMultiVideoFixtureSummary {
  readonly projectId: 'multi-video';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly videoClipIds: readonly string[];
  readonly mediaIds: readonly string[];
  readonly assetNames: readonly string[];
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstMultiVideoGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'multi-video' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_ASSETS: readonly MultiVideoAsset[] = [
  {
    url: '/masterselects_github.mp4',
    name: 'wfg-masterselects-github.mp4',
    fallbackDurationSeconds: 59.966,
    trackId: 'wfg-multi-video-track-a',
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.72, y: 0.72 },
      position: { x: -0.2, y: -0.08, z: 0 },
    },
  },
  {
    url: '/clippy.webm',
    name: 'wfg-clippy-main.webm',
    fallbackDurationSeconds: 10.084,
    trackId: 'wfg-multi-video-track-b',
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.48, y: 0.48 },
      position: { x: 0.36, y: 0.1, z: 0 },
    },
  },
  {
    url: '/clippy-intro.webm',
    name: 'wfg-clippy-intro.webm',
    fallbackDurationSeconds: 4.834,
    trackId: 'wfg-multi-video-track-c',
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.36, y: 0.36 },
      position: { x: 0.08, y: 0.36, z: 0 },
    },
  },
];

const DEFAULT_DEPS: WorkerFirstMultiVideoGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstMultiVideoFixture(args),
  captureGoldenFingerprint: (args) => captureMultiVideoGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getMultiVideoManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('multi-video golden manifest is missing');
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
    { id: 'wfg-multi-video-track-c', name: 'WFG Video C', type: 'video', height: 88, muted: false, visible: true, solo: false },
    { id: 'wfg-multi-video-track-b', name: 'WFG Video B', type: 'video', height: 88, muted: false, visible: true, solo: false },
    { id: 'wfg-multi-video-track-a', name: 'WFG Video A', type: 'video', height: 88, muted: false, visible: true, solo: false },
  ];
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) {
    return null;
  }

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - multi-video',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - multi-video',
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

function clipEndTime(clipId: string, fallbackStartTime: number, fallbackDuration: number): number {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return fallbackStartTime + fallbackDuration;
  }
  return clip.startTime + clip.duration;
}

async function materializeVideoAssets(assets: readonly MultiVideoAsset[]): Promise<{
  readonly videoClipIds: readonly string[];
  readonly mediaIds: readonly string[];
  readonly assetNames: readonly string[];
  readonly totalDurationSeconds: number;
}> {
  const videoClipIds: string[] = [];
  const mediaIds: string[] = [];
  const assetNames: string[] = [];
  let totalDurationSeconds = 0;

  for (const asset of assets) {
    const imported = await importPublicVideoFixtureAsset(asset.url, asset.name);
    const estimatedDuration = imported.duration && Number.isFinite(imported.duration)
      ? imported.duration
      : asset.fallbackDurationSeconds;
    const clipId = await useTimelineStore.getState().addClip(
      asset.trackId,
      imported.source,
      0,
      estimatedDuration,
      imported.id,
      'video',
    );
    if (!clipId) {
      throw new Error(`Failed to add multi-video fixture clip for ${asset.name}.`);
    }
    useTimelineStore.getState().updateClip(clipId, {
      transform: asset.transform,
    });
    videoClipIds.push(clipId);
    mediaIds.push(imported.id);
    assetNames.push(imported.name);
    totalDurationSeconds = Math.max(totalDurationSeconds, clipEndTime(clipId, 0, estimatedDuration));
  }

  return {
    videoClipIds,
    mediaIds,
    assetNames,
    totalDurationSeconds,
  };
}

export async function materializeWorkerFirstMultiVideoFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getMultiVideoManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const requestedDurationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 60);

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
    zoom: 110,
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
    isPlaying: false,
  });

  const placed = await materializeVideoAssets(DEFAULT_ASSETS);
  const durationSeconds = Math.max(requestedDurationSeconds, placed.totalDurationSeconds);
  const finalTracks = useTimelineStore.getState().tracks;
  useTimelineStore.setState({
    duration: durationSeconds,
    durationLocked: true,
    selectedClipIds: new Set(placed.videoClipIds),
    primarySelectedClipId: placed.videoClipIds[0] ?? null,
    expandedTracks: new Set(finalTracks.map((track) => track.id)),
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 240);

  const summary: WorkerFirstMultiVideoFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds,
    width,
    height,
    trackCount: useTimelineStore.getState().tracks.length,
    clipCount: useTimelineStore.getState().clips.length,
    videoClipIds: placed.videoClipIds,
    mediaIds: placed.mediaIds,
    assetNames: placed.assetNames,
    timelineSignals: ['audio-clock', 'video'],
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
    || args.files !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 1600,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

async function captureMultiVideoGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
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

export async function handleRunWorkerFirstMultiVideoGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstMultiVideoGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the multi-video golden fixture.',
      data: {
        projectId: PROJECT_ID,
      },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the multi-video manifest.',
    };
  }

  if (hasCallerAssetOverrideFields(args)) {
    return {
      success: false,
      error: 'The multi-video fixture asset list is controlled by the runner and cannot be caller-supplied.',
    };
  }

  const manifest = getMultiVideoManifest();
  const shouldRestoreTimeline = args.restoreTimelineAfterRun === true;
  const restoreState = shouldRestoreTimeline ? deps.captureRestoreState() : null;
  const endMutation = deps.beginMutation();
  let restoreResult: TimelineCanvasSmokeRestoreResult | null = null;
  let result: ToolResult;

  try {
    const fixtureResult = await deps.materializeFixture({
      ...args,
      projectId: PROJECT_ID,
    });
    if (!fixtureResult.success) {
      result = fixtureResult;
    } else {
      const captureResults: ToolResult[] = [];
      const failures: ToolResult[] = [];
      for (const sampleTimeSeconds of manifest.sampleTimesSeconds) {
        const captureResult = await deps.captureGoldenFingerprint(captureArgsForSample(args, sampleTimeSeconds));
        captureResults.push(captureResult);
        if (!captureResult.success) {
          failures.push(captureResult);
        }
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
        ? {
            success: false,
            error: 'One or more multi-video golden fixture captures failed.',
            data,
          }
        : {
            success: true,
            data,
          };
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
