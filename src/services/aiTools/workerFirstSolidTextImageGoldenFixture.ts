import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { renderHostPort } from '../render/renderHostPort';
import {
  createTimelineSolidCanvasRuntime,
  createTimelineTextCanvasRuntime,
} from '../timeline/timelineGeneratedCanvasRuntime';
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

export interface WorkerFirstSolidTextImageFixtureSummary {
  readonly projectId: 'solid-text-image';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly clipIds: {
    readonly solid: string;
    readonly image: string;
    readonly text: string;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstSolidTextImageGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'solid-text-image' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 1.25;

const DEFAULT_DEPS: WorkerFirstSolidTextImageGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstSolidTextImageFixture(args),
  captureGoldenFingerprint: (args) => handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getSolidTextImageManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('solid-text-image golden manifest is missing');
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

function createFixtureAsset(name: string, type: string): TimelineClip['file'] {
  return { name, size: 0, type } as TimelineClip['file'];
}

function createFixtureTracks(): TimelineTrack[] {
  return [
    { id: 'wfg-text-track', name: 'WFG Text', type: 'video', height: 70, muted: false, visible: true, solo: false },
    { id: 'wfg-image-track', name: 'WFG Image', type: 'video', height: 70, muted: false, visible: true, solo: false },
    { id: 'wfg-solid-track', name: 'WFG Solid', type: 'video', height: 70, muted: false, visible: true, solo: false },
  ];
}

async function createFixtureImageElement(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create 2D canvas context for solid-text-image fixture image');
  }

  context.fillStyle = '#174a7c';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#f0c13a';
  context.fillRect(Math.round(width * 0.12), Math.round(height * 0.16), Math.round(width * 0.28), Math.round(height * 0.5));
  context.fillStyle = '#d7443e';
  context.beginPath();
  context.arc(Math.round(width * 0.66), Math.round(height * 0.48), Math.round(Math.min(width, height) * 0.18), 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#ffffff';
  context.lineWidth = Math.max(4, Math.round(width * 0.012));
  context.strokeRect(Math.round(width * 0.48), Math.round(height * 0.18), Math.round(width * 0.34), Math.round(height * 0.58));

  const image = new Image();
  image.decoding = 'sync';
  const dataUrl = canvas.toDataURL('image/png');
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = dataUrl;
  });
  if (typeof image.decode === 'function') {
    await image.decode().catch(() => undefined);
  }
  return image;
}

function createTextProperties(width: number, height: number): TextClipProperties {
  return {
    ...DEFAULT_TEXT_PROPERTIES,
    text: 'Worker First\nGolden',
    fontSize: Math.round(Math.max(48, Math.min(width, height) * 0.1)),
    fontWeight: 700,
    color: '#ffffff',
    strokeEnabled: true,
    strokeColor: '#0a0f1f',
    strokeWidth: 5,
    shadowEnabled: true,
    shadowColor: 'rgba(0, 0, 0, 0.45)',
    shadowOffsetX: 5,
    shadowOffsetY: 5,
    shadowBlur: 10,
    boxEnabled: true,
    boxX: Math.round(width * 0.08),
    boxY: Math.round(height * 0.08),
    boxWidth: Math.round(width * 0.84),
    boxHeight: Math.round(height * 0.3),
  };
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) {
    return null;
  }

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - solid-text-image',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - solid/text/image',
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

function buildFixtureClips(params: {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly solidCanvas: HTMLCanvasElement;
  readonly textCanvas: HTMLCanvasElement;
  readonly textProperties: TextClipProperties;
  readonly imageElement: NonNullable<NonNullable<TimelineClip['source']>['imageElement']>;
}): WorkerFirstSolidTextImageFixtureSummary['clipIds'] & { readonly clips: TimelineClip[] } {
  const solidClip: TimelineClip = {
    id: 'wfg-solid-clip',
    trackId: 'wfg-solid-track',
    name: 'WFG Solid Background',
    file: createFixtureAsset('wfg-solid.dat', 'application/octet-stream'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: { type: 'solid', textCanvas: params.solidCanvas, naturalDuration: params.durationSeconds },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    solidColor: '#13233f',
    isLoading: false,
  };
  const imageClip: TimelineClip = {
    id: 'wfg-image-clip',
    trackId: 'wfg-image-track',
    name: 'WFG Image Signal',
    file: createFixtureAsset('wfg-image.png', 'image/png'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: {
      type: 'image',
      imageElement: params.imageElement,
      naturalDuration: params.durationSeconds,
    },
    transform: {
      ...DEFAULT_TRANSFORM,
      scale: { x: 0.58, y: 0.58 },
      position: { x: -0.18, y: 0.08, z: 0 },
    },
    effects: [],
    isLoading: false,
  };
  const textClip: TimelineClip = {
    id: 'wfg-text-clip',
    trackId: 'wfg-text-track',
    name: 'WFG Text Signal',
    file: createFixtureAsset('wfg-text.txt', 'text/plain'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: { type: 'text', textCanvas: params.textCanvas, naturalDuration: params.durationSeconds },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    textProperties: params.textProperties,
    isLoading: false,
  };

  return {
    solid: solidClip.id,
    image: imageClip.id,
    text: textClip.id,
    clips: [textClip, imageClip, solidClip],
  };
}

export async function materializeWorkerFirstSolidTextImageFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getSolidTextImageManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 10);

  if (resetProject) {
    useMediaStore.getState().newProject();
    await waitForFrames(2, 180);
  } else {
    useTimelineStore.getState().pause();
  }

  const activeCompositionId = updateActiveComposition(width, height, durationSeconds);
  const solidCanvas = createTimelineSolidCanvasRuntime({
    color: '#13233f',
    dimensions: { width, height },
  });
  const imageElement = await createFixtureImageElement(width, height);
  const textRuntime = await createTimelineTextCanvasRuntime({
    textProperties: createTextProperties(width, height),
    dimensions: { width, height },
  });
  const tracks = createFixtureTracks();
  const clipPlan = buildFixtureClips({
    width,
    height,
    durationSeconds,
    solidCanvas,
    textCanvas: textRuntime.canvas,
    textProperties: textRuntime.textProperties,
    imageElement,
  });

  useTimelineStore.setState({
    tracks,
    clips: clipPlan.clips,
    layers: [],
    selectedClipIds: new Set(clipPlan.clips.map((clip) => clip.id)),
    primarySelectedClipId: clipPlan.text,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks: new Set(tracks.map((track) => track.id)),
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
    scrollX: 0,
    zoom: 180,
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
    isPlaying: false,
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(3, 180);

  const summary: WorkerFirstSolidTextImageFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds,
    width,
    height,
    trackCount: tracks.length,
    clipCount: clipPlan.clips.length,
    clipIds: {
      solid: clipPlan.solid,
      image: clipPlan.image,
      text: clipPlan.text,
    },
    timelineSignals: ['image', 'solid', 'text'],
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

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

export async function handleRunWorkerFirstSolidTextImageGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstSolidTextImageGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the solid-text-image golden fixture.',
      data: {
        projectId: PROJECT_ID,
      },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the solid-text-image manifest.',
    };
  }

  const manifest = getSolidTextImageManifest();
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
            error: 'One or more solid-text-image golden fixture captures failed.',
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
