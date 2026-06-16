import { useMediaStore } from '../../stores/mediaStore';
import type { Composition } from '../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { useTimelineStore } from '../../stores/timeline';
import type { Effect } from '../../types/effects';
import type { ClipMask } from '../../types/masks';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import type { TimelineTransition } from '../../types/timelineCore';
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

export interface WorkerFirstEffectsMasksTransitionsFixtureSummary {
  readonly projectId: 'effects-masks-transitions';
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly clipIds: {
    readonly outgoing: string;
    readonly incoming: string;
    readonly overlay: string;
  };
  readonly effectCount: number;
  readonly maskCount: number;
  readonly transitionCount: number;
  readonly blendMode: string;
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstEffectsMasksTransitionsGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'effects-masks-transitions' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 2;

const DEFAULT_DEPS: WorkerFirstEffectsMasksTransitionsGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstEffectsMasksTransitionsFixture(args),
  captureGoldenFingerprint: (args) => handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getEffectsMasksTransitionsManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('effects-masks-transitions golden manifest is missing');
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
    { id: 'wfg-emt-overlay-track', name: 'WFG Effects/Mask/Blend', type: 'video', height: 78, muted: false, visible: true, solo: false },
    { id: 'wfg-emt-transition-track', name: 'WFG Transition Base', type: 'video', height: 78, muted: false, visible: true, solo: false },
  ];
}

async function createFixtureImageElement(
  width: number,
  height: number,
  variant: 'outgoing' | 'incoming' | 'overlay',
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create 2D canvas context for effects-masks-transitions fixture image');
  }

  const gradient = context.createLinearGradient(0, 0, width, height);
  if (variant === 'outgoing') {
    gradient.addColorStop(0, '#24123d');
    gradient.addColorStop(1, '#d7572c');
  } else if (variant === 'incoming') {
    gradient.addColorStop(0, '#073f56');
    gradient.addColorStop(1, '#65d6b3');
  } else {
    gradient.addColorStop(0, 'rgba(255, 240, 102, 0.86)');
    gradient.addColorStop(1, 'rgba(79, 190, 255, 0.82)');
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.globalAlpha = variant === 'overlay' ? 0.82 : 1;
  context.fillStyle = variant === 'incoming' ? '#ffffff' : '#07131f';
  context.beginPath();
  context.arc(Math.round(width * 0.3), Math.round(height * 0.45), Math.round(height * 0.22), 0, Math.PI * 2);
  context.fill();
  context.fillStyle = variant === 'outgoing' ? '#ffffff' : '#162b52';
  context.fillRect(Math.round(width * 0.52), Math.round(height * 0.22), Math.round(width * 0.28), Math.round(height * 0.46));
  context.globalAlpha = 1;

  context.strokeStyle = variant === 'overlay' ? '#051927' : '#f5f0dc';
  context.lineWidth = Math.max(5, Math.round(width * 0.008));
  context.strokeRect(Math.round(width * 0.1), Math.round(height * 0.12), Math.round(width * 0.8), Math.round(height * 0.76));

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

function createFixtureEffects(): Effect[] {
  return [
    {
      id: 'wfg-emt-brightness',
      name: 'WFG Brightness',
      type: 'brightness',
      enabled: true,
      params: { amount: 0.12 },
    },
    {
      id: 'wfg-emt-saturation',
      name: 'WFG Saturation',
      type: 'saturation',
      enabled: true,
      params: { amount: 1.35 },
    },
  ];
}

function createFixtureMask(): ClipMask {
  return {
    id: 'wfg-emt-mask',
    name: 'WFG Diamond Mask',
    vertices: [
      { id: 'wfg-emt-mask-top', x: 0.5, y: 0.08, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'wfg-emt-mask-right', x: 0.88, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'wfg-emt-mask-bottom', x: 0.5, y: 0.92, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
      { id: 'wfg-emt-mask-left', x: 0.12, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 }, handleMode: 'none' },
    ],
    closed: true,
    opacity: 1,
    feather: 6,
    featherQuality: 1,
    inverted: false,
    mode: 'add',
    expanded: true,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
    outlineColor: '#ffef66',
  };
}

function createTransition(outgoingClipId: string, incomingClipId: string): {
  readonly outgoing: TimelineTransition;
  readonly incoming: TimelineTransition;
} {
  const transition = {
    id: 'transition-wfg-emt-crossfade',
    type: 'crossfade',
    duration: 0.8,
    params: { includeAudio: false },
  };
  return {
    outgoing: {
      ...transition,
      linkedClipId: incomingClipId,
    },
    incoming: {
      ...transition,
      linkedClipId: outgoingClipId,
    },
  };
}

function updateActiveComposition(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) return null;

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - effects-masks-transitions',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - effects/masks/transitions',
            width,
            height,
            duration: durationSeconds,
            frameRate: 30,
            backgroundColor: '#080c12',
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
  readonly durationSeconds: number;
  readonly outgoingImage: NonNullable<NonNullable<TimelineClip['source']>['imageElement']>;
  readonly incomingImage: NonNullable<NonNullable<TimelineClip['source']>['imageElement']>;
  readonly overlayImage: NonNullable<NonNullable<TimelineClip['source']>['imageElement']>;
}): WorkerFirstEffectsMasksTransitionsFixtureSummary['clipIds'] & { readonly clips: TimelineClip[] } {
  const outgoingClipId = 'wfg-emt-outgoing-clip';
  const incomingClipId = 'wfg-emt-incoming-clip';
  const overlayClipId = 'wfg-emt-overlay-clip';
  const transition = createTransition(outgoingClipId, incomingClipId);

  const outgoingClip: TimelineClip = {
    id: outgoingClipId,
    trackId: 'wfg-emt-transition-track',
    name: 'WFG Transition Outgoing',
    file: createFixtureAsset('wfg-emt-outgoing.png', 'image/png'),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: { type: 'image', imageElement: params.outgoingImage, naturalDuration: 1 },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    transitionOut: transition.outgoing,
    isLoading: false,
  };
  const incomingClip: TimelineClip = {
    id: incomingClipId,
    trackId: 'wfg-emt-transition-track',
    name: 'WFG Transition Incoming',
    file: createFixtureAsset('wfg-emt-incoming.png', 'image/png'),
    startTime: 1,
    duration: params.durationSeconds - 1,
    inPoint: 0,
    outPoint: params.durationSeconds - 1,
    source: { type: 'image', imageElement: params.incomingImage, naturalDuration: params.durationSeconds - 1 },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    transitionIn: transition.incoming,
    isLoading: false,
  };
  const overlayClip: TimelineClip = {
    id: overlayClipId,
    trackId: 'wfg-emt-overlay-track',
    name: 'WFG Effect Mask Blend Overlay',
    file: createFixtureAsset('wfg-emt-overlay.png', 'image/png'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: { type: 'image', imageElement: params.overlayImage, naturalDuration: params.durationSeconds },
    transform: {
      ...DEFAULT_TRANSFORM,
      opacity: 0.78,
      blendMode: 'screen',
      scale: { x: 0.72, y: 0.72 },
      position: { x: 0.04, y: 0.02, z: 0 },
    },
    effects: createFixtureEffects(),
    masks: [createFixtureMask()],
    isLoading: false,
  };

  return {
    outgoing: outgoingClip.id,
    incoming: incomingClip.id,
    overlay: overlayClip.id,
    clips: [overlayClip, outgoingClip, incomingClip],
  };
}

export async function materializeWorkerFirstEffectsMasksTransitionsFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const resetProject = args.resetProject !== false;
  const manifest = getEffectsMasksTransitionsManifest();
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
  const tracks = createFixtureTracks();
  const clipPlan = buildFixtureClips({
    durationSeconds,
    outgoingImage: await createFixtureImageElement(width, height, 'outgoing'),
    incomingImage: await createFixtureImageElement(width, height, 'incoming'),
    overlayImage: await createFixtureImageElement(width, height, 'overlay'),
  });

  useTimelineStore.setState({
    tracks,
    clips: clipPlan.clips,
    layers: [],
    selectedClipIds: new Set(clipPlan.clips.map((clip) => clip.id)),
    primarySelectedClipId: clipPlan.overlay,
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
  await waitForFrames(6, 220);

  const overlay = clipPlan.clips.find((clip) => clip.id === clipPlan.overlay);
  const summary: WorkerFirstEffectsMasksTransitionsFixtureSummary = {
    projectId: PROJECT_ID,
    activeCompositionId,
    durationSeconds,
    width,
    height,
    trackCount: tracks.length,
    clipCount: clipPlan.clips.length,
    clipIds: {
      outgoing: clipPlan.outgoing,
      incoming: clipPlan.incoming,
      overlay: clipPlan.overlay,
    },
    effectCount: overlay?.effects.length ?? 0,
    maskCount: overlay?.masks?.length ?? 0,
    transitionCount: 1,
    blendMode: overlay?.transform.blendMode ?? 'normal',
    timelineSignals: ['blend-mode', 'effect', 'image', 'mask', 'transition'],
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
  return args.clips !== undefined
    || args.effects !== undefined
    || args.masks !== undefined
    || args.transitions !== undefined
    || args.blendMode !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 500,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

export async function handleRunWorkerFirstEffectsMasksTransitionsGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstEffectsMasksTransitionsGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the effects-masks-transitions golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, and sample times are controlled by the effects-masks-transitions manifest.',
    };
  }

  if (hasCallerFixtureOverrideFields(args)) {
    return {
      success: false,
      error: 'The effects-masks-transitions fixture clips, effects, masks, transitions, and blend mode are controlled by the runner.',
    };
  }

  const manifest = getEffectsMasksTransitionsManifest();
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
        ? { success: false, error: 'One or more effects-masks-transitions golden fixture captures failed.', data }
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
