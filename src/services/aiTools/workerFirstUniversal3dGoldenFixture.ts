import { useMediaStore } from '../../stores/mediaStore';
import type { Composition, SignalAssetItem } from '../../stores/mediaStore/types';
import { createSignalAssetItem, mergeSignalArtifacts } from '../../stores/mediaStore/helpers/signalItems';
import { useTimelineStore } from '../../stores/timeline';
import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import type { TextClipProperties } from '../../types/text';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';
import { normalizeSignalAsset } from '../../signals';
import { renderHostPort } from '../render/renderHostPort';
import {
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
import {
  collectCurrentTimelineSignals,
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
} from './workerFirstGoldenFixtureBridge';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

export interface WorkerFirstUniversal3dFixtureSummary {
  readonly projectId: 'universal-3d-gaussian-cad';
  readonly contentFixture: unknown;
  readonly activeCompositionId: string | null;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly trackCount: number;
  readonly clipCount: number;
  readonly clipIds: {
    readonly model: string;
    readonly gaussian: string;
    readonly cad: string;
  };
  readonly signalAssetIds: {
    readonly gaussian: string;
    readonly cad: string;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstUniversal3dGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'universal-3d-gaussian-cad' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 2.35;

const DEFAULT_DEPS: WorkerFirstUniversal3dGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstUniversal3dFixture(args),
  captureGoldenFingerprint: (args) => handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getUniversal3dManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('universal-3d-gaussian-cad golden manifest is missing');
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

function createFixtureHash(seed: string): string {
  const hex = Array.from(seed)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex.padEnd(64, '0').slice(0, 64)}`;
}

function createUniversalTracks(): TimelineTrack[] {
  return [
    { id: 'wfg-cad-track', name: 'WFG CAD Signal', type: 'video', height: 70, muted: false, visible: true, solo: false },
    { id: 'wfg-gaussian-track', name: 'WFG Gaussian Signal', type: 'video', height: 70, muted: false, visible: true, solo: false },
    { id: 'wfg-model-track', name: 'WFG 3D Mesh Signal', type: 'video', height: 70, muted: false, visible: true, solo: false },
  ];
}

function createSignalAsset(params: {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly refs: readonly { readonly id: string; readonly kind: 'point-cloud' | 'geometry' | 'mesh' | 'binary' | 'metadata' }[];
  readonly metadata: Record<string, string>;
}): SignalAssetItem {
  const asset = normalizeSignalAsset({
    id: params.id,
    name: params.name,
    source: {
      kind: 'generated',
      fileName: params.fileName,
      extension: params.extension,
      mimeType: params.mimeType,
      providerId: 'masterselects.worker-first.fixture',
    },
    refs: params.refs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      artifactId: `${params.id}:artifact`,
      mimeType: params.mimeType,
      metadata: {
        ...params.metadata,
        fileName: params.fileName,
        extension: params.extension,
      },
    })),
    artifacts: [{
      artifactId: `${params.id}:artifact`,
      hash: createFixtureHash(params.id),
      size: 96,
      mimeType: params.mimeType,
      encoding: 'raw',
      storage: { kind: 'memory' },
      producer: { providerId: 'masterselects.worker-first.fixture' },
      metadata: {
        ...params.metadata,
        fileName: params.fileName,
        extension: params.extension,
      },
    }],
    metadata: params.metadata,
    createdAt: '2026-06-16T00:00:00.000Z',
  }, {
    now: () => '2026-06-16T00:00:00.000Z',
  });
  return createSignalAssetItem(asset, {
    createdAt: 0,
    providerId: 'masterselects.worker-first.fixture',
  });
}

function createUniversalSignalAssets(): {
  readonly gaussian: SignalAssetItem;
  readonly cad: SignalAssetItem;
} {
  return {
    gaussian: createSignalAsset({
      id: 'wfg-gaussian-signal-asset',
      name: 'WFG Gaussian Splat Signal',
      fileName: 'wfg-gaussian.splat',
      extension: 'splat',
      mimeType: 'application/octet-stream',
      refs: [
        { id: 'wfg-gaussian-signal-asset:point-cloud', kind: 'point-cloud' },
        { id: 'wfg-gaussian-signal-asset:geometry', kind: 'geometry' },
        { id: 'wfg-gaussian-signal-asset:metadata', kind: 'metadata' },
      ],
      metadata: {
        formatFamily: 'point-cloud',
        fixtureRole: 'worker-first-gaussian-descriptor',
      },
    }),
    cad: createSignalAsset({
      id: 'wfg-cad-signal-asset',
      name: 'WFG CAD Technical Geometry',
      fileName: 'wfg-cad.dxf',
      extension: 'dxf',
      mimeType: 'image/vnd.dxf',
      refs: [
        { id: 'wfg-cad-signal-asset:geometry', kind: 'geometry' },
        { id: 'wfg-cad-signal-asset:mesh', kind: 'mesh' },
        { id: 'wfg-cad-signal-asset:binary', kind: 'binary' },
        { id: 'wfg-cad-signal-asset:metadata', kind: 'metadata' },
      ],
      metadata: {
        formatFamily: 'cad-technical',
        fixtureRole: 'worker-first-cad-descriptor',
      },
    }),
  };
}

function createDescriptorTextProperties(params: {
  readonly text: string;
  readonly width: number;
  readonly height: number;
  readonly boxY: number;
  readonly color: string;
}): TextClipProperties {
  return {
    ...DEFAULT_TEXT_PROPERTIES,
    text: params.text,
    fontSize: Math.round(Math.max(32, Math.min(params.width, params.height) * 0.055)),
    fontWeight: 700,
    color: params.color,
    strokeEnabled: true,
    strokeColor: '#05070d',
    strokeWidth: 4,
    shadowEnabled: true,
    shadowColor: 'rgba(0, 0, 0, 0.4)',
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    shadowBlur: 8,
    boxEnabled: true,
    boxX: Math.round(params.width * 0.08),
    boxY: Math.round(params.height * params.boxY),
    boxWidth: Math.round(params.width * 0.34),
    boxHeight: Math.round(params.height * 0.18),
  };
}

async function createDescriptorTextClip(params: {
  readonly id: string;
  readonly trackId: string;
  readonly name: string;
  readonly fileName: string;
  readonly textProperties: TextClipProperties;
  readonly signalAsset: SignalAssetItem;
  readonly signalRefId: string;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}): Promise<TimelineClip> {
  const runtime = await createTimelineTextCanvasRuntime({
    textProperties: params.textProperties,
    dimensions: { width: params.width, height: params.height },
  });
  return {
    id: params.id,
    trackId: params.trackId,
    name: params.name,
    file: createFixtureAsset(params.fileName, 'text/plain'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: { type: 'text', textCanvas: runtime.canvas, naturalDuration: params.durationSeconds },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    textProperties: runtime.textProperties,
    signalAssetId: params.signalAsset.id,
    signalRefId: params.signalRefId,
    signalRenderAdapterId: 'masterselects.renderer.signal-text',
    isLoading: false,
  };
}

async function buildUniversalClips(params: {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly signalAssets: ReturnType<typeof createUniversalSignalAssets>;
}): Promise<WorkerFirstUniversal3dFixtureSummary['clipIds'] & { readonly clips: TimelineClip[] }> {
  const modelClip: TimelineClip = {
    id: 'wfg-model-clip',
    trackId: 'wfg-model-track',
    name: 'WFG 3D Mesh Descriptor',
    file: createFixtureAsset('wfg-model-cube.dat', 'application/octet-stream'),
    startTime: 0,
    duration: params.durationSeconds,
    inPoint: 0,
    outPoint: params.durationSeconds,
    source: {
      type: 'model',
      meshType: 'cube',
      naturalDuration: 3600,
      threeDEffectorsEnabled: true,
    },
    transform: {
      ...DEFAULT_TRANSFORM,
      position: { x: 0.38, y: 0.08, z: 0 },
      scale: { x: 0.55, y: 0.55, z: 0.55 },
      rotation: { x: 0.2, y: 0.35, z: 0 },
    },
    effects: [],
    is3D: true,
    meshType: 'cube',
    isLoading: false,
  };
  const gaussianClip = await createDescriptorTextClip({
    id: 'wfg-gaussian-signal-clip',
    trackId: 'wfg-gaussian-track',
    name: 'WFG Gaussian Descriptor',
    fileName: 'wfg-gaussian-signal.txt',
    textProperties: createDescriptorTextProperties({
      text: 'Gaussian\nSplat',
      width: params.width,
      height: params.height,
      boxY: 0.48,
      color: '#e9f7ff',
    }),
    signalAsset: params.signalAssets.gaussian,
    signalRefId: 'wfg-gaussian-signal-asset:point-cloud',
    durationSeconds: params.durationSeconds,
    width: params.width,
    height: params.height,
  });
  const cadClip = await createDescriptorTextClip({
    id: 'wfg-cad-signal-clip',
    trackId: 'wfg-cad-track',
    name: 'WFG CAD Descriptor',
    fileName: 'wfg-cad-signal.txt',
    textProperties: createDescriptorTextProperties({
      text: 'CAD\nDXF',
      width: params.width,
      height: params.height,
      boxY: 0.68,
      color: '#f7f0d8',
    }),
    signalAsset: params.signalAssets.cad,
    signalRefId: 'wfg-cad-signal-asset:geometry',
    durationSeconds: params.durationSeconds,
    width: params.width,
    height: params.height,
  });

  return {
    model: modelClip.id,
    gaussian: gaussianClip.id,
    cad: cadClip.id,
    clips: [cadClip, gaussianClip, modelClip],
  };
}

function commitUniversalSignalAssets(signalAssets: ReturnType<typeof createUniversalSignalAssets>): void {
  const incoming = [signalAssets.gaussian, signalAssets.cad];
  const incomingIds = new Set(incoming.map((item) => item.id));
  useMediaStore.setState((state) => ({
    signalAssets: [
      ...state.signalAssets.filter((item) => !incomingIds.has(item.id)),
      ...incoming,
    ],
    signalArtifacts: incoming.reduce(
      (artifacts, item) => mergeSignalArtifacts(artifacts, item.artifacts),
      state.signalArtifacts,
    ),
  }));
}

function updateActiveCompositionMetadata(width: number, height: number, durationSeconds: number): string | null {
  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId ?? mediaState.compositions[0]?.id ?? null;
  if (!activeCompositionId) return null;

  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - universal 3D/Gaussian/CAD',
    compositions: mediaState.compositions.map((composition: Composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - universal 3D/Gaussian/CAD',
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

function summarizeFixture(params: {
  readonly contentFixture: unknown;
  readonly activeCompositionId: string | null;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly tracks: readonly TimelineTrack[];
  readonly clips: readonly TimelineClip[];
  readonly clipIds: WorkerFirstUniversal3dFixtureSummary['clipIds'];
  readonly signalAssets: ReturnType<typeof createUniversalSignalAssets>;
}): WorkerFirstUniversal3dFixtureSummary {
  const mediaState = useMediaStore.getState();
  return {
    projectId: PROJECT_ID,
    contentFixture: params.contentFixture,
    activeCompositionId: params.activeCompositionId,
    durationSeconds: params.durationSeconds,
    width: params.width,
    height: params.height,
    trackCount: params.tracks.length,
    clipCount: params.clips.length,
    clipIds: params.clipIds,
    signalAssetIds: {
      gaussian: params.signalAssets.gaussian.id,
      cad: params.signalAssets.cad.id,
    },
    timelineSignals: collectCurrentTimelineSignals(params.clips, {
      signalAssets: mediaState.signalAssets,
    }),
  };
}

export async function materializeWorkerFirstUniversal3dFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const manifest = getUniversal3dManifest();
  const width = Math.round(readNumberArg(args, 'width', DEFAULT_WIDTH, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', DEFAULT_HEIGHT, 180, 2160));
  const minDuration = Math.max(...manifest.sampleTimesSeconds) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', DEFAULT_DURATION_SECONDS, minDuration, 30);

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

  const activeCompositionId = updateActiveCompositionMetadata(width, height, durationSeconds);
  const signalAssets = createUniversalSignalAssets();
  commitUniversalSignalAssets(signalAssets);
  const descriptorTracks = createUniversalTracks();
  const descriptorPlan = await buildUniversalClips({
    width,
    height,
    durationSeconds,
    signalAssets,
  });

  const timelineState = useTimelineStore.getState();
  const tracks = [...descriptorTracks, ...timelineState.tracks];
  const clips = [...descriptorPlan.clips, ...timelineState.clips];
  useTimelineStore.setState({
    tracks,
    clips,
    selectedClipIds: new Set([descriptorPlan.model, descriptorPlan.gaussian, descriptorPlan.cad]),
    primarySelectedClipId: descriptorPlan.model,
    expandedTracks: new Set(tracks.map((track) => track.id)),
    duration: Math.max(timelineState.duration, durationSeconds),
    durationLocked: true,
    playheadPosition: 0,
    isPlaying: false,
  });

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(4, 220);

  const summary = summarizeFixture({
    contentFixture: contentResult.data,
    activeCompositionId,
    width,
    height,
    durationSeconds,
    tracks,
    clips,
    clipIds: {
      model: descriptorPlan.model,
      gaussian: descriptorPlan.gaussian,
      cad: descriptorPlan.cad,
    },
    signalAssets,
  });
  const missingRequiredSignals = manifest.requiredSignals.filter((signal) => !summary.timelineSignals.includes(signal));
  if (missingRequiredSignals.length > 0) {
    return {
      success: false,
      error: 'Universal 3D/Gaussian/CAD fixture did not expose every required manifest signal.',
      data: {
        summary,
        missingRequiredSignals,
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

function hasCallerUniversalOverrideFields(args: Record<string, unknown>): boolean {
  return args.tracks !== undefined
    || args.clips !== undefined
    || args.timelineSignals !== undefined
    || args.signalAssets !== undefined
    || args.signalAssetId !== undefined
    || args.signalRefId !== undefined
    || args.signalRenderAdapterId !== undefined
    || args.modelClip !== undefined
    || args.gaussianClip !== undefined
    || args.cadClip !== undefined
    || args.meshType !== undefined
    || args.modelUrl !== undefined
    || args.modelFileName !== undefined
    || args.gaussianSplatUrl !== undefined
    || args.gaussianSplatFileName !== undefined
    || args.gaussianSplatRuntimeKey !== undefined
    || args.cadFileName !== undefined
    || args.cadMimeType !== undefined
    || args.contentFixture !== undefined;
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

export async function handleRunWorkerFirstUniversal3dGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstUniversal3dGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the universal-3d-gaussian-cad golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, sample times, and target snapshots are controlled by the universal-3d-gaussian-cad manifest.',
    };
  }

  if (hasCallerUniversalOverrideFields(args)) {
    return {
      success: false,
      error: 'Universal 3D, Gaussian, CAD descriptors and signal evidence are controlled by the fixture runner.',
    };
  }

  const manifest = getUniversal3dManifest();
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
        ? { success: false, error: 'One or more universal-3d-gaussian-cad golden fixture captures failed.', data }
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
