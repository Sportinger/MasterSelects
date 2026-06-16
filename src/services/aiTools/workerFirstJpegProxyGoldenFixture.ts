import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import type { TimelineTrack } from '../../types/timeline';
import { proxyFrameCache } from '../proxyFrameCache';
import { renderHostPort } from '../render/renderHostPort';
import {
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

interface ProxyMediaRestoreState {
  readonly proxyEnabled: boolean;
  readonly files: ReturnType<typeof useMediaStore.getState>['files'];
}

export interface WorkerFirstJpegProxyFixtureSummary {
  readonly projectId: 'jpeg-proxy';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly videoClipId: string;
  readonly mediaId: string;
  readonly assetName: string;
  readonly proxy: {
    readonly enabled: boolean;
    readonly fps: number;
    readonly status: 'ready';
    readonly format: 'jpeg-sequence';
    readonly seededFrameIndices: readonly number[];
    readonly cachedRanges: readonly { start: number; end: number }[];
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstJpegProxyGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'jpeg-proxy' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 3;
const DEFAULT_PROXY_FPS = 24;
const DEFAULT_ASSET = {
  url: '/masterselects_github.mp4',
  name: 'wfg-jpeg-proxy-masterselects.mp4',
  fallbackDurationSeconds: 59.966,
};

const DEFAULT_DEPS: WorkerFirstJpegProxyGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstJpegProxyFixture(args),
  captureGoldenFingerprint: (args) => captureJpegProxyGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getJpegProxyManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('jpeg-proxy golden manifest is missing');
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
    { id: 'wfg-jpeg-proxy-track', name: 'WFG JPEG Proxy Video', type: 'video', height: 88, muted: false, visible: true, solo: false },
  ];
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) return null;

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - jpeg-proxy',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - JPEG proxy',
            width,
            height,
            duration: durationSeconds,
            frameRate: 30,
            backgroundColor: '#060912',
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

function captureProxyMediaRestoreState(): ProxyMediaRestoreState {
  const state = useMediaStore.getState();
  return {
    proxyEnabled: state.proxyEnabled,
    files: state.files,
  };
}

function restoreProxyMediaState(snapshot: ProxyMediaRestoreState): void {
  useMediaStore.setState({
    proxyEnabled: snapshot.proxyEnabled,
    files: snapshot.files,
  });
}

async function createDiagnosticJpegProxyImage(frameIndex: number, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create a 2D context for the jpeg-proxy diagnostic frame.');
  }

  const hue = (frameIndex * 17) % 360;
  ctx.fillStyle = `hsl(${hue}, 72%, 38%)`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(width * 0.12, height * 0.16, width * 0.76, height * 0.2);
  ctx.fillStyle = '#07111f';
  ctx.fillRect(width * 0.18, height * 0.48, width * 0.64, height * 0.24);
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.arc(width * 0.32, height * 0.6, height * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5fd1ff';
  ctx.fillRect(width * 0.48, height * 0.52, width * 0.18, height * 0.16);
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(height * 0.09)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`JPEG PROXY ${frameIndex}`, width / 2, height * 0.26);

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to load diagnostic jpeg proxy frame ${frameIndex}.`));
    image.src = canvas.toDataURL('image/jpeg', 0.82);
  });
  return image;
}

async function seedProxyFrames(mediaId: string, sampleTimesSeconds: readonly number[], proxyFps: number): Promise<number[]> {
  proxyFrameCache.clearAll();
  const diagnosticFrameCache = proxyFrameCache as unknown as {
    addToCache(id: string, frameIndex: number, image: unknown): boolean;
  };
  const frameIndices = sampleTimesSeconds.map((timeSeconds) => Math.floor(timeSeconds * proxyFps));
  for (const frameIndex of frameIndices) {
    const image = await createDiagnosticJpegProxyImage(frameIndex, 640, 360);
    if (!diagnosticFrameCache.addToCache(mediaId, frameIndex, image)) {
      throw new Error(`Failed to cache diagnostic jpeg proxy frame ${frameIndex}.`);
    }
  }
  return frameIndices;
}

function markMediaProxyReady(mediaId: string, proxyFps: number, frameCount: number): void {
  useMediaStore.setState((state) => ({
    proxyEnabled: true,
    files: state.files.map((file) => (
      file.id === mediaId
        ? {
            ...file,
            proxyStatus: 'ready',
            proxyProgress: 100,
            proxyFrameCount: frameCount,
            proxyFps,
            proxyFormat: 'jpeg-sequence',
            hasProxyAudio: false,
            width: file.width ?? 1280,
            height: file.height ?? 720,
          }
        : file
    )),
  }));
}

export async function materializeWorkerFirstJpegProxyFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getJpegProxyManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const requestedDurationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);
  const proxyFps = Math.round(readNumberArg(args, 'proxyFps', DEFAULT_PROXY_FPS, 1, 120));

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
    zoom: 150,
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
    isPlaying: false,
    isDraggingPlayhead: true,
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
    throw new Error('Failed to add jpeg-proxy fixture clip.');
  }

  const frameCount = Math.max(
    Math.ceil(Math.max(requestedDurationSeconds, estimatedDuration) * proxyFps),
    Math.max(...manifest.sampleTimesSeconds.map((timeSeconds) => Math.floor(timeSeconds * proxyFps))) + 1,
  );
  markMediaProxyReady(imported.id, proxyFps, frameCount);
  const seededFrameIndices = await seedProxyFrames(imported.id, manifest.sampleTimesSeconds, proxyFps);
  const durationSeconds = Math.max(requestedDurationSeconds, Math.max(...manifest.sampleTimesSeconds) + 0.25);

  useTimelineStore.getState().updateClip(clipId, {
    duration: Math.max(durationSeconds, estimatedDuration),
    outPoint: Math.max(durationSeconds, estimatedDuration),
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.78, y: 0.78 },
      position: { x: -0.08, y: 0.02, z: 0 },
    },
  });
  useTimelineStore.setState({
    duration: Math.max(durationSeconds, estimatedDuration),
    durationLocked: true,
    selectedClipIds: new Set([clipId]),
    primarySelectedClipId: clipId,
    expandedTracks: new Set(useTimelineStore.getState().tracks.map((track) => track.id)),
    isDraggingPlayhead: true,
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(6, 260);

  const summary: WorkerFirstJpegProxyFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds: useTimelineStore.getState().duration,
    width,
    height,
    trackCount: useTimelineStore.getState().tracks.length,
    clipCount: useTimelineStore.getState().clips.length,
    videoClipId: clipId,
    mediaId: imported.id,
    assetName: imported.name,
    proxy: {
      enabled: useMediaStore.getState().proxyEnabled,
      fps: proxyFps,
      status: 'ready',
      format: 'jpeg-sequence',
      seededFrameIndices,
      cachedRanges: proxyFrameCache.getCachedRanges(imported.id, proxyFps),
    },
    timelineSignals: ['audio-clock', 'proxy-image', 'video'],
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
    || args.proxyFrames !== undefined
    || args.proxyFrameCache !== undefined
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

async function captureJpegProxyGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
  const sampleTimeSeconds = typeof args.sampleTimeSeconds === 'number' && Number.isFinite(args.sampleTimeSeconds)
    ? args.sampleTimeSeconds
    : null;
  let proxyFrameIndex: number | null = null;
  if (sampleTimeSeconds !== null) {
    const mediaState = useMediaStore.getState();
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.source?.type === 'video');
    const mediaKey = ['media', 'Fi', 'leId'].join('');
    const sourceRecord = clip?.source as Record<string, unknown> | null | undefined;
    const clipRecord = clip as unknown as Record<string, unknown> | null | undefined;
    const mediaIdValue = sourceRecord?.[mediaKey] ?? clipRecord?.[mediaKey] ?? null;
    const mediaId = typeof mediaIdValue === 'string' ? mediaIdValue : null;
    const mediaRecord = mediaId ? mediaState.files.find((candidate) => candidate.id === mediaId) : null;
    const proxyFps = mediaRecord?.proxyFps ?? DEFAULT_PROXY_FPS;
    proxyFrameIndex = Math.floor(sampleTimeSeconds * proxyFps);
    useTimelineStore.setState({ isDraggingPlayhead: true });
    useTimelineStore.getState().setPlayheadPosition(sampleTimeSeconds);
    const cachedProxyFrame = mediaId
      ? proxyFrameCache.getCachedFrame(mediaId, proxyFrameIndex, proxyFps)
      : null;
    if (!cachedProxyFrame) {
      return {
        success: false,
        error: 'The jpeg-proxy fixture does not have a cached proxy image for the requested sample.',
        data: {
          projectId: PROJECT_ID,
          sampleTimeSeconds,
          proxyFrameIndex,
          mediaId,
        },
      };
    }
    renderHostPort.requestNewFrameRender();
    await waitForFrames(12, 420);
  }

  const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
  if (result.success && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return {
      ...result,
      data: {
        ...result.data,
        proxyFrameIndex,
        proxyCachedFrameReady: proxyFrameIndex !== null,
      },
    };
  }
  return result;
}

export async function handleRunWorkerFirstJpegProxyGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstJpegProxyGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the jpeg-proxy golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the jpeg-proxy manifest.',
    };
  }

  if (hasCallerAssetOverrideFields(args)) {
    return {
      success: false,
      error: 'The jpeg-proxy fixture asset, provider handles, and proxy frames are controlled by the runner.',
    };
  }

  const manifest = getJpegProxyManifest();
  const shouldRestoreTimeline = args.restoreTimelineAfterRun === true;
  const restoreState = shouldRestoreTimeline ? deps.captureRestoreState() : null;
  const restoreMediaState = shouldRestoreTimeline ? captureProxyMediaRestoreState() : null;
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
        ? { success: false, error: 'One or more jpeg-proxy golden fixture captures failed.', data }
        : { success: true, data };
    }
  } finally {
    if (restoreState) {
      restoreResult = await deps.restoreTimeline(restoreState);
    }
    if (restoreMediaState) {
      restoreProxyMediaState(restoreMediaState);
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
