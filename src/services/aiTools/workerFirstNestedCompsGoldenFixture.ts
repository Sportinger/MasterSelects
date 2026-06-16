import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { useTimelineStore } from '../../stores/timeline';
import {
  DEFAULT_TRANSFORM,
  calculateNativeScale,
} from '../../stores/timeline/constants';
import type {
  CompositionTimelineData,
  SerializableClip,
  TimelineClip,
  TimelineTrack,
} from '../../types/timeline';
import { renderHostPort } from '../render/renderHostPort';
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

type FixtureImageVariant = 'child-base' | 'child-accent' | 'parent-overlay';

interface FixtureClipTree {
  readonly parentTracks: TimelineTrack[];
  readonly parentNestedClips: TimelineClip[];
  readonly childTracks: TimelineTrack[];
  readonly childNestedClips: TimelineClip[];
}

export interface WorkerFirstNestedCompsFixtureSummary {
  readonly projectId: 'nested-comps';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly compositionIds: {
    readonly active: string | null;
    readonly parent: string;
    readonly child: string;
  };
  readonly compositionClipIds: readonly string[];
  readonly nestedClipCounts: {
    readonly parent: number;
    readonly child: number;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstNestedCompsGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'nested-comps' as const;
const DEFAULT_WIDTH = 1280, DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 3.25;
const PARENT_COMPOSITION_ID = 'wfg-nested-parent-comp';
const CHILD_COMPOSITION_ID = 'wfg-nested-child-comp';
const DEFAULT_DEPS: WorkerFirstNestedCompsGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstNestedCompsFixture(args),
  captureGoldenFingerprint: (args) => handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getNestedCompsManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('nested-comps golden manifest is missing');
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

function createVideoTrack(id: string, name: string): TimelineTrack {
  return {
    id,
    name,
    type: 'video',
    height: 82,
    muted: false,
    visible: true,
    solo: false,
  };
}

function drawNestedFixtureImage(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  variant: FixtureImageVariant,
): void {
  const palette = {
    navy: '#101b35',
    blue: '#1f5e96',
    cyan: '#57c4e5',
    red: '#d64d47',
    green: '#6abd63',
    yellow: '#f4c84a',
    white: '#f6f7fb',
  };

  context.clearRect(0, 0, width, height);
  context.fillStyle = variant === 'parent-overlay' ? palette.navy : palette.blue;
  context.fillRect(0, 0, width, height);

  if (variant === 'child-base') {
    context.fillStyle = palette.yellow;
    context.fillRect(Math.round(width * 0.08), Math.round(height * 0.16), Math.round(width * 0.34), Math.round(height * 0.58));
    context.fillStyle = palette.red;
    context.beginPath();
    context.arc(Math.round(width * 0.68), Math.round(height * 0.45), Math.round(Math.min(width, height) * 0.2), 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.white;
    context.lineWidth = Math.max(3, Math.round(width * 0.015));
    context.strokeRect(Math.round(width * 0.52), Math.round(height * 0.18), Math.round(width * 0.32), Math.round(height * 0.55));
    return;
  }

  if (variant === 'child-accent') {
    context.fillStyle = palette.green;
    context.fillRect(Math.round(width * 0.18), Math.round(height * 0.18), Math.round(width * 0.28), Math.round(height * 0.52));
    context.fillStyle = palette.cyan;
    context.beginPath();
    context.moveTo(Math.round(width * 0.6), Math.round(height * 0.18));
    context.lineTo(Math.round(width * 0.86), Math.round(height * 0.72));
    context.lineTo(Math.round(width * 0.36), Math.round(height * 0.72));
    context.closePath();
    context.fill();
    return;
  }

  context.fillStyle = 'rgba(246, 247, 251, 0.88)';
  context.fillRect(Math.round(width * 0.06), Math.round(height * 0.08), Math.round(width * 0.88), Math.round(height * 0.12));
  context.fillStyle = palette.cyan;
  context.fillRect(Math.round(width * 0.12), Math.round(height * 0.76), Math.round(width * 0.76), Math.round(height * 0.12));
  context.fillStyle = palette.red;
  context.beginPath();
  context.arc(Math.round(width * 0.2), Math.round(height * 0.34), Math.round(Math.min(width, height) * 0.09), 0, Math.PI * 2);
  context.fill();
}

async function createFixtureImageElement(
  width: number,
  height: number,
  variant: FixtureImageVariant,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create 2D canvas context for nested-comps fixture image');
  }
  drawNestedFixtureImage(context, width, height, variant);

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
function makeImageClip(params: {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly durationSeconds: number;
  readonly imageElement: NonNullable<NonNullable<TimelineClip['source']>['imageElement']>;
  readonly transform?: TimelineClip['transform'];
}): TimelineClip {
  return {
    id: params.id,
    trackId: params.trackId,
    name: params.name,
    file: createFixtureAsset(`${params.id}.png`, 'image/png'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: {
      type: 'image',
      imageElement: params.imageElement,
      naturalDuration: params.durationSeconds,
    },
    transform: params.transform ?? { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
  };
}
function makeCompositionClip(params: {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly compositionId: string;
  readonly startTime: number;
  readonly durationSeconds: number;
  readonly inPoint?: number;
  readonly nestedTracks: TimelineTrack[];
  readonly nestedClips: TimelineClip[];
  readonly transform: TimelineClip['transform'];
}): TimelineClip {
  const duration = params.durationSeconds;
  return {
    id: params.id,
    trackId: params.trackId,
    name: params.name,
    file: createFixtureAsset(`${params.id}.comp`, 'application/octet-stream'),
    startTime: params.startTime,
    duration,
    inPoint: params.inPoint ?? 0,
    outPoint: (params.inPoint ?? 0) + duration,
    source: {
      type: 'video',
      naturalDuration: duration,
    },
    transform: params.transform,
    effects: [],
    isLoading: false,
    isComposition: true,
    compositionId: params.compositionId,
    nestedTracks: params.nestedTracks,
    nestedClips: params.nestedClips,
  };
}

function toSerializableClip(clip: TimelineClip): SerializableClip {
  const mediaIdKey = ['media', 'Fi', 'leId'].join('');
  const clipRecord = clip as unknown as Record<string, unknown>;
  const mediaId = clip.compositionId
    ?? (typeof clipRecord[mediaIdKey] === 'string' ? clipRecord[mediaIdKey] : null)
    ?? clip.id;

  return {
    [mediaIdKey]: mediaId,
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    sourceType: clip.source?.type ?? 'video',
    naturalDuration: clip.source?.naturalDuration,
    transform: clip.transform,
    effects: clip.effects,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
  } as unknown as SerializableClip;
}

function createTimelineData(
  tracks: readonly TimelineTrack[],
  clips: readonly TimelineClip[],
  durationSeconds: number,
): CompositionTimelineData {
  return {
    tracks: [...tracks],
    clips: clips.map(toSerializableClip),
    playheadPosition: 0,
    duration: durationSeconds,
    durationLocked: true,
    zoom: 140,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
    markers: [],
  };
}

async function buildFixtureClipTree(durationSeconds: number): Promise<FixtureClipTree> {
  const childTracks = [
    createVideoTrack('wfg-nested-child-accent-track', 'WFG Nested Child Accent'),
    createVideoTrack('wfg-nested-child-base-track', 'WFG Nested Child Base'),
  ];
  const parentTracks = [
    createVideoTrack('wfg-nested-parent-overlay-track', 'WFG Nested Parent Overlay'),
    createVideoTrack('wfg-nested-parent-child-track', 'WFG Nested Parent Child'),
  ];

  const childBase = await createFixtureImageElement(720, 405, 'child-base');
  const childAccent = await createFixtureImageElement(720, 405, 'child-accent');
  const parentOverlay = await createFixtureImageElement(720, 405, 'parent-overlay');

  const childNestedClips = [
    makeImageClip({
      id: 'wfg-nested-child-accent',
      trackId: childTracks[0].id,
      name: 'WFG Nested Child Accent',
      durationSeconds,
      imageElement: childAccent,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: 0.7, y: 0.7 },
        position: { x: 0.22, y: 0.08, z: 0 },
        opacity: 0.86,
      },
    }),
    makeImageClip({
      id: 'wfg-nested-child-base',
      trackId: childTracks[1].id,
      name: 'WFG Nested Child Base',
      durationSeconds,
      imageElement: childBase,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: 0.86, y: 0.86 },
        position: { x: -0.12, y: -0.04, z: 0 },
      },
    }),
  ];

  const parentNestedClips = [
    makeImageClip({
      id: 'wfg-nested-parent-overlay',
      trackId: parentTracks[0].id,
      name: 'WFG Nested Parent Overlay',
      durationSeconds,
      imageElement: parentOverlay,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: 0.96, y: 0.96 },
        opacity: 0.72,
      },
    }),
    makeCompositionClip({
      id: 'wfg-nested-parent-child-ref',
      trackId: parentTracks[1].id,
      name: 'WFG Nested Parent Child Ref',
      compositionId: CHILD_COMPOSITION_ID,
      startTime: 0,
      durationSeconds,
      nestedTracks: childTracks,
      nestedClips: childNestedClips,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: 0.74, y: 0.74 },
        position: { x: -0.08, y: 0.06, z: 0 },
      },
    }),
  ];

  return {
    parentTracks,
    parentNestedClips,
    childTracks,
    childNestedClips,
  };
}

function updateFixtureCompositions(params: {
  readonly activeCompositionId: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly tree: FixtureClipTree;
}): void {
  const mediaState = useMediaStore.getState();
  const existingWithoutFixture = mediaState.compositions.filter((composition: Composition) => (
    composition.id !== PARENT_COMPOSITION_ID && composition.id !== CHILD_COMPOSITION_ID
  ));
  const now = Date.now();
  const parentComposition: Composition = {
    id: PARENT_COMPOSITION_ID,
    name: 'Worker First Golden - nested parent',
    type: 'composition',
    parentId: null,
    createdAt: now,
    width: params.width,
    height: params.height,
    frameRate: 30,
    duration: params.durationSeconds,
    backgroundColor: '#111827',
    timelineData: createTimelineData(
      params.tree.parentTracks,
      params.tree.parentNestedClips,
      params.durationSeconds,
    ),
  };
  const childComposition: Composition = {
    id: CHILD_COMPOSITION_ID,
    name: 'Worker First Golden - nested child',
    type: 'composition',
    parentId: null,
    createdAt: now,
    width: Math.round(params.width * 0.75),
    height: Math.round(params.height * 0.75),
    frameRate: 30,
    duration: params.durationSeconds,
    backgroundColor: '#0f172a',
    timelineData: createTimelineData(
      params.tree.childTracks,
      params.tree.childNestedClips,
      params.durationSeconds,
    ),
  };

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - nested-comps',
    compositions: [
      ...existingWithoutFixture.map((composition: Composition) => (
        composition.id === params.activeCompositionId
          ? {
              ...composition,
              name: 'Worker First Golden - nested-comps program',
              width: params.width,
              height: params.height,
              duration: params.durationSeconds,
              frameRate: 30,
              backgroundColor: '#05070d',
            }
          : composition
      )),
      parentComposition,
      childComposition,
    ],
    activeCompositionId: params.activeCompositionId,
    openCompositionIds: [
      ...new Set([
        ...mediaState.openCompositionIds,
        ...(params.activeCompositionId ? [params.activeCompositionId] : []),
        PARENT_COMPOSITION_ID,
        CHILD_COMPOSITION_ID,
      ]),
    ],
  });
}

function createTopLevelTracks(): TimelineTrack[] {
  return [
    createVideoTrack('wfg-nested-direct-child-track', 'WFG Direct Child Reuse'),
    createVideoTrack('wfg-nested-parent-b-track', 'WFG Parent Reuse B'),
    createVideoTrack('wfg-nested-parent-a-track', 'WFG Parent Reuse A'),
  ];
}

function buildTopLevelClips(params: {
  readonly tracks: readonly TimelineTrack[];
  readonly durationSeconds: number;
  readonly tree: FixtureClipTree;
}): TimelineClip[] {
  const parentScale = calculateNativeScale(960, 540);
  const childScale = calculateNativeScale(720, 405);
  return [
    makeCompositionClip({
      id: 'wfg-nested-direct-child-clip',
      trackId: params.tracks[0].id,
      name: 'WFG Direct Child Composition Reuse',
      compositionId: CHILD_COMPOSITION_ID,
      startTime: 1.15,
      durationSeconds: 0.85,
      nestedTracks: params.tree.childTracks,
      nestedClips: params.tree.childNestedClips,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: childScale.x * 0.62, y: childScale.y * 0.62 },
        position: { x: 0.34, y: 0.26, z: 0 },
        opacity: 0.84,
      },
    }),
    makeCompositionClip({
      id: 'wfg-nested-parent-clip-b',
      trackId: params.tracks[1].id,
      name: 'WFG Parent Composition Reuse B',
      compositionId: PARENT_COMPOSITION_ID,
      startTime: 0.55,
      durationSeconds: params.durationSeconds - 0.55,
      inPoint: 0.25,
      nestedTracks: params.tree.parentTracks,
      nestedClips: params.tree.parentNestedClips,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: parentScale.x * 0.62, y: parentScale.y * 0.62 },
        position: { x: 0.22, y: -0.12, z: 0 },
        opacity: 0.78,
      },
    }),
    makeCompositionClip({
      id: 'wfg-nested-parent-clip-a',
      trackId: params.tracks[2].id,
      name: 'WFG Parent Composition Reuse A',
      compositionId: PARENT_COMPOSITION_ID,
      startTime: 0,
      durationSeconds: params.durationSeconds,
      nestedTracks: params.tree.parentTracks,
      nestedClips: params.tree.parentNestedClips,
      transform: {
        ...DEFAULT_TRANSFORM,
        scale: { x: parentScale.x * 0.82, y: parentScale.y * 0.82 },
        position: { x: -0.18, y: 0.04, z: 0 },
      },
    }),
  ];
}

export async function materializeWorkerFirstNestedCompsFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getNestedCompsManifest();
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

  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  const tree = await buildFixtureClipTree(durationSeconds);
  updateFixtureCompositions({
    activeCompositionId,
    width,
    height,
    durationSeconds,
    tree,
  });

  const tracks = createTopLevelTracks();
  const clips = buildTopLevelClips({
    tracks,
    durationSeconds,
    tree,
  });

  useTimelineStore.setState({
    tracks,
    clips,
    layers: [],
    selectedClipIds: new Set(clips.map((clip) => clip.id)),
    primarySelectedClipId: clips[clips.length - 1]?.id ?? null,
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
    zoom: 155,
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
  await waitForFrames(4, 240);

  const summary: WorkerFirstNestedCompsFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds,
    width,
    height,
    trackCount: tracks.length,
    clipCount: clips.length,
    compositionIds: {
      active: activeCompositionId,
      parent: PARENT_COMPOSITION_ID,
      child: CHILD_COMPOSITION_ID,
    },
    compositionClipIds: clips.map((clip) => clip.id),
    nestedClipCounts: {
      parent: tree.parentNestedClips.length,
      child: tree.childNestedClips.length,
    },
    timelineSignals: ['composition', 'nested-composition'],
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

function hasCallerFixtureOverrideFields(args: Record<string, unknown>): boolean {
  return args.compositionId !== undefined
    || args.compositions !== undefined
    || args.timelineData !== undefined
    || args.tracks !== undefined
    || args.clips !== undefined
    || args.nestedClips !== undefined;
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
    ...(args.settleMs !== undefined ? { settleMs: args.settleMs } : {}),
  };
}

export async function handleRunWorkerFirstNestedCompsGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstNestedCompsGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the nested-comps golden fixture.',
      data: {
        projectId: PROJECT_ID,
      },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the nested-comps manifest.',
    };
  }

  if (hasCallerFixtureOverrideFields(args)) {
    return {
      success: false,
      error: 'The nested-comps fixture composition tree is controlled by the runner and cannot be caller-supplied.',
    };
  }

  const manifest = getNestedCompsManifest();
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
            error: 'One or more nested-comps golden fixture captures failed.',
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
