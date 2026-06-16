import {
  compareFrameFingerprints,
  type FrameFingerprint,
  type FrameFingerprintComparison,
  type FrameFingerprintComparisonThresholds,
  type FrameFingerprintOptions,
} from './frameFingerprint';
import {
  recordWorkerFirstShadowParitySample,
} from './workerFirstProofCaptures';
import type { ToolResult } from './types';
import {
  handleCaptureWorkerFirstGoldenFixtureFingerprint,
} from './workerFirstGoldenFixtureBridge';
import {
  handleRunWorkerFirstSolidTextImageGoldenFixture,
} from './workerFirstSolidTextImageGoldenFixture';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
} from './workerFirstProofHarness';
import {
  recordWorkerFirstCounterSources,
} from './workerFirstCounterSources';
import {
  createWorkerFirstRuntimeSnapshot,
  workerFirstRuntimeSnapshotToCounterSources,
  type WorkerFirstRuntimeJobRecord,
} from './workerFirstRuntimeModel';

const PROJECT_ID = 'solid-text-image' as const;

export type WorkerFirstStatic2dShadowProjectId =
  | 'solid-text-image'
  | 'multi-video'
  | 'webcodecs-provider'
  | 'html-provider-fallback'
  | 'multi-target-output-slice'
  | 'effects-masks-transitions'
  | 'jpeg-proxy'
  | 'nested-comps'
  | 'ram-cache'
  | 'bake'
  | 'export'
  | 'universal-3d-gaussian-cad';

export const WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS: Required<FrameFingerprintComparisonThresholds> = {
  maxAvgRgbDelta: 80,
  maxMeanLumaDelta: 70,
  maxNonBlankRatioDelta: 0.35,
  minReferenceNonBlankRatio: 0.05,
  minCandidateNonBlankRatio: 0.05,
  maxColorRangeDelta: 180,
};

export interface WorkerFirstSolidTextImageShadowRenderPlan {
  readonly projectId: WorkerFirstStatic2dShadowProjectId;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly sampleTimeSeconds: number;
}

export type WorkerFirstStatic2dShadowRenderer =
  | 'worker-offscreen-2d-solid-text-image'
  | 'worker-offscreen-2d-multi-video'
  | 'worker-offscreen-2d-webcodecs-provider'
  | 'worker-offscreen-2d-html-provider-fallback'
  | 'worker-offscreen-2d-multi-target-output-slice'
  | 'worker-offscreen-2d-effects-masks-transitions'
  | 'worker-offscreen-2d-jpeg-proxy'
  | 'worker-offscreen-2d-nested-comps'
  | 'worker-offscreen-2d-ram-cache'
  | 'worker-offscreen-2d-bake'
  | 'worker-offscreen-2d-export'
  | 'worker-offscreen-2d-universal-3d-gaussian-cad';

export interface WorkerFirstSolidTextImageShadowRenderResult {
  readonly renderer: WorkerFirstStatic2dShadowRenderer;
  readonly fingerprint: FrameFingerprint;
  readonly workerMs: number;
}

export interface WorkerFirstSolidTextImageShadowParityDeps {
  readonly materializeAndCaptureMainFixture: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly captureMainFingerprint: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly renderWorkerShadowFingerprint: (
    plan: WorkerFirstSolidTextImageShadowRenderPlan,
    options: FrameFingerprintOptions,
  ) => Promise<WorkerFirstSolidTextImageShadowRenderResult>;
}

const DEFAULT_DEPS: WorkerFirstSolidTextImageShadowParityDeps = {
  materializeAndCaptureMainFixture: (args) => handleRunWorkerFirstSolidTextImageGoldenFixture(args),
  captureMainFingerprint: (args) => handleCaptureWorkerFirstGoldenFixtureFingerprint(args),
  renderWorkerShadowFingerprint: (plan, options) => renderSolidTextImageShadowFrameInWorker(plan, options),
};

function manifestSampleTimes(): readonly number[] {
  const manifest = WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((entry) => entry.id === PROJECT_ID);
  if (!manifest) {
    throw new Error('solid-text-image golden manifest is missing');
  }
  return manifest.sampleTimesSeconds;
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

function readSampleDimension(
  args: Record<string, unknown>,
  key: 'sampleWidth' | 'sampleHeight',
): number | undefined {
  if (args[key] === undefined) return undefined;
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(256, Math.round(value)));
}

function hasCallerProofFields(args: Record<string, unknown>): boolean {
  return args.mainFingerprint !== undefined
    || args.workerFingerprint !== undefined
    || args.fingerprint !== undefined
    || args.thresholds !== undefined
    || args.source !== undefined;
}

function isFrameFingerprint(value: unknown): value is FrameFingerprint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FrameFingerprint>;
  return typeof candidate.hash === 'string'
    && typeof candidate.sourceWidth === 'number'
    && typeof candidate.sourceHeight === 'number'
    && typeof candidate.nonBlankRatio === 'number'
    && typeof candidate.alphaCoverage === 'number'
    && typeof candidate.meanLuma === 'number'
    && !!candidate.avgRgb
    && typeof candidate.avgRgb.r === 'number'
    && typeof candidate.avgRgb.g === 'number'
    && typeof candidate.avgRgb.b === 'number'
    && !!candidate.colorRange
    && typeof candidate.colorRange.r === 'number'
    && typeof candidate.colorRange.g === 'number'
    && typeof candidate.colorRange.b === 'number'
    && typeof candidate.colorRange.luma === 'number';
}

function readCaptureData(result: ToolResult): Record<string, unknown> | null {
  return result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : null;
}

function readMainFingerprint(result: ToolResult): FrameFingerprint | null {
  const data = readCaptureData(result);
  return isFrameFingerprint(data?.fingerprint) ? data.fingerprint : null;
}

function createShadowPlan(args: Record<string, unknown>, sampleTimeSeconds: number): WorkerFirstSolidTextImageShadowRenderPlan {
  const width = Math.round(readNumberArg(args, 'width', 1280, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', 720, 180, 2160));
  const minDuration = Math.max(...manifestSampleTimes()) + 0.25;
  const durationSeconds = readNumberArg(args, 'durationSeconds', 1.25, minDuration, 10);
  return {
    projectId: PROJECT_ID,
    width,
    height,
    durationSeconds,
    sampleTimeSeconds,
  };
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

function buildFingerprintOptions(args: Record<string, unknown>): FrameFingerprintOptions {
  return {
    ...(readSampleDimension(args, 'sampleWidth') !== undefined
      ? { sampleWidth: readSampleDimension(args, 'sampleWidth') }
      : {}),
    ...(readSampleDimension(args, 'sampleHeight') !== undefined
      ? { sampleHeight: readSampleDimension(args, 'sampleHeight') }
      : {}),
  };
}

export function recordWorkerFirstShadowParityRunCounters(input: {
  readonly projectId: WorkerFirstStatic2dShadowProjectId;
  readonly samples: readonly {
    readonly sampleTimeSeconds: number;
    readonly worker: Omit<WorkerFirstSolidTextImageShadowRenderResult, 'fingerprint'>;
  }[];
  readonly failures: readonly { readonly sampleTimeSeconds: number; readonly error: string }[];
  readonly capturedAt: number;
}): void {
  const attempted = new Set([
    ...input.samples.map((sample) => sample.sampleTimeSeconds),
    ...input.failures.map((failure) => failure.sampleTimeSeconds),
  ]).size;
  const latestSample = input.samples.at(-1);
  const completedJobs: WorkerFirstRuntimeJobRecord[] = input.samples.map((sample) => ({
    jobId: `${input.projectId}:worker-shadow:${sample.sampleTimeSeconds}`,
    type: 'independent-preview',
    targetId: 'worker-shadow',
    compositionId: null,
    priority: 'normal',
    state: 'completed',
    queuedAtMs: input.capturedAt,
    startedAtMs: input.capturedAt,
    finishedAtMs: input.capturedAt,
    exactFrame: true,
  }));
  const droppedJobs: WorkerFirstRuntimeJobRecord[] = input.failures.map((failure) => ({
    jobId: `${input.projectId}:worker-shadow-failed:${failure.sampleTimeSeconds}`,
    type: 'independent-preview',
    targetId: 'worker-shadow',
    compositionId: null,
    priority: 'normal',
    state: 'dropped',
    queuedAtMs: input.capturedAt,
    startedAtMs: input.capturedAt,
    finishedAtMs: input.capturedAt,
    exactFrame: true,
  }));
  const runtimeSnapshot = createWorkerFirstRuntimeSnapshot({
    source: 'worker-shadow',
    capturedAtMs: input.capturedAt,
    jobs: [...completedJobs, ...droppedJobs],
    cacheCounters: { leakChecks: 1 },
    schedulerCounters: {
      admitted: attempted,
      enqueued: attempted,
      started: attempted,
      completed: input.samples.length,
      canceled: 0,
      coalesced: 0,
      dropped: Math.max(0, attempted - input.samples.length),
      expired: 0,
      late: 0,
      staleResponses: 0,
      resizeCoalesced: 0,
      priorityInversions: 0,
    },
    timing: {
      transferLatencyMs: null,
      providerWaitMs: 0,
      presentedFrameId: latestSample
        ? `${input.projectId}-worker-shadow:${latestSample.sampleTimeSeconds}`
        : null,
    },
  });
  recordWorkerFirstCounterSources(workerFirstRuntimeSnapshotToCounterSources(runtimeSnapshot), input.capturedAt);
}

export async function renderSolidTextImageShadowFrameInWorker(
  plan: WorkerFirstSolidTextImageShadowRenderPlan,
  options: FrameFingerprintOptions = {},
): Promise<WorkerFirstSolidTextImageShadowRenderResult> {
  if (typeof Worker === 'undefined') {
    throw new Error('Browser Worker API is unavailable for worker-shadow parity.');
  }

  const worker = new Worker(new URL('./workerFirstSolidTextImageShadow.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const result = await new Promise<WorkerFirstSolidTextImageShadowRenderResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Worker shadow renderer timed out.'));
      }, 10000);
      worker.onmessage = (event: MessageEvent<{ success: boolean; data?: WorkerFirstSolidTextImageShadowRenderResult; error?: string }>) => {
        window.clearTimeout(timeout);
        if (event.data.success && event.data.data) {
          resolve(event.data.data);
        } else {
          reject(new Error(event.data.error ?? 'Worker shadow renderer failed.'));
        }
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || 'Worker shadow renderer crashed.'));
      };
      worker.postMessage({ plan, options });
    });
    return result;
  } finally {
    worker.terminate();
  }
}

export async function handleRunWorkerFirstSolidTextImageShadowParity(
  args: Record<string, unknown>,
  deps: WorkerFirstSolidTextImageShadowParityDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (args.projectId !== undefined && args.projectId !== PROJECT_ID) {
    return {
      success: false,
      error: 'This worker-shadow parity runner only supports the solid-text-image golden fixture.',
      data: {
        projectId: PROJECT_ID,
      },
    };
  }

  if (hasCallerProofFields(args)) {
    return {
      success: false,
      error: 'Worker-shadow parity fingerprints, source, and thresholds are captured by the browser and cannot be caller-supplied.',
    };
  }

  const fingerprintOptions = buildFingerprintOptions(args);
  const fixtureResult = await deps.materializeAndCaptureMainFixture({
    ...args,
    projectId: PROJECT_ID,
    restoreTimelineAfterRun: false,
  });
  if (!fixtureResult.success) {
    return fixtureResult;
  }

  const sampleResults: Array<{
    readonly sampleTimeSeconds: number;
    readonly mainFingerprint: FrameFingerprint;
    readonly workerFingerprint: FrameFingerprint;
    readonly comparison: FrameFingerprintComparison;
    readonly worker: Omit<WorkerFirstSolidTextImageShadowRenderResult, 'fingerprint'>;
  }> = [];
  const failures: Array<{ sampleTimeSeconds: number; error: string }> = [];

  for (const sampleTimeSeconds of manifestSampleTimes()) {
    const captureResult = await deps.captureMainFingerprint(captureArgsForSample(args, sampleTimeSeconds));
    const mainFingerprint = readMainFingerprint(captureResult);
    if (!captureResult.success || !mainFingerprint) {
      failures.push({
        sampleTimeSeconds,
        error: captureResult.error ?? 'Main renderer capture did not return a fingerprint.',
      });
      continue;
    }

    try {
      const plan = createShadowPlan(args, sampleTimeSeconds);
      const workerResult = await deps.renderWorkerShadowFingerprint(plan, fingerprintOptions);
      const comparison = compareFrameFingerprints(
        mainFingerprint,
        workerResult.fingerprint,
        WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
      );
      recordWorkerFirstShadowParitySample({
        projectId: PROJECT_ID,
        sampleTimeSeconds,
        mainFingerprint,
        workerFingerprint: workerResult.fingerprint,
        thresholds: WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
      });
      sampleResults.push({
        sampleTimeSeconds,
        mainFingerprint,
        workerFingerprint: workerResult.fingerprint,
        comparison,
        worker: {
          renderer: workerResult.renderer,
          workerMs: workerResult.workerMs,
        },
      });
      if (!comparison.passed) {
        failures.push({
          sampleTimeSeconds,
          error: comparison.failures.join(', '),
        });
      }
    } catch (error) {
      failures.push({
        sampleTimeSeconds,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  recordWorkerFirstShadowParityRunCounters({
    projectId: PROJECT_ID,
    samples: sampleResults,
    failures,
    capturedAt: Date.now(),
  });

  const data = {
    projectId: PROJECT_ID,
    manifestSampleTimesSeconds: manifestSampleTimes(),
    fixture: fixtureResult.data,
    samples: sampleResults,
    failures,
    thresholds: WORKER_FIRST_STATIC_2D_SHADOW_THRESHOLDS,
    w5StartPermissionsRemainStatsGuarded: true,
  };

  return failures.length > 0
    ? {
        success: false,
        error: 'One or more solid-text-image worker-shadow parity samples failed.',
        data,
      }
    : {
        success: true,
        data,
      };
}
