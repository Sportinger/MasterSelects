import { useMediaStore } from '../../stores/mediaStore';
import { useSliceStore } from '../../stores/sliceStore';
import { useTimelineStore } from '../../stores/timeline';
import type { TargetSliceConfig } from '../../types/outputSlice';
import { registerPreviewTarget, unregisterPreviewTarget } from '../render/previewTargetRegistration';
import { renderHostPort } from '../render/renderHostPort';
import { captureRenderTargetSnapshot } from '../render/renderTargetSnapshotFactory';
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
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

type RestoreState = TimelineCanvasSmokeRestoreState;

interface OutputRoutingRestoreState {
  readonly configs: ReturnType<typeof useSliceStore.getState>['configs'];
  readonly activeTab: ReturnType<typeof useSliceStore.getState>['activeTab'];
  readonly previewingTargetId: ReturnType<typeof useSliceStore.getState>['previewingTargetId'];
}

export interface WorkerFirstMultiTargetOutputSliceFixtureSummary {
  readonly projectId: 'multi-target-output-slice';
  readonly contentFixture: unknown;
  readonly targetIds: readonly string[];
  readonly activeCompositionTargetIds: readonly string[];
  readonly independentTargetIds: readonly string[];
  readonly sliceTargetId: string;
  readonly sliceCount: number;
  readonly enabledSliceCount: number;
  readonly outputPreview: {
    readonly activeTab: 'input' | 'output';
    readonly previewingTargetId: string | null;
  };
  readonly timelineSignals: readonly string[];
}

export interface WorkerFirstMultiTargetOutputSliceGoldenFixtureDeps {
  readonly materializeFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureGoldenFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly beginMutation: () => () => void;
  readonly captureRestoreState: () => RestoreState;
  readonly restoreTimeline: (snapshot: RestoreState) => Promise<TimelineCanvasSmokeRestoreResult>;
}

const PROJECT_ID = 'multi-target-output-slice' as const;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_DURATION_SECONDS = 3.25;
const TARGET_A_ID = 'wfg-output-slice-target-a';
const TARGET_B_ID = 'wfg-output-slice-target-b';
const TARGET_IDS = [TARGET_A_ID, TARGET_B_ID] as const;
const TARGET_SOURCE = { type: 'activeComp' as const };

const DEFAULT_DEPS: WorkerFirstMultiTargetOutputSliceGoldenFixtureDeps = {
  materializeFixture: (args) => materializeWorkerFirstMultiTargetOutputSliceFixture(args),
  captureGoldenFingerprint: (args) => captureMultiTargetOutputSliceGoldenFingerprint(args),
  beginMutation: () => beginTimelineCanvasSmokeMutation(),
  captureRestoreState: () => captureTimelineCanvasSmokeRestoreState(),
  restoreTimeline: (snapshot) => restoreTimelineCanvasSmokeState(snapshot),
};

function getMultiTargetOutputSliceManifest(): WorkerFirstGoldenProjectManifest {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('multi-target-output-slice golden manifest is missing');
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

function captureOutputRoutingRestoreState(): OutputRoutingRestoreState {
  const state = useSliceStore.getState();
  return {
    configs: new Map(state.configs),
    activeTab: state.activeTab,
    previewingTargetId: state.previewingTargetId,
  };
}

function restoreOutputRoutingState(snapshot: OutputRoutingRestoreState): void {
  useSliceStore.setState({
    configs: new Map(snapshot.configs),
    activeTab: snapshot.activeTab,
    previewingTargetId: snapshot.previewingTargetId,
  });
}

function removeFixtureTargetCanvases(): void {
  for (const id of TARGET_IDS) {
    document.querySelector(`[data-worker-first-target="${id}"]`)?.remove();
  }
}

function unregisterFixtureTargets(): void {
  for (const id of TARGET_IDS) {
    try {
      unregisterPreviewTarget(id, TARGET_SOURCE);
    } catch {
      // The target may not exist yet or may already have been removed by a prior run.
    }
  }
  removeFixtureTargetCanvases();
}

function createTargetCanvas(id: string, index: number, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.dataset.workerFirstTarget = id;
  canvas.width = width;
  canvas.height = height;
  canvas.style.position = 'fixed';
  canvas.style.left = `${-10000 - index * (width + 8)}px`;
  canvas.style.top = '0px';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);
  return canvas;
}

function registerFixtureTargets(width: number, height: number): void {
  unregisterFixtureTargets();
  for (const [index, id] of TARGET_IDS.entries()) {
    const canvas = createTargetCanvas(id, index, width, height);
    const registered = registerPreviewTarget({
      id,
      name: index === 0 ? 'WFG Output Slice A' : 'WFG Output Target B',
      source: TARGET_SOURCE,
      showTransparencyGrid: index === 1,
      canvas,
    });
    if (!registered) {
      throw new Error(`Failed to register output target ${id}.`);
    }
  }
}

function buildSliceConfig(targetId: string): TargetSliceConfig {
  return {
    targetId,
    selectedSliceId: 'wfg-output-slice-a',
    slices: [{
      id: 'wfg-output-slice-a',
      name: 'WFG Output Slice A',
      type: 'slice',
      inverted: false,
      enabled: true,
      inputCorners: [
        { x: 0.08, y: 0.08 },
        { x: 0.92, y: 0.08 },
        { x: 0.92, y: 0.92 },
        { x: 0.08, y: 0.92 },
      ],
      warp: {
        mode: 'cornerPin',
        corners: [
          { x: 0.04, y: 0.12 },
          { x: 0.96, y: 0.02 },
          { x: 0.9, y: 0.95 },
          { x: 0.1, y: 0.88 },
        ],
      },
    }],
  };
}

function configureOutputSliceState(): void {
  useSliceStore.setState((state) => {
    const configs = new Map(state.configs);
    configs.set(TARGET_A_ID, buildSliceConfig(TARGET_A_ID));
    configs.delete(TARGET_B_ID);
    return {
      configs,
      activeTab: 'output',
      previewingTargetId: TARGET_A_ID,
    };
  });
}

function summarizeOutputRouting() {
  const snapshot = captureRenderTargetSnapshot();
  const sliceConfig = snapshot.sliceConfigs[TARGET_A_ID];
  return {
    targetIds: snapshot.targets.map((target) => target.id),
    activeCompositionTargetIds: snapshot.activeCompositionTargetIds,
    independentTargetIds: snapshot.independentTargetIds,
    sliceCount: sliceConfig?.slices.length ?? 0,
    enabledSliceCount: sliceConfig?.slices.filter((slice) => slice.enabled).length ?? 0,
    outputPreview: snapshot.outputPreview,
  };
}

export async function materializeWorkerFirstMultiTargetOutputSliceFixture(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const manifest = getMultiTargetOutputSliceManifest();
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

  const mediaState = useMediaStore.getState();
  const activeCompositionId = mediaState.activeCompositionId;
  useMediaStore.setState({
    currentProjectName: 'Worker First Golden Fixture - multi-target-output-slice',
    compositions: mediaState.compositions.map((composition) => (
      composition.id === activeCompositionId
        ? {
            ...composition,
            name: 'Worker First Golden - multi-target/output-slice',
            duration: durationSeconds,
            width,
            height,
          }
        : composition
    )),
  });

  registerFixtureTargets(320, 180);
  configureOutputSliceState();

  renderHostPort.setResolution(width, height);
  renderHostPort.requestNewFrameRender();
  await waitForFrames(6, 260);

  const routing = summarizeOutputRouting();
  const summary: WorkerFirstMultiTargetOutputSliceFixtureSummary = {
    projectId: PROJECT_ID,
    contentFixture: contentResult.data,
    targetIds: routing.targetIds,
    activeCompositionTargetIds: routing.activeCompositionTargetIds,
    independentTargetIds: routing.independentTargetIds,
    sliceTargetId: TARGET_A_ID,
    sliceCount: routing.sliceCount,
    enabledSliceCount: routing.enabledSliceCount,
    outputPreview: routing.outputPreview,
    timelineSignals: ['image', 'output-slice', 'render-target', 'solid', 'text'],
  };

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

function hasCallerOutputOverrideFields(args: Record<string, unknown>): boolean {
  return args.targetIds !== undefined
    || args.renderTargets !== undefined
    || args.outputTargets !== undefined
    || args.slices !== undefined
    || args.outputSlices !== undefined
    || args.sliceConfigs !== undefined
    || args.canvases !== undefined;
}

function captureArgsForSample(
  args: Record<string, unknown>,
  sampleTimeSeconds: number,
): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    sampleTimeSeconds,
    settleMs: args.settleMs ?? 600,
    ...(args.sampleWidth !== undefined ? { sampleWidth: args.sampleWidth } : {}),
    ...(args.sampleHeight !== undefined ? { sampleHeight: args.sampleHeight } : {}),
  };
}

async function captureMultiTargetOutputSliceGoldenFingerprint(args: Record<string, unknown>): Promise<ToolResult> {
  const sampleTimeSeconds = typeof args.sampleTimeSeconds === 'number' && Number.isFinite(args.sampleTimeSeconds)
    ? args.sampleTimeSeconds
    : null;
  if (sampleTimeSeconds !== null) {
    useTimelineStore.getState().setPlayheadPosition(sampleTimeSeconds);
    renderHostPort.requestNewFrameRender();
    await waitForFrames(8, 320);
  }

  const result = await handleCaptureWorkerFirstGoldenFixtureFingerprint(args);
  if (result.success && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const routing = summarizeOutputRouting();
    return {
      ...result,
      data: {
        ...result.data,
        activeCompositionTargetIds: routing.activeCompositionTargetIds,
        sliceTargetId: TARGET_A_ID,
        enabledSliceCount: routing.enabledSliceCount,
        outputPreview: routing.outputPreview,
      },
    };
  }
  return result;
}

export async function handleRunWorkerFirstMultiTargetOutputSliceGoldenFixture(
  args: Record<string, unknown>,
  deps: WorkerFirstMultiTargetOutputSliceGoldenFixtureDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This runner only materializes and captures the multi-target-output-slice golden fixture.',
      data: { projectId: PROJECT_ID },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Golden fixture source, fingerprint, sample times, and target snapshots are controlled by the multi-target-output-slice manifest.',
    };
  }

  if (hasCallerOutputOverrideFields(args)) {
    return {
      success: false,
      error: 'The multi-target-output-slice render targets, canvases, and slice configuration are controlled by the runner.',
    };
  }

  const manifest = getMultiTargetOutputSliceManifest();
  const shouldRestoreTimeline = args.restoreTimelineAfterRun === true;
  const restoreState = shouldRestoreTimeline ? deps.captureRestoreState() : null;
  const restoreOutputState = shouldRestoreTimeline ? captureOutputRoutingRestoreState() : null;
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
        ? { success: false, error: 'One or more multi-target-output-slice golden fixture captures failed.', data }
        : { success: true, data };
    }
  } finally {
    if (restoreState) {
      restoreResult = await deps.restoreTimeline(restoreState);
    }
    if (restoreOutputState) {
      unregisterFixtureTargets();
      restoreOutputRoutingState(restoreOutputState);
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
